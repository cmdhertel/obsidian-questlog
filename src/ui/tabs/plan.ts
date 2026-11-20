// Plan: the week board. Backlog on the left, one column per day. Drag tasks between columns or use the task menu.
// Unfinished tasks of past days roll over to today by themselves.
import { addDays, fmtHours, isoWeek, parseDay, weekDays } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import { weeklyTargetHours } from "../../settings";
import { t, weekdayShort } from "../../i18n";
import type { Ctx } from "../ctx";
import { addTaskField, button, dropTarget, empty, iconButton, pageHead, questIcon, questName, taskRow } from "../components";

export function renderPlan(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const days = weekDays(state.planDay);
  const sessions = store.sessions(days);
  const questMin = totalMinutes(sessions.filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  const actions = pageHead(
    el,
    t("plan.title"),
    `${t("common.week")} ${isoWeek(days[0]!).replace(/^\d{4}-W0?/, "")} · ${target ? t("cal.ofTarget", { h: fmtHours(questMin), target: `${target}h` }) : fmtHours(questMin)}`,
  );
  const nav = actions.createDiv({ cls: "ql-navgroup" });
  iconButton(nav, "chevron-left", t("nav.prevWeek"), () => {
    state.planDay = addDays(state.planDay, -7);
    ctx.rerender();
  });
  button(nav, t("nav.today"), () => {
    state.planDay = today;
    ctx.rerender();
  }, { cls: days.includes(today) ? "is-current" : "" });
  iconButton(nav, "chevron-right", t("nav.nextWeek"), () => {
    state.planDay = addDays(state.planDay, 7);
    ctx.rerender();
  });

  const board = el.createDiv({ cls: "ql-board", attr: { "data-scroll-key": "plan-board" } });
  const workable = store.workable();

  // Backlog column
  const bcol = board.createDiv({ cls: "ql-col ql-col-backlog" });
  const bh = bcol.createDiv({ cls: "ql-col-head" });
  bh.createSpan({ cls: "ql-col-title", text: t("plan.backlog") });
  const backlog = store.backlog();
  bh.createSpan({ cls: "ql-col-meta", text: String(backlog.length) });
  const blist = bcol.createDiv({ cls: "ql-list" });
  dropTarget(blist, ctx, null);
  for (const q of workable) {
    const tasks = backlog.filter((x) => x.questPath === q.path);
    if (!tasks.length) continue;
    const g = blist.createDiv({ cls: "ql-group-head" });
    questIcon(g, q, "is-small");
    g.createSpan({ text: questName(q) });
    for (const x of tasks) taskRow(blist, ctx, x, { day: null, compact: true });
  }
  if (!backlog.length) empty(blist, t("plan.backlogEmpty"), "archive");
  addTaskField(bcol, ctx, { quests: workable, defaultQuest: store.other, day: null, stateKey: "plan-backlog" });

  // Day columns
  for (const day of days) {
    const past = day < today;
    const col = board.createDiv({ cls: "ql-col" + (day === today ? " is-today" : "") + (past ? " is-past" : "") });
    const h = col.createDiv({ cls: "ql-col-head" });
    const d = parseDay(day);
    h.createSpan({ cls: "ql-col-title", text: day === today ? t("nav.today") : weekdayShort(d) });
    h.createSpan({ cls: "ql-col-date", text: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) });
    const min = totalMinutes(sessions.filter((s) => s.day === day));
    if (min) h.createSpan({ cls: "ql-col-meta ql-mono", text: fmtHours(min) });

    const list = col.createDiv({ cls: "ql-list" });
    const open = store.dayTasks(day, today);
    const done = store.doneOn(day);
    if (!past) {
      dropTarget(list, ctx, day);
      for (const x of open) taskRow(list, ctx, x, { showQuest: true, day, compact: true });
    }
    for (const x of done) taskRow(list, ctx, x, { showQuest: true, compact: true });
    if (!open.length && !done.length) empty(list, past ? t("plan.pastEmpty") : t("plan.dayEmpty"), past ? "moon" : "sun");
    if (!past) addTaskField(col, ctx, { quests: workable, defaultQuest: store.other, day, stateKey: `plan-${day}` });
  }
}
