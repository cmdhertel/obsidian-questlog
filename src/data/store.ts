// Reads and writes quests, the Other inbox, day logs and reviews as Markdown notes, and keeps an in-memory index.
import { App, Events, TFile, TFolder, normalizePath } from "obsidian";
import type { QuestlogSettings } from "../settings";
import { t, variants } from "../i18n";
import { fmtClock, isoDay, isoWeek } from "./dates";
import { formatBreak, parseBreaks } from "./gaps";
import * as md from "./markdown";
import * as plan from "./plan";
import * as st from "./stages";
import * as se from "./stageedit";
import * as vis from "./vision";
import { fmDay, statusDates } from "./questdates";
import { fmClock, leftovers } from "./rituals";
import { parsePlanHours, renameKey } from "./plan-hours";
import { CHECKIN_HEADINGS, checkinLine, type CheckinAction } from "./checkin";
import { parsePeriodId, type Period } from "./periods";
import type { DayLog, Quest, QuestStatus, Review, Session, Span, Task, VisionNote } from "./model";

export const PALETTE = ["#7c6cf0", "#2f9e8f", "#e0823d", "#d04f7a", "#4a90d9", "#8a9a3b", "#b4637a", "#c9a227"];
/** Basename of the inbox note for non-quest tasks; sessions link to it as [[Other]]. */
export const OTHER = "Other";
export const OTHER_COLOR = "var(--text-faint)";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export type SessionInput = Pick<Session, "day" | "start" | "end" | "taskText" | "quest" | "taskId"> & { note?: string };
export type QuestPatch = Partial<Pick<Quest, "name" | "why" | "weeklyHours" | "color" | "icon" | "status" | "order">>;

export class QuestStore extends Events {
  quests: Quest[] = [];
  other: Quest;
  days = new Map<string, DayLog>();
  reviews = new Map<string, Review>();
  /** `Vision.md`, or null while there is no such note. */
  vision: VisionNote | null = null;
  private pending = new Set<string>();
  private timer: number | null = null;

  constructor(private app: App, private settings: () => QuestlogSettings, private saveSettings: () => Promise<void> = async () => {}) {
    super();
    this.other = this.emptyOther();
  }

  // ------------------------------------------------------------ paths

