// Quests: the larger goals. Stat cards, a card grid (active / completed) and a detail page per quest.
import { setIcon } from "obsidian";
import { fmtHours, parseDay, weekDays } from "../../data/dates";
import { minutesByQuest, totalMinutes } from "../../data/stats";
import type { Quest, QuestStatus } from "../../data/model";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { QuestModal } from "../modals";
import type { ContinueTarget } from "../../data/lastwork";
import { act, addTaskField, bar, button, empty, iconButton, pageHead, pill, playButton, questIcon, sectionHead, segmented, statCard, taskRow } from "../components";

export function renderQuests(el: HTMLElement, ctx: Ctx): void {
  const { store, state } = ctx;
  const open = state.questOpen ? store.quests.find((q) => q.path === state.questOpen) : undefined;
  if (open) return renderDetail(el, ctx, open);
  state.questOpen = null;

  const { plugin, today } = ctx;
  const week = minutesByQuest(store.sessions(weekDays(today)));
  const allTime = minutesByQuest(store.allSessions());

  const actions = pageHead(el, t("tab.quests"), t("quests.sub"));
  button(actions, t("quest.new"), () => new QuestModal(plugin).open(), { icon: "plus", cta: true });

  const live = store.quests.filter((q) => q.status !== "done");
  const done = store.quests.filter((q) => q.status === "done");
  const stats = el.createDiv({ cls: "ql-stats" });
  statCard(stats, t("quests.active"), String(store.activeQuests().length), { icon: "flag" });
  statCard(stats, t("quests.done"), String(done.length), { icon: "trophy" });
  const weekQuest = totalMinutes(store.sessions(weekDays(today)).filter((s) => store.isQuestWork(s.quest)));
  statCard(stats, t("quests.thisWeek"), fmtHours(weekQuest), { icon: "timer" });

  segmented(
    el,
    [
      { id: "active", label: t("quests.active"), count: live.length },
      { id: "done", label: t("quests.done"), count: done.length },
    ],
    state.questsMode,
    (v) => {
      state.questsMode = v;
      ctx.rerender();
    },
  );

  const list = state.questsMode === "active" ? live : done;
  const grid = el.createDiv({ cls: "ql-qgrid" });
  for (const q of list) card(grid, ctx, q, week.get(q.name) ?? 0, allTime.get(q.name) ?? 0);
  if (state.questsMode === "active") {
    const n = grid.createEl("button", { cls: "ql-qcard ql-qcard-new" });
    setIcon(n.createSpan({ cls: "ql-qcard-new-icon" }), "plus");
    n.createSpan({ text: t("quest.new") });
    n.onclick = () => new QuestModal(plugin).open();
  } else if (!list.length) {
    empty(grid, t("quests.noneDone"), "trophy");
  }
}

/** Play on a quest starts it without a task; only active quests offer it. */
function questTarget(ctx: Ctx, q: Quest): ContinueTarget {
  return ctx.store.isWorkable(q) ? { kind: "quest", quest: q } : { kind: "none" };
}

function card(parent: HTMLElement, ctx: Ctx, q: Quest, weekMin: number, allMin: number): void {
  const c = parent.createDiv({ cls: "ql-qcard" + (q.status === "paused" ? " is-paused" : ""), attr: { role: "button", tabindex: "0" } });
  c.style.setProperty("--ql-color", q.color);
  const head = c.createDiv({ cls: "ql-qcard-head" });
  questIcon(head, q);
  const title = head.createDiv({ cls: "ql-qcard-title" });
  title.createDiv({ cls: "ql-qcard-name", text: q.name });
  if (q.status === "paused") pill(title, t("quests.paused"), { cls: "is-muted" });
  playButton(head, ctx, questTarget(ctx, q), { running: ctx.plugin.timer.isRunningForQuest(q.name), cls: "ql-qcard-play" });
  c.createDiv({ cls: "ql-qcard-why" + (q.why ? "" : " is-missing"), text: q.why || t("quest.noWhy") });

  const openTasks = q.tasks.filter((x) => !x.done).length;
  const foot = c.createDiv({ cls: "ql-qcard-foot" });
  if (q.status !== "done" && q.weeklyHours) {
    const w = foot.createDiv({ cls: "ql-qcard-week" });
    const l = w.createDiv({ cls: "ql-qcard-week-label" });
    l.createSpan({ text: t("quests.thisWeek") });
    l.createSpan({ cls: "ql-mono", text: `${fmtHours(weekMin)} / ${q.weeklyHours}h` });
    bar(w, weekMin, q.weeklyHours * 60, q.color);
  }
  const meta = foot.createDiv({ cls: "ql-qcard-meta" });
  meta.createSpan({ text: t("quest.openCount", { n: openTasks }) });
  meta.createSpan({ cls: "ql-mono", text: t("quest.total", { time: fmtHours(allMin) }) });

  const openIt = () => {
    ctx.state.questOpen = q.path;
    ctx.rerender();
  };
  c.onclick = openIt;
  c.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openIt();
    }
  };
}

