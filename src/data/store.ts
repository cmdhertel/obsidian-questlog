// Reads and writes quests, the Other inbox, day logs and reviews as Markdown notes, and keeps an in-memory index.
import { App, Events, TFile, TFolder, normalizePath } from "obsidian";
import type { QuestlogSettings } from "../settings";
import { t, variants } from "../i18n";
import { isoDay, isoWeek } from "./dates";
import * as md from "./markdown";
import * as plan from "./plan";
import type { DayLog, Quest, QuestStatus, Review, Session, Task } from "./model";

export const PALETTE = ["#7c6cf0", "#2f9e8f", "#e0823d", "#d04f7a", "#4a90d9", "#8a9a3b", "#b4637a", "#c9a227"];
/** Basename of the inbox note for non-quest tasks; sessions link to it as [[Other]]. */
export const OTHER = "Other";
export const OTHER_COLOR = "var(--text-faint)";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;

export type SessionInput = Pick<Session, "day" | "start" | "end" | "taskText" | "quest" | "taskId"> & { note?: string };
export type QuestPatch = Partial<Pick<Quest, "name" | "why" | "weeklyHours" | "color" | "icon" | "status" | "order">>;

export class QuestStore extends Events {
  quests: Quest[] = [];
  other: Quest;
  days = new Map<string, DayLog>();
  reviews = new Map<string, Review>();
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
  private kind(path: string): "quest" | "other" | "day" | "review" | null {
    if (!path.endsWith(".md")) return null;
    if (path === this.otherPath) return "other";
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir === this.questsDir) return "quest";
    if (dir === this.daysDir) return "day";
    if (dir === this.reviewsDir) return "review";
    return null;
  }

  private emptyOther(): Quest {
    return {
      path: this.otherPath, name: OTHER, kind: "other", status: "active", color: OTHER_COLOR,
      icon: "inbox", why: "", weeklyHours: 0, order: 0, tasks: [],
    };
  }

  // ------------------------------------------------------------ loading

  async reload(): Promise<void> {
    this.quests = [];
    this.other = this.emptyOther();
    this.days.clear();
    this.reviews.clear();
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
    if (kind === "quest") this.quests.push(this.toQuest(f, fm, content));
    else if (kind === "other") this.other = { ...this.emptyOther(), tasks: md.parseTasks(content, f.path) };
    else if (kind === "day" && DAY_RE.test(f.basename)) {
      this.days.set(f.basename, {
        path: f.path,
        day: f.basename,
        plan: arr(fm.plan),
        sessions: md.parseSessions(content, f.basename),
      });
    } else if (kind === "review" && WEEK_RE.test(f.basename)) {
      this.reviews.set(f.basename, { path: f.path, week: f.basename, answers: readAnyAnswers(content) });
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
      if (patch.status !== undefined) fm.status = patch.status;
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

  async addTask(quest: Quest, text: string): Promise<string> {
    const id = md.newId();
    const f = await this.questFile(quest);
    await this.app.vault.process(f, (c) => md.appendToSection(c, t("md.tasks"), md.taskLine(text, id)));
    // Make the new task visible to follow-up calls (plan, timer) before the metadata cache catches up.
    const tasks = md.parseTasks(await this.app.vault.read(f), f.path);
    if (quest.kind === "other") this.other = { ...this.other, path: f.path, tasks };
    else quest.tasks = tasks;
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

  // ------------------------------------------------------------ plan

  async setPlan(day: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const f = await this.dayFile(day);
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      fm.plan = unique;
    });
    const d = this.days.get(day);
    if (d) d.plan = unique;
    else this.days.set(day, { path: f.path, day, plan: unique, sessions: [] });
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
      await this.app.vault.process(f, (c) => md.replaceSession(c, t("md.sessions"), old.line, s));
    } else {
      await this.deleteSession(old);
      await this.addSession(s);
    }
  }

  async deleteSession(s: Session): Promise<void> {
    const d = this.days.get(s.day);
    if (!d) return;
    await this.app.vault.process(this.file(d.path), (c) => {
      const line = c.split("\n")[s.line] ?? "";
      return md.isSessionLine(line) ? md.deleteLine(c, s.line) : c;
    });
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