  get root(): string {
    return normalizePath(this.settings().folder || "Questlog");
  }
  get questsDir(): string {
    return `${this.root}/Quests`;
  }
  get daysDir(): string {
    return `${this.root}/Days`;
  }
  get reviewsDir(): string {
    return `${this.root}/Reviews`;
  }
  get otherPath(): string {
    return `${this.root}/${OTHER}.md`;
  }
  get visionPath(): string {
    return `${this.root}/Vision.md`;
  }
  private kind(path: string): "quest" | "other" | "day" | "review" | "vision" | null {
    if (!path.endsWith(".md")) return null;
    if (path === this.otherPath) return "other";
    if (path === this.visionPath) return "vision";
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir === this.questsDir) return "quest";
    if (dir === this.daysDir) return "day";
    if (dir === this.reviewsDir) return "review";
    return null;
  }

  private emptyOther(): Quest {
    return {
      path: this.otherPath, name: OTHER, kind: "other", status: "active", color: OTHER_COLOR,
      icon: "inbox", why: "", weeklyHours: 0, order: 0, tasks: [], stages: [], created: null, checkedIn: null, paused: null, finished: null,
    };
  }

  // ------------------------------------------------------------ loading

  async reload(): Promise<void> {
    this.quests = [];
    this.other = this.emptyOther();
    this.days.clear();
    this.reviews.clear();
    this.vision = null;
    const files = this.app.vault.getMarkdownFiles().filter((f) => this.kind(f.path));
    await Promise.all(files.map((f) => this.readFile(f)));
    this.sortQuests();
    this.trigger("changed");
  }

  /** Wire vault events; returns the event refs so the plugin can register them for cleanup. */
  watch() {
    const touch = (path: string) => {
      if (!this.kind(path)) return;
      this.pending.add(path);
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.flush(), 150);
    };
    return [
      this.app.metadataCache.on("changed", (file: TFile) => touch(file.path)),
      this.app.vault.on("delete", (f) => touch(f.path)),
      this.app.vault.on("rename", (f, old) => {
        touch(old);
        touch(f.path);
      }),
    ];
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const paths = [...this.pending];
    this.pending.clear();
    for (const path of paths) {
      this.forget(path);
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.readFile(f);
      // Kept while it is read again, so Home never shows an empty vision in between.
      else if (path === this.visionPath) this.vision = null;
    }
    this.sortQuests();
    this.trigger("changed");
  }

  private forget(path: string): void {
    this.quests = this.quests.filter((q) => q.path !== path);
    if (path === this.otherPath) this.other = this.emptyOther();
    for (const [k, d] of this.days) if (d.path === path) this.days.delete(k);
    for (const [k, r] of this.reviews) if (r.path === path) this.reviews.delete(k);
  }

  private async readFile(f: TFile): Promise<void> {
    const kind = this.kind(f.path);
    const fm: Record<string, unknown> = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const content = await this.app.vault.cachedRead(f);
    // A reload and a flush can read the same note at once; the later read replaces the earlier one, never adds a twin.
    if (kind === "quest") this.quests = [...this.quests.filter((q) => q.path !== f.path), this.toQuest(f, fm, content)];
    else if (kind === "vision") this.vision = vis.parseVision(content);
    else if (kind === "other") this.other = { ...this.emptyOther(), tasks: md.parseTasks(content, f.path) };
    else if (kind === "day" && DAY_RE.test(f.basename)) {
      this.days.set(f.basename, {
        path: f.path,
        day: f.basename,
        plan: arr(fm.plan),
        breaks: parseBreaks(fm.breaks),
        sessions: md.parseSessions(content, f.basename),
        dayStarted: fmClock(fm.day_started),
        oneThing: typeof fm.one_thing === "string" ? fm.one_thing.trim() : "",
        dayClosed: fmClock(fm.day_closed),
        closingLine: md.readSectionText(content, closingHeadings()),
      });
    } else if (kind === "review") {
      // Weeks, months, quarters and years, by file name; anything else in the folder is left alone.
      const p = parsePeriodId(f.basename);
      if (!p) return;
      const week = p.period === "week";
      this.reviews.set(f.basename, {
        path: f.path,
        id: f.basename,
        period: p.period,
        week: week ? f.basename : "",
        answers: readAnyAnswers(content),
        planHours: week ? parsePlanHours(fm.plan_hours) : null,
      });
    }
  }

  private toQuest(f: TFile, fm: Record<string, unknown>, content: string): Quest {
    const status: QuestStatus = fm.status === "done" || fm.status === "paused" ? fm.status : "active";
    const idx = Math.abs(hash(f.basename)) % PALETTE.length;
    return {
      path: f.path,
      name: f.basename,
      kind: "quest",
      status,
      color: typeof fm.color === "string" && fm.color ? fm.color : (PALETTE[idx] ?? "#7c6cf0"),
      icon: typeof fm.icon === "string" && fm.icon ? fm.icon : "flag",
      why: typeof fm.why === "string" ? fm.why : "",
      weeklyHours: Number(fm.weekly_hours) || 0,
      order: Number.isFinite(Number(fm.order)) && fm.order !== undefined ? Number(fm.order) : 999,
      tasks: md.parseTasks(content, f.path),
      stages: st.parseStages(content),
      created: fmDay(fm.created),
      checkedIn: fmDay(fm.checked_in),
      paused: fmDay(fm.paused),
      finished: fmDay(fm.finished),
    };
  }

  private sortQuests(): void {
    this.quests.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------ queries

  /** Quest by link name; "Other" resolves to the inbox. */
  quest(name: string): Quest | undefined {
    if (name === OTHER) return this.other;
    return this.quests.find((q) => q.name === name);
  }
  questOf(task: Task): Quest | undefined {
    if (task.questPath === this.other.path) return this.other;
    return this.quests.find((q) => q.path === task.questPath);
  }
  activeQuests(): Quest[] {
    return this.quests.filter((q) => q.status === "active");
  }
  /** Quests that accept work: active ones plus the Other inbox. */
  workable(): Quest[] {
    return [...this.activeQuests(), this.other];
  }
  isWorkable(quest: Quest): boolean {
    return quest.kind === "other" || quest.status === "active";
  }
  allTasks(): Task[] {
    return [...this.quests, this.other].flatMap((q) => q.tasks);
  }
  task(id: string): Task | undefined {
    if (!id) return undefined;
    for (const q of [...this.quests, this.other]) {
      const x = q.tasks.find((y) => y.id === id);
      if (x) return x;
    }
    return undefined;
  }
  isQuestWork(name: string): boolean {
    return name !== OTHER;
  }
  sessions(days: string[]): Session[] {
    return days.flatMap((d) => this.days.get(d)?.sessions ?? []);
  }
  allSessions(): Session[] {
    return [...this.days.values()].flatMap((d) => d.sessions);
  }
  daysWithTime(): Set<string> {
    return new Set([...this.days.values()].filter((d) => d.sessions.length).map((d) => d.day));
  }

  // ------------------------------------------------------------ plan queries

  private planDays(): plan.PlanDay[] {
    return [...this.days.values()];
  }
  /** Open tasks to ask about when closing `day` (#20): today's list for today, else those last planned on `day`. */
  leftoversOf(day: string, today = isoDay(new Date())): Task[] {
    return leftovers(this.planDays(), this.isOpen, day, today)
      .map((id) => this.task(id))
      .filter((x): x is Task => !!x);
  }
  private isOpen = (id: string): boolean => {
    const x = this.task(id);
    if (!x || x.done) return false;
    const q = this.questOf(x);
    return !!q && q.status !== "done";
  };

  /** Open tasks shown on a day, in order (today includes tasks carried over from earlier days). */
  dayTasks(day: string, today = isoDay(new Date())): Task[] {
    return plan.dayIds(this.planDays(), day, today, this.isOpen).map((id) => this.task(id)!).filter(Boolean);
  }
  /** What a day's own plan lists, done or not (past days keep their plan; carried tasks are not added). */
  plannedOn(day: string): Task[] {
    return (this.days.get(day)?.plan ?? []).map((id) => this.task(id)).filter((x): x is Task => !!x);
  }
  /** Tasks completed on a day. */
  doneOn(day: string): Task[] {
    return this.allTasks().filter((x) => x.done && x.doneDate === day);
  }
  /** Open tasks of workable quests that are not planned for any day. */
  backlog(quest?: Quest): Task[] {
    const latest = plan.latestPlanned(this.planDays());
    const quests = quest ? [quest] : this.workable();
    return quests.flatMap((q) => q.tasks.filter((x) => !x.done && !(x.id && latest.has(x.id))));
  }
  /** The day a task is currently scheduled on (today for carried tasks), or null for the backlog. */
  scheduledDay(task: Task, today = isoDay(new Date())): string | null {
    if (!task.id) return null;
    const p = plan.latestPlanned(this.planDays()).get(task.id);
    if (!p) return null;
    return p.day < today ? today : p.day;
  }

  // ------------------------------------------------------------ vision

  /** The text Home shows: the note's, or the old setting while no note exists yet. */
  visionText(): string {
    return this.vision ? this.vision.text : this.settings().vision.trim();
  }

  private visionHeads(): vis.VisionHeads {
    return { earlier: t("md.earlier"), until: t("md.until") };
  }

  /**
   * Once per start, after the first reload: settings.vision is copied into Vision.md and cleared, but only when
   * the setting has text and the note does not exist. If creating fails the setting stays; if the note exists
   * both are left alone (the note wins).
   */
  async migrateVision(): Promise<"created" | "skipped" | "failed"> {
    const text = this.settings().vision.trim();
    if (!text || this.app.vault.getAbstractFileByPath(this.visionPath)) return "skipped";
    try {
      await this.ensureFolder(this.root);
      const f = await this.app.vault.create(this.visionPath, vis.newVisionNote(text, isoDay(new Date())));
      await this.readFile(f);
      this.trigger("changed");
    } catch (e) {
      console.error("Questlog: could not migrate the vision", e);
      return "failed";
    }
    this.settings().vision = "";
    await this.saveSettings();
    return "created";
  }

  /** Vision.md, created when missing (from the old setting when it still holds text). */
  async visionFile(): Promise<TFile> {
    await this.migrateVision();
    const f = this.app.vault.getAbstractFileByPath(this.visionPath);
    if (f instanceof TFile) return f;
    await this.ensureFolder(this.root);
    const created = await this.app.vault.create(this.visionPath, vis.newVisionNote("", isoDay(new Date())));
    await this.readFile(created);
    this.trigger("changed");
    return created;
  }

  /** Replace the vision text; with `keepOld` the previous text goes to `## Earlier`. Unchanged text does nothing. */
  async saveVision(text: string, keepOld: boolean): Promise<void> {
    const today = isoDay(new Date());
    const heads = this.visionHeads();
    const next = text.trim();
    const f = this.app.vault.getAbstractFileByPath(this.visionPath);
    if (!(f instanceof TFile)) {
      const old = this.settings().vision.trim();
      if (next === old || (!next && !old)) return;
      let c = vis.newVisionNote(next, today);
      if (keepOld) c = vis.archiveVision(c, old, today, heads);
      await this.ensureFolder(this.root);
      const created = await this.app.vault.create(this.visionPath, c);
      this.settings().vision = "";
      await this.saveSettings();
      await this.readFile(created);
      this.trigger("changed");
      return;
    }
    let changed = false;
    let result = "";
    await this.app.vault.process(f, (c) => {
      const old = vis.parseVision(c).text;
      if (old === next) return c;
      changed = true;
      result = vis.setVisionText(c, next);
      if (keepOld) result = vis.archiveVision(result, old, today, heads);
      return result;
    });
    if (!changed) return;
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      fm.updated = today;
    });
    await this.readFile(f);
    this.trigger("changed");
  }

  // ------------------------------------------------------------ files

  private async ensureFolder(path: string): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      const existing = this.app.vault.getAbstractFileByPath(p);
      if (!existing) await this.app.vault.createFolder(p);
      else if (!(existing instanceof TFolder)) throw new Error(`${p} is not a folder`);
    }
  }

  private file(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return f;
  }

  private async questFile(quest: Quest): Promise<TFile> {
    const f = this.app.vault.getAbstractFileByPath(quest.path);
    if (f instanceof TFile) return f;
    if (quest.kind !== "other") throw new Error(`Missing file: ${quest.path}`);
    await this.ensureFolder(this.root);
    return this.app.vault.create(this.otherPath, `---\ntype: questlog-other\n---\n\n## ${t("md.tasks")}\n`);
  }

  async dayFile(day: string): Promise<TFile> {
    const path = `${this.daysDir}/${day}.md`;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    await this.ensureFolder(this.daysDir);
    return this.app.vault.create(path, `---\ntype: questlog-day\ndate: ${day}\nplan: []\n---\n\n## ${t("md.sessions")}\n`);
  }

  async reviewFile(week: string): Promise<TFile> {
    const path = `${this.reviewsDir}/${week}.md`;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    await this.ensureFolder(this.reviewsDir);
    return this.app.vault.create(path, `---\ntype: questlog-review\nweek: ${week}\n---\n`);
  }

  /** The note of a month, quarter or year review (`Reviews/2026-11.md` …), created when missing. */
  async reviewFileFor(id: string, period: Exclude<Period, "week">): Promise<TFile> {
    if (parsePeriodId(id)?.period !== period) throw new Error(`Not a ${period} id: ${id}`);
    const path = `${this.reviewsDir}/${id}.md`;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    await this.ensureFolder(this.reviewsDir);
    return this.app.vault.create(path, `---\ntype: questlog-review\nperiod: ${period}\n---\n`);
  }

  // ------------------------------------------------------------ quests

  private cleanName(name: string): string {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
    if (!clean) throw new Error(t("err.questName"));
    if (clean.toLowerCase() === OTHER.toLowerCase()) throw new Error(t("err.questReserved", { name: clean }));
    return clean;
  }

  async createQuest(v: { name: string; why: string; weeklyHours: number; color?: string; icon?: string }): Promise<TFile> {
    const clean = this.cleanName(v.name);
    await this.ensureFolder(this.questsDir);
    const path = `${this.questsDir}/${clean}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(t("err.questExists", { name: clean }));
    const order = Math.max(0, ...this.quests.map((q) => (q.order === 999 ? 0 : q.order))) + 1;
    const fm = [
      "---",
      "type: quest",
      "status: active",
      `why: ${JSON.stringify(v.why)}`,
      `weekly_hours: ${v.weeklyHours || 0}`,
      ...(v.color ? [`color: "${v.color}"`] : []),
      ...(v.icon ? [`icon: ${v.icon}`] : []),
      `order: ${order}`,
      `created: ${isoDay(new Date())}`,
      "---",
      "",
      `## ${t("md.tasks")}`,
      "",
    ];
    return this.app.vault.create(path, fm.join("\n"));
  }

  async updateQuest(quest: Quest, patch: QuestPatch): Promise<void> {
    if (quest.kind === "other") return;
    const f = this.file(quest.path);
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      if (patch.why !== undefined) fm.why = patch.why;
      if (patch.weeklyHours !== undefined) fm.weekly_hours = patch.weeklyHours;
      if (patch.color !== undefined) fm.color = patch.color;
      if (patch.icon !== undefined) fm.icon = patch.icon;
      if (patch.status !== undefined) {
        const from: QuestStatus = fm.status === "done" || fm.status === "paused" ? fm.status : "active";
        applyStatus(fm, from, patch.status, isoDay(new Date()));
      }
      if (patch.order !== undefined) fm.order = patch.order;
    });
    if (patch.name !== undefined && patch.name.trim() !== quest.name) {
      const newName = this.cleanName(patch.name);
      const target = `${this.questsDir}/${newName}.md`;
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error(t("err.questExists", { name: newName }));
      // renameFile updates [[links]] when "Automatically update internal links" is on;
      // we update the session links ourselves as well so renames never orphan logged time.
      await this.app.fileManager.renameFile(f, target);
      await this.renameQuestInLogs(quest.name, newName);
      await this.renamePlanKey(quest.name, newName);
      // Keep the running timer and the remembered last work on the new name, and save them even when no timer runs.
      const { timer, lastWork } = this.settings();
      let changed = false;
      if (timer?.quest === quest.name) [timer.quest, changed] = [newName, true];
      if (lastWork?.quest === quest.name) [lastWork.quest, changed] = [newName, true];
      if (changed) await this.saveSettings();
    }
  }

  private async renameQuestInLogs(from: string, to: string): Promise<void> {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\[\\[${esc}(?=[\\]|#])`, "g");
    for (const d of this.days.values()) {
      if (!d.sessions.some((s) => s.quest === from)) continue;
      await this.app.vault.process(this.file(d.path), (c) => c.replace(re, `[[${to}`));
    }
  }

  /** Rename the quest's key in `plan_hours` of every week note that has it. */
  async renamePlanKey(from: string, to: string): Promise<void> {
    for (const r of this.reviews.values()) {
      if (!r.planHours || !(from in r.planHours)) continue;
      const f = this.app.vault.getAbstractFileByPath(r.path);
      if (!(f instanceof TFile)) continue;
      await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
        const raw = fm.plan_hours;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) fm.plan_hours = renameKey(raw as Record<string, unknown>, from, to);
      });
    }
  }

  /**
   * Answer a check-in: frontmatter for the action, then a line under `## Check-ins` (either language).
   * `hours` is the new weekly target for "shrink".
   */
  async checkIn(quest: Quest, action: CheckinAction, text: string, hours?: number): Promise<void> {
    if (quest.kind === "other") return;
    const f = this.file(quest.path);
    const today = isoDay(new Date());
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      const from: QuestStatus = fm.status === "done" || fm.status === "paused" ? fm.status : "active";
      if (action === "pause") applyStatus(fm, from, "paused", today);
      if (action === "finish") applyStatus(fm, from, "done", today);
      if (action === "shrink" && hours !== undefined && Number.isFinite(hours)) fm.weekly_hours = Math.max(0, hours);
      fm.checked_in = today;
    });
    const heads = [t("md.checkins"), ...variants("md.checkins"), ...CHECKIN_HEADINGS];
    await this.app.vault.process(f, (c) => md.appendToSectionAny(c, [...new Set(heads)], checkinLine(today, action, text)));
  }

  async moveQuest(quest: Quest, dir: -1 | 1): Promise<void> {
    const list = [...this.quests];
    const i = list.indexOf(quest);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (let k = 0; k < list.length; k++) {
      const q = list[k]!;
      if (q.order !== k + 1) await this.updateQuest(q, { order: k + 1 });
    }
  }

  // ------------------------------------------------------------ tasks

  private sectionNames(): st.SectionNames {
    return { stages: t("md.stages"), tasks: t("md.tasks") };
  }

  /** Re-read a quest note so follow-up calls see it before the metadata cache catches up. */
  private async refreshQuest(quest: Quest, f: TFile): Promise<void> {
    const content = await this.app.vault.read(f);
    const tasks = md.parseTasks(content, f.path);
    if (quest.kind === "other") this.other = { ...this.other, path: f.path, tasks };
    else {
      quest.tasks = tasks;
      quest.stages = st.parseStages(content);
    }
  }

  async addTask(quest: Quest, text: string): Promise<string> {
    const id = md.newId();
    const f = await this.questFile(quest);
    const line = md.taskLine(text, id);
    await this.app.vault.process(f, (c) => {
      const cur = quest.kind === "other" ? null : st.currentStage(st.parseStages(c));
      return cur ? st.addTaskToStage(c, cur.index, line, this.sectionNames()) : md.appendToSection(c, t("md.tasks"), line);
    });
    await this.refreshQuest(quest, f);
    return id;
  }

  /** Add a task and schedule it on a day (or keep it in the backlog with `day = null`). */
  async addTaskTo(quest: Quest, text: string, day: string | null, pos: plan.Position = "bottom"): Promise<string> {
    const id = await this.addTask(quest, text);
    const task = this.task(id);
    if (task && day) await this.moveToDay(task, day, pos);
    return id;
  }

  private async editTask(task: Task, fn: (content: string, line: number) => string): Promise<void> {
    await this.app.vault.process(this.file(task.questPath), (c) => {
      const line = md.locateTask(c, task);
      return line < 0 ? c : fn(c, line);
    });
  }

  async setDone(task: Task, done: boolean): Promise<void> {
    await this.editTask(task, (c, l) => md.setTaskDone(c, l, done, isoDay(new Date())));
    task.done = done;
    task.doneDate = done ? isoDay(new Date()) : null;
  }

  async renameTask(task: Task, text: string): Promise<void> {
    if (text.trim()) await this.editTask(task, (c, l) => md.setTaskText(c, l, text));
  }

  async deleteTask(task: Task): Promise<void> {
    await this.editTask(task, (c, l) => md.deleteLine(c, l));
    if (task.id) for (const d of this.days.values()) if (d.plan.includes(task.id)) await this.setPlan(d.day, d.plan.filter((x) => x !== task.id));
  }

  /** Give a task a stable id (written to the note) if it has none yet. */
  async ensureId(task: Task): Promise<string> {
    if (task.id) return task.id;
    const id = md.newId();
    await this.editTask(task, (c, l) => md.setTaskId(c, l, id));
    task.id = id;
    return id;
  }

  // ------------------------------------------------------------ stages

  /** A name fit for a stage heading: the quest-name clean-up, one line. Throws when nothing is left. */
  private stageName(name: string): string {
    const clean = name.replace(/[\\/:*?"<>|#^[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error(t("stage.nameEmpty"));
    return clean;
  }

  /** Index of the stage in fresh content; throws (so nothing is written) when it is gone. */
  private stageAt(content: string, stage: Pick<st.StageRef, "index" | "line" | "name">): number {
    const i = st.locateStage(content, stage);
    if (i < 0) throw new Error(t("stage.gone"));
    return i;
  }

  /** One `vault.process` on the quest note, then re-read it. A throw inside `fn` leaves the note unchanged. */
  private async editStages(quest: Quest, fn: (content: string) => string): Promise<void> {
    const f = await this.questFile(quest);
    await this.app.vault.process(f, fn);
    await this.refreshQuest(quest, f);
  }

  /** Append a stage. It starts today when it becomes the current one (no stage open before). */
  async addStage(quest: Quest, name: string, target: string | null = null): Promise<void> {
    const clean = this.stageName(name);
    await this.editStages(quest, (c) => {
      const stages = st.parseStages(c);
      if (se.nameTaken(stages, clean)) throw new Error(t("stage.exists", { name: clean }));
      const started = st.currentStage(stages) ? undefined : isoDay(new Date());
      return st.addStage(c, { name: clean, started, target: target ?? undefined }, this.sectionNames());
    });
  }

  async renameStage(quest: Quest, stage: st.StageRef, name: string): Promise<void> {
    const clean = this.stageName(name);
    await this.editStages(quest, (c) => {
      const i = this.stageAt(c, stage);
      if (se.nameTaken(st.parseStages(c), clean, i)) throw new Error(t("stage.exists", { name: clean }));
      return st.renameStage(c, i, clean);
    });
  }

  /** Write or (with null) remove 📅. */
  async setStageTarget(quest: Quest, stage: st.StageRef, target: string | null): Promise<void> {
    await this.editStages(quest, (c) => st.setStageDates(c, this.stageAt(c, stage), { target }));
  }

  async moveStage(quest: Quest, stage: st.StageRef, dir: -1 | 1): Promise<void> {
    await this.editStages(quest, (c) => se.moveStageStep(c, this.stageAt(c, stage), dir, isoDay(new Date())));
  }

  /** ✅ today; open tasks go to the next open stage or to the Tasks section. */
  async reachStage(quest: Quest, stage: st.StageRef, openTasks: "next" | "loose"): Promise<void> {
    await this.editStages(quest, (c) => se.reachStage(c, this.stageAt(c, stage), isoDay(new Date()), openTasks, this.sectionNames()));
  }

  async reopenStage(quest: Quest, stage: st.StageRef): Promise<void> {
    await this.editStages(quest, (c) => st.reopenStage(c, this.stageAt(c, stage)));
  }

  /** Remove the heading; every task of the stage moves unchanged to the Tasks section. */
  async deleteStage(quest: Quest, stage: st.StageRef): Promise<void> {
    await this.editStages(quest, (c) => se.deleteStageKeepTasks(c, this.stageAt(c, stage), isoDay(new Date()), this.sectionNames()));
  }

  /** Move a task line (with its indented children) to the end of a stage or of the Tasks section. */
  async moveTaskToStage(task: Task, target: st.StageRef | "loose"): Promise<void> {
    const quest = this.questOf(task);
    if (!quest) throw new Error(t("stage.gone"));
    await this.editStages(quest, (c) => {
      const line = md.locateTask(c, task);
      if (line < 0) throw new Error(t("stage.gone"));
      return st.moveTaskToStage(c, line, target === "loose" ? "loose" : this.stageAt(c, target), this.sectionNames());
    });
  }

  // ------------------------------------------------------------ plan

  async setPlan(day: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const f = await this.dayFile(day);
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      fm.plan = unique;
    });
    const d = this.days.get(day);
    if (d) d.plan = unique;
    else this.days.set(day, { ...emptyDay(f.path, day), plan: unique });
  }

  /** Schedule a task on a day at a position, or move it back to the backlog with `day = null`. */
  async moveToDay(task: Task, day: string | null, pos: plan.Position = "bottom"): Promise<void> {
    const id = await this.ensureId(task);
    const today = isoDay(new Date());
    const changes = plan.moveTask(this.planDays(), today, id, day, pos, (x) => x === id || this.isOpen(x));
    for (const [d, ids] of changes) await this.setPlan(d, ids);
  }

  // ------------------------------------------------------------ sessions

  async addSession(s: SessionInput): Promise<void> {
    const f = await this.dayFile(s.day);
    await this.app.vault.process(f, (c) => md.insertSession(c, t("md.sessions"), s));
  }

  async updateSession(old: Session, s: SessionInput): Promise<void> {
    if (old.day === s.day) {
      const f = this.file(this.days.get(old.day)?.path ?? "");
      await this.app.vault.process(f, (c) => md.replaceSession(c, t("md.sessions"), this.sessionLine(c, old), s));
    } else {
      await this.deleteSession(old);
      await this.addSession(s);
    }
  }

  async deleteSession(s: Session): Promise<void> {
    const d = this.days.get(s.day);
    if (!d) return;
    await this.app.vault.process(this.file(d.path), (c) => md.deleteLine(c, this.sessionLine(c, s)));
  }

  /** Where session `s` is in the note now; the remembered line can be stale right after another edit. */
  private sessionLine(content: string, s: Session): number {
    const i = md.findSessionLine(content, s);
    if (i < 0) throw new Error(t("session.gone"));
    return i;
  }

  /** Not-work time of a day, from its note. */
  breaksOf(day: string): Span[] {
    return this.days.get(day)?.breaks ?? [];
  }

  /** Mark a span of a day as not work time. */
  async addBreak(day: string, span: Span): Promise<void> {
    if (span.end <= span.start) return;
    const f = await this.dayFile(day);
    let breaks: Span[] = [];
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      // Entries we cannot read stay in the note; only the new span is added.
      const old: unknown[] = Array.isArray(fm.breaks) ? fm.breaks : typeof fm.breaks === "string" ? [fm.breaks] : [];
      const text = formatBreak(span);
      const next = old.includes(text) ? old : [...old, text];
      fm.breaks = next;
      breaks = parseBreaks(next);
    });
    const d = this.days.get(day);
    if (d) d.breaks = breaks;
    else this.days.set(day, { ...emptyDay(f.path, day), breaks });
  }

  // ------------------------------------------------------------ day fields (rituals)

  /**
   * Write day-note fields: clock times as "HH:MM" strings, `one_thing` as an id. `null` removes a key,
   * undefined leaves it. `keepStarted` keeps an existing `day_started`.
   */
  async updateDay(day: string, patch: { dayStarted?: number | null; oneThing?: string | null; dayClosed?: number | null }, keepStarted = false): Promise<void> {
    const f = await this.dayFile(day);
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      const set = (k: string, v: string | null | undefined) => {
        if (v === null) delete fm[k];
        else if (v !== undefined) fm[k] = v;
      };
      if (!(keepStarted && fmClock(fm.day_started) !== null)) set("day_started", clock(patch.dayStarted));
      set("one_thing", patch.oneThing === undefined ? undefined : patch.oneThing || null);
      set("day_closed", clock(patch.dayClosed));
    });
    const d = this.days.get(day) ?? emptyDay(f.path, day);
    if (patch.dayStarted !== undefined && !(keepStarted && d.dayStarted !== null)) d.dayStarted = patch.dayStarted;
    if (patch.oneThing !== undefined) d.oneThing = patch.oneThing ?? "";
    if (patch.dayClosed !== undefined) d.dayClosed = patch.dayClosed;
    this.days.set(day, d);
  }

  /** The `## Closing line` section (German heading kept when present). Newlines become spaces; empty removes it. */
  async setClosingLine(day: string, text: string): Promise<void> {
    const one = text.replace(/\s*\r?\n\s*/g, " ").trim();
    const d = this.days.get(day);
    if (!one && !d?.closingLine) return;
    const f = await this.dayFile(day);
    const heads = closingHeadings();
    await this.app.vault.process(f, (c) => md.writeSectionText(c, t("md.closingLine"), one, heads));
    const cur = this.days.get(day) ?? emptyDay(f.path, day);
    cur.closingLine = one;
    this.days.set(day, cur);
  }

  /** Hours planned for a quest in an ISO week: the week's `plan_hours` entry, else `weekly_hours`. */
  weekTarget(quest: Pick<Quest, "name" | "weeklyHours">, week: string): number {
    const h = this.reviews.get(week)?.planHours?.[quest.name];
    return typeof h === "number" && Number.isFinite(h) ? h : quest.weeklyHours;
  }

  planHours(week: string): Record<string, number> | null {
    return this.reviews.get(week)?.planHours ?? null;
  }

  /** Write `plan_hours` of a week note (created if missing); the map replaces the old one. */
  async savePlanHours(week: string, hours: Record<string, number>): Promise<void> {
    const f = await this.reviewFile(week);
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      fm.plan_hours = { ...hours };
    });
    const r = this.reviews.get(week);
    if (r) r.planHours = { ...hours };
    else this.reviews.set(week, { path: f.path, id: week, period: "week", week, answers: {}, planHours: { ...hours } });
  }

  // ------------------------------------------------------------ review

  async saveReview(week: string, answers: [string, string][], summary: Record<string, number | string>): Promise<TFile> {
    const f = await this.reviewFile(week);
    await this.app.vault.process(f, (c) => md.writeAnswers(c, t("md.reflection"), answers));
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      Object.assign(fm, summary);
    });
    return f;
  }

  /** Save a month, quarter or year review: answers under the reflection heading, `period` and the summary up front. */
  async savePeriodReview(id: string, period: Exclude<Period, "week">, answers: [string, string][], summary: Record<string, number | string>): Promise<TFile> {
    const f = await this.reviewFileFor(id, period);
    await this.app.vault.process(f, (c) => md.writeAnswers(c, t("md.reflection"), answers));
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      fm.type = "questlog-review";
      fm.period = period;
      Object.assign(fm, summary);
    });
    return f;
  }

  /** True when the weekly review for the week containing `day` has no answers yet. */
  reviewMissing(day: string): boolean {
    const r = this.reviews.get(isoWeek(day));
    return !r || !Object.values(r.answers).some((a) => a.trim());
  }
}