function renderDetail(el: HTMLElement, ctx: Ctx, q: Quest): void {
  const { store, plugin, state, today } = ctx;
  const back = el.createDiv({ cls: "ql-back" });
  button(back, t("tab.quests"), () => {
    state.questOpen = null;
    ctx.rerender();
  }, { icon: "arrow-left", cls: "ql-btn-plain" });

  const page = el.createDiv({ cls: "ql-qdetail" });
  page.style.setProperty("--ql-color", q.color);
  const head = page.createDiv({ cls: "ql-qdetail-head" });
  questIcon(head, q, "is-large");
  const titles = head.createDiv({ cls: "ql-page-titles" });
  titles.createEl("h2", { cls: "ql-page-title", text: q.name });
  titles.createDiv({ cls: "ql-qcard-why" + (q.why ? "" : " is-missing"), text: q.why || t("quest.noWhy") });

  const actions = head.createDiv({ cls: "ql-page-actions" });
  playButton(actions, ctx, questTarget(ctx, q), { text: true, running: plugin.timer.isRunningForQuest(q.name), cls: "mod-cta" });
  iconButton(actions, "pencil", t("quest.edit"), () => new QuestModal(plugin, q).open());
  iconButton(actions, "file-text", t("task.openNote"), () => void plugin.app.workspace.openLinkText(q.path, "", false));
  if (q.status === "active") {
    iconButton(actions, "arrow-up", t("quest.moveUp"), act(() => store.moveQuest(q, -1)));
    iconButton(actions, "arrow-down", t("quest.moveDown"), act(() => store.moveQuest(q, 1)));
  }
  const next: Record<QuestStatus, [QuestStatus, string, string][]> = {
    active: [["paused", "pause", t("quest.pause")], ["done", "trophy", t("quest.complete")]],
    paused: [["active", "play", t("quest.resume")], ["done", "trophy", t("quest.complete")]],
    done: [["active", "rotate-ccw", t("quest.reopen")]],
  };
  for (const [to, icon, label] of next[q.status]) iconButton(actions, icon, label, act(() => store.updateQuest(q, { status: to })));

  const weekMin = totalMinutes(store.sessions(weekDays(today)).filter((s) => s.quest === q.name));
  const allMin = totalMinutes(store.allSessions().filter((s) => s.quest === q.name));
  const doneN = q.tasks.filter((x) => x.done).length;
  const stats = page.createDiv({ cls: "ql-stats" });
  statCard(stats, t("quests.thisWeek"), fmtHours(weekMin), {
    icon: "timer",
    sub: q.weeklyHours ? `/ ${q.weeklyHours}h` : undefined,
    progress: q.weeklyHours ? [weekMin, q.weeklyHours * 60] : undefined,
    color: q.color,
  });
  statCard(stats, t("quest.totalTime"), fmtHours(allMin), { icon: "hourglass" });
  statCard(stats, t("quest.progress"), `${doneN}/${q.tasks.length}`, { icon: "check-circle-2", progress: [doneN, Math.max(1, q.tasks.length)], color: q.color });

  // Open tasks
  const openTasks = q.tasks.filter((x) => !x.done);
  const tc = page.createDiv({ cls: "ql-card ql-section" });
  sectionHead(tc, t("quest.tasks"), "list-checks", String(openTasks.length));
  const list = tc.createDiv({ cls: "ql-list" });
  for (const x of openTasks) {
    const day = store.scheduledDay(x, today);
    taskRow(list, ctx, x, { hint: day ? dayHint(day, today) : undefined });
  }
  if (!openTasks.length) empty(list, t("home.questEmpty"), "list-checks");
  if (q.status !== "done") addTaskField(tc, ctx, { quest: q, day: null, stateKey: `quest-${q.path}` });

  // Done tasks (collapsible)
  const done = q.tasks.filter((x) => x.done).sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
  if (done.length) {
    const key = `done:${q.path}`;
    const isOpen = state.expanded.has(key);
    const dc = page.createDiv({ cls: "ql-card ql-section ql-collapsible" + (isOpen ? " is-open" : "") });
    const h = dc.createDiv({ cls: "ql-collapse-head", attr: { role: "button", tabindex: "0", "aria-expanded": String(isOpen) } });
    sectionHead(h, t("quest.doneTasks"), isOpen ? "chevron-down" : "chevron-right", String(done.length));
    h.onclick = () => {
      if (isOpen) state.expanded.delete(key);
      else state.expanded.add(key);
      ctx.rerender();
    };
    if (isOpen) {
      const dl = dc.createDiv({ cls: "ql-list" });
      for (const x of done) taskRow(dl, ctx, x, { compact: true });
    }
  }
}

function dayHint(day: string, today: string): string {
  if (day === today) return t("nav.today");
  const d = parseDay(day);
  return fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
}
