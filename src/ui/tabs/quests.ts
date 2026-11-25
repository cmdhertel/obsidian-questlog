// Quests: the larger goals. Stat cards, a card grid (active / completed) and a detail page per quest.
import { setIcon } from "obsidian";
import { fmtHours, weekDays } from "../../data/dates";
import { minutesByQuest, totalMinutes } from "../../data/stats";
import type { Quest, QuestStatus, Session } from "../../data/model";
import { currentStage } from "../../data/stages";
import { t } from "../../i18n";
import type { Ctx } from "../ctx";
import { QuestModal } from "../modals";
import type { ContinueTarget } from "../../data/lastwork";
import { act, addTaskField, bar, button, dayHint, empty, iconButton, pageHead, pill, playButton, questIcon, sectionHead, segmented, statCard, taskRow } from "../components";
import { addStageDialog, compassLine, renderStagePath, stageLabel } from "../stagepath";
import { weekDotsView } from "../dots";
import { renderStory } from "../story";

/** Sessions grouped by quest name, read once per render. */
function sessionsByQuest(all: Session[]): Map<string, Session[]> {
  const m = new Map<string, Session[]>();
  for (const s of all) {
    const list = m.get(s.quest);
    if (list) list.push(s);
    else m.set(s.quest, [s]);
  }
  return m;
}

/** Open a quest page: done quests open on their story, the others on the path. */
function openQuest(ctx: Ctx, q: Quest): void {
  ctx.state.questOpen = q.path;
  ctx.state.questView = q.status === "done" ? "story" : "path";
  ctx.rerender();
}

export function renderQuests(el: HTMLElement, ctx: Ctx): void {
  const { store, state } = ctx;
  const open = state.questOpen ? store.quests.find((q) => q.path === state.questOpen) : undefined;
  if (open) return renderDetail(el, ctx, open);
  state.questOpen = null;

  const { plugin, today } = ctx;
  const week = minutesByQuest(store.sessions(weekDays(today)));
  const sessions = sessionsByQuest(store.allSessions());
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
  for (const q of list) card(grid, ctx, q, week.get(q.name) ?? 0, allTime.get(q.name) ?? 0, sessions.get(q.name) ?? []);
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

function card(parent: HTMLElement, ctx: Ctx, q: Quest, weekMin: number, allMin: number, sessions: Session[]): void {
  const c = parent.createDiv({ cls: "ql-qcard" + (q.status === "paused" ? " is-paused" : ""), attr: { role: "button", tabindex: "0" } });
  c.style.setProperty("--ql-color", q.color);
  const head = c.createDiv({ cls: "ql-qcard-head" });
  questIcon(head, q);
  const title = head.createDiv({ cls: "ql-qcard-title" });
  title.createDiv({ cls: "ql-qcard-name", text: q.name });
  if (q.status === "paused") pill(title, t("quests.paused"), { cls: "is-muted" });
  playButton(head, ctx, questTarget(ctx, q), { running: ctx.plugin.timer.isRunningForQuest(q.name), cls: "ql-qcard-play" });
  c.createDiv({ cls: "ql-qcard-why" + (q.why ? "" : " is-missing"), text: q.why || t("quest.noWhy") });
  if (q.stages.length) {
    const cur = currentStage(q.stages);
    c.createDiv({
      cls: "ql-qcard-stage",
      text: cur ? t("quest.stageOf", { i: cur.index + 1, n: q.stages.length, name: stageLabel(cur) }) : t("stage.allReached"),
    });
    if (cur) compassLine(c, ctx, q, cur, { actions: false });
  }

  const openTasks = q.tasks.filter((x) => !x.done).length;
  const foot = c.createDiv({ cls: "ql-qcard-foot" });
  if (q.status !== "done" && q.weeklyHours) {
    const w = foot.createDiv({ cls: "ql-qcard-week" });
    const l = w.createDiv({ cls: "ql-qcard-week-label" });
    l.createSpan({ text: t("quests.thisWeek") });
    l.createSpan({ cls: "ql-mono", text: `${fmtHours(weekMin)} / ${q.weeklyHours}h` });
    bar(w, weekMin, q.weeklyHours * 60, q.color);
  }
  weekDotsView(foot, ctx, q, sessions);
  const meta = foot.createDiv({ cls: "ql-qcard-meta" });
  meta.createSpan({ text: t("quest.openCount", { n: openTasks }) });
  meta.createSpan({ cls: "ql-mono", text: t("quest.total", { time: fmtHours(allMin) }) });

  const openIt = () => openQuest(ctx, q);
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

  const mine = store.allSessions().filter((s) => s.quest === q.name);
  const weekMin = totalMinutes(store.sessions(weekDays(today)).filter((s) => s.quest === q.name));
  const allMin = totalMinutes(mine);
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

  if (q.kind === "quest") {
    segmented(
      page,
      [
        { id: "path", label: t("story.path") },
        { id: "story", label: t("story.tab") },
      ],
      state.questView,
      (v) => {
        state.questView = v;
        ctx.rerender();
      },
    ).setAttr("aria-label", t("story.view"));
    if (state.questView === "story") return renderStory(page, ctx, q, mine);
  }

  const hasStages = q.stages.length > 0;
  if (hasStages) renderStagePath(page, ctx, q, mine);

  // Open tasks: all of them without stages, only the loose ones with stages.
  const noCurrent = hasStages && !currentStage(q.stages);
  const openTasks = q.tasks.filter((x) => !x.done && (!hasStages || x.stageIndex === null));
  if (!hasStages || openTasks.length || (noCurrent && q.status !== "done")) {
    const tc = page.createDiv({ cls: "ql-card ql-section" });
    sectionHead(tc, hasStages ? t("stage.loose") : t("quest.tasks"), "list-checks", String(openTasks.length));
    const list = tc.createDiv({ cls: "ql-list" });
    for (const x of openTasks) {
      const day = store.scheduledDay(x, today);
      taskRow(list, ctx, x, { hint: day ? dayHint(day, today) : undefined });
    }
    if (!openTasks.length) empty(list, t("home.questEmpty"), "list-checks");
    // With a current stage, new tasks go there; the loose list has no field of its own then.
    if (q.status !== "done" && (!hasStages || noCurrent)) addTaskField(tc, ctx, { quest: q, day: null, stateKey: `quest-${q.path}` });
    if (!hasStages && q.kind === "quest") {
      const b = button(tc, t("stage.addFirst"), () => addStageDialog(ctx, q), { icon: "milestone", cls: "ql-btn-plain ql-stage-first" });
      b.dataset.stageFocus = `${q.path}:add`;
    }
  }

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