/** Answers under the reflection heading, whichever UI language wrote it (current language first). */
function readAnyAnswers(content: string): Record<string, string> {
  for (const h of [t("md.reflection"), ...variants("md.reflection")]) {
    const a = md.readAnswers(content, h);
    if (Object.keys(a).length) return a;
  }
  return {};
}

/** Closing-line headings in every language, current first. */
function closingHeadings(): string[] {
  return [...new Set([t("md.closingLine"), ...variants("md.closingLine")])];
}

function clock(v: number | null | undefined): string | null | undefined {
  return v === null || v === undefined ? v : fmtClock(v);
}

function emptyDay(path: string, day: string): DayLog {
  return { path, day, plan: [], breaks: [], sessions: [], dayStarted: null, oneThing: "", dayClosed: null, closingLine: "" };
}

/** Status and its dates in a frontmatter object; resuming a paused quest counts as a check-in. */
function applyStatus(fm: Record<string, unknown>, from: QuestStatus, to: QuestStatus, today: string): void {
  const dates = statusDates(from, to, today);
  for (const k of ["paused", "finished"] as const) {
    if (dates[k] === null) delete fm[k];
    else if (dates[k] !== undefined) fm[k] = dates[k];
  }
  if (from === "paused" && to === "active") fm.checked_in = today;
  fm.status = to;
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
