// Calendar: a week grid or a single day, filled from the focus timer. Click empty space to add time, a block to edit it.
// The Day / Week switch is remembered; "auto" shows one day on narrow panes and the week elsewhere.
import { addDays, fmtClock, fmtDuration, fmtHours, isoWeek, minutesOfDay, parseDay, weekDays } from "../../data/dates";
import { dur, totalMinutes } from "../../data/stats";
import { workTitle } from "../../data/timerlog";
import { weeklyTargetHours } from "../../settings";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { SessionModal } from "../modals";
import { button, dot, empty, iconButton, pageHead, questName, sectionHead, segmented } from "../components";
import { renderTimeline } from "../timeline";

export type CalendarView = "day" | "week";

/** The layout to show: the saved choice, or one day on narrow panes. */
export function calendarView(ctx: Ctx): CalendarView {
  const v = ctx.plugin.settings.calendarView;
  if (v === "day" || v === "week") return v;
  return ctx.width === "narrow" ? "day" : "week";
}

export function renderCalendar(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const view = calendarView(ctx);
  const single = view === "day";
  const week = weekDays(state.calendarDay);
  const days = single ? [state.calendarDay] : week;
  const weekSessions = store.sessions(week);
  const questMin = totalMinutes(weekSessions.filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  const first = parseDay(week[0]!);
  const last = parseDay(week[6]!);
  const fmt = (d: Date) => fmtDate(d, { day: "numeric", month: "short" });
  const title = single
    ? fmtDate(parseDay(state.calendarDay), { weekday: "long", day: "numeric", month: "long" })
    : `${fmt(first)} – ${fmt(last)}`;
  const actions = pageHead(el, title, `${t("common.week")} ${isoWeek(week[0]!).replace(/^\d{4}-W0?/, "")} · ${target ? t("cal.ofTarget", { h: fmtHours(questMin), target: `${target}h` }) : fmtHours(questMin)}`);

  const seg = segmented<CalendarView>(
    actions,
    [
      { id: "day", label: t("cal.day") },
      { id: "week", label: t("cal.week") },
    ],
    view,
    (v) => {
      plugin.settings.calendarView = v;
      void plugin.saveSettings();
      ctx.rerender();
    },
  );
  seg.addClass("ql-cal-switch");
  seg.setAttr("aria-label", t("cal.view"));

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

  if (single) {
    dayStrip(el, ctx, week);
    const wrap = el.createDiv({ cls: "ql-cal-day" });
    renderTimeline(wrap.createDiv({ cls: "ql-card ql-cal-card" }), ctx, days, { head: true, hourPx: 56 });
    dayList(wrap, ctx, state.calendarDay);
  } else {
    renderTimeline(el.createDiv({ cls: "ql-card ql-cal-card" }), ctx, days, { head: true });
  }
}

/** Seven small day buttons with their totals, to jump within the week in the day view. */
function dayStrip(el: HTMLElement, ctx: Ctx, week: string[]): void {
  const { store, state, today } = ctx;
  const sessions = store.sessions(week);
  const strip = el.createDiv({ cls: "ql-cal-strip", attr: { role: "group", "aria-label": t("common.week") } });
  for (const day of week) {
    const d = parseDay(day);
    const min = totalMinutes(sessions.filter((s) => s.day === day));
    const on = day === state.calendarDay;
    const b = strip.createEl("button", {
      cls: "ql-cal-strip-day" + (on ? " is-active" : "") + (day === today ? " is-today" : ""),
      attr: {
        "aria-pressed": String(on),
        "aria-label": `${fmtDate(d, { weekday: "long", day: "numeric", month: "long" })}${min ? `, ${fmtDuration(min)}` : ""}`,
      },
    });
    b.createSpan({ cls: "ql-cal-wd", text: fmtDate(d, { weekday: "short" }) });
    b.createSpan({ cls: "ql-cal-date", text: String(d.getDate()) });
    b.createSpan({ cls: "ql-cal-total ql-mono", text: min ? fmtDuration(min) : "" });
    b.onclick = () => {
      state.calendarDay = day;
      ctx.rerender();
    };
  }
}

/** The day's sessions as a list next to (or under) the grid: easier to read and to tap than small blocks. */
function dayList(el: HTMLElement, ctx: Ctx, day: string): void {
  const { store, plugin } = ctx;
  const sessions = store.sessions([day]).sort((a, b) => a.start - b.start);
  const card = el.createDiv({ cls: "ql-card ql-section ql-cal-daylist" });
  const total = totalMinutes(sessions);
  sectionHead(card, fmtDate(parseDay(day), { weekday: "long" }), "list", total ? fmtDuration(total) : undefined);
  if (!sessions.length) {
    empty(card, t("cal.dayEmpty"), "calendar-days");
    return;
  }
  const ul = card.createEl("ul", { cls: "ql-cal-sessions" });
  for (const s of sessions) {
    const q = store.quest(s.quest);
    const name = questName(q, s.quest);
    const title = workTitle(s.taskText, name);
    const li = ul.createEl("li");
    const b = li.createEl("button", { cls: "ql-cal-session" });
    b.style.setProperty("--ql-color", q?.color ?? "var(--text-faint)");
    b.createSpan({ cls: "ql-cal-session-time ql-mono", text: `${fmtClock(s.start)}–${fmtClock(s.end)}` });
    const main = b.createSpan({ cls: "ql-cal-session-main" });
    main.createSpan({ cls: "ql-cal-session-title", text: title });
    if (title !== name) {
      const qs = main.createSpan({ cls: "ql-task-quest" });
      dot(qs, q?.color ?? "var(--text-faint)");
      qs.createSpan({ text: name });
    }
    if (s.note) main.createSpan({ cls: "ql-cal-session-note ql-small ql-muted", text: s.note });
    b.createSpan({ cls: "ql-cal-session-dur ql-mono ql-muted", text: fmtDuration(dur(s)) });
    b.onclick = () => new SessionModal(plugin, s, s).open();
  }
}
