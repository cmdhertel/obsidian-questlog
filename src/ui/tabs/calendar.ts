// Calendar: a week grid (one day on narrow panes) filled from the focus timer.
// Click empty space to add time, a block to edit it.
import { addDays, fmtHours, isoWeek, minutesOfDay, parseDay, weekDays } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import { weeklyTargetHours } from "../../settings";
import { t } from "../../i18n";
import type { Ctx } from "../ctx";
import { SessionModal } from "../modals";
import { button, iconButton, pageHead } from "../components";
import { renderTimeline } from "../timeline";

export function renderCalendar(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const single = ctx.width === "narrow";
  const week = weekDays(state.calendarDay);
  const days = single ? [state.calendarDay] : week;
  const weekSessions = store.sessions(week);
  const questMin = totalMinutes(weekSessions.filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  const first = parseDay(week[0]!);
  const last = parseDay(week[6]!);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const title = single
    ? parseDay(state.calendarDay).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : `${fmt(first)} – ${fmt(last)}`;
  const actions = pageHead(el, title, `${t("common.week")} ${isoWeek(week[0]!).replace(/^\d{4}-W0?/, "")} · ${target ? t("cal.ofTarget", { h: fmtHours(questMin), target: `${target}h` }) : fmtHours(questMin)}`);

  const step = single ? 1 : 7;
  const nav = actions.createDiv({ cls: "ql-navgroup" });
  iconButton(nav, "chevron-left", single ? t("nav.prevDay") : t("nav.prevWeek"), () => {
    state.calendarDay = addDays(state.calendarDay, -step);
    ctx.rerender();
  });
  button(nav, t("nav.today"), () => {
    state.calendarDay = today;
    ctx.rerender();
  }, { cls: days.includes(today) ? "is-current" : "" });
  iconButton(nav, "chevron-right", single ? t("nav.nextDay") : t("nav.nextWeek"), () => {
    state.calendarDay = addDays(state.calendarDay, step);
    ctx.rerender();
  });
  button(actions, t("cal.log"), () => {
    const now = minutesOfDay(new Date());
    const day = days.includes(today) ? today : days[0]!;
    new SessionModal(plugin, { day, start: Math.max(0, now - 60 - (now % 15)), end: Math.max(15, now - (now % 15)) }).open();
  }, { icon: "plus", cta: true });

  renderTimeline(el.createDiv({ cls: "ql-card ql-cal-card" }), ctx, days, { head: true });
}
