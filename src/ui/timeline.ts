// Time grid for one or more days, filled from logged sessions plus the running timer.
// Used by Calendar (week or single day) and the Home sidebar (today).
import { fmtClock, fmtDuration, minutesOfDay, parseDay } from "../data/dates";
import { dur, layoutLanes, totalMinutes } from "../data/stats";
import type { Session } from "../data/model";
import { weekdayShort } from "../i18n";
import type { Ctx } from "./ctx";
import { SessionModal } from "./modals";
import { questName } from "./components";

export interface TimelineOpts {
  hourPx?: number;
  /** Show a header row with weekday, date and day total. */
  head?: boolean;
  /** Always show the whole day instead of the configured hours. */
  fullDay?: boolean;
}

export function renderTimeline(el: HTMLElement, ctx: Ctx, days: string[], opts: TimelineOpts = {}): HTMLElement {
  const { store, plugin, today } = ctx;
  const hourPx = opts.hourPx ?? 48;
  const sessions = store.sessions(days);
  const running = plugin.settings.timer;
  const now = minutesOfDay(new Date());

  // Visible hour range: settings, stretched to include any logged session and the running timer
  let from = opts.fullDay ? 0 : plugin.settings.calendarStartHour;
  let to = opts.fullDay ? 24 : plugin.settings.calendarEndHour;
  for (const s of sessions) {
    from = Math.min(from, Math.floor(s.start / 60));
    to = Math.max(to, Math.ceil(s.end / 60));
  }
  if (running && days.includes(today)) {
    from = Math.min(from, Math.floor(minutesOfDay(new Date(Math.max(running.start, parseDay(today).getTime()))) / 60));
    to = Math.max(to, Math.ceil((now + 1) / 60));
  }
  to = Math.min(24, Math.max(to, from + 1));

  const cal = el.createDiv({ cls: "ql-cal" + (days.length === 1 ? " is-single" : "") });
  cal.style.setProperty("--ql-hour", `${hourPx}px`);
  cal.style.setProperty("--ql-days", String(days.length));

  if (opts.head) {
    const headRow = cal.createDiv({ cls: "ql-cal-headrow" });
    headRow.createDiv({ cls: "ql-cal-gutter" });
    for (const day of days) {
      const d = parseDay(day);
      const h = headRow.createDiv({ cls: "ql-cal-dayhead" + (day === today ? " is-today" : "") });
      h.createSpan({ cls: "ql-cal-wd", text: weekdayShort(d) });
      h.createSpan({ cls: "ql-cal-date", text: String(d.getDate()) });
      const total = totalMinutes(sessions.filter((s) => s.day === day));
      h.createSpan({ cls: "ql-cal-total ql-mono", text: total ? fmtDuration(total) : "" });
    }
  }

  const body = cal.createDiv({ cls: "ql-cal-body" });
  const gutter = body.createDiv({ cls: "ql-cal-gutter" });
  gutter.style.height = `${(to - from) * hourPx}px`;
  for (let h = from; h < to; h++) gutter.createDiv({ cls: "ql-cal-hour ql-mono", text: `${String(h).padStart(2, "0")}:00` });

  const y = (min: number) => ((min - from * 60) / 60) * hourPx;
  for (const day of days) {
    const col = body.createDiv({ cls: "ql-cal-col" + (day === today ? " is-today" : "") });
    col.style.height = `${(to - from) * hourPx}px`;

    col.onclick = (e) => {
      if (e.target !== col) return;
      const rect = col.getBoundingClientRect();
      const min = from * 60 + Math.floor(((e.clientY - rect.top) / hourPx) * 4) * 15;
      new SessionModal(plugin, { day, start: min, end: Math.min(1440, min + 30) }).open();
    };

    for (const { session, lane, lanes } of layoutLanes(sessions.filter((s) => s.day === day))) {
      block(col, ctx, session, y(session.start), y(session.end), lane, lanes, () => new SessionModal(plugin, session, session).open());
    }

    if (running && day === today) {
      const start = minutesOfDay(new Date(Math.max(running.start, parseDay(today).getTime())));
      const live: Session = {
        day, start, end: Math.max(start + 1, now),
        taskText: running.taskText, quest: running.quest, taskId: running.taskId, note: "", line: -1,
      };
      block(col, ctx, live, y(live.start), y(live.end), 0, 1, () => ctx.view.showTab("focus")).addClass("is-live");
    }

    if (day === today && now >= from * 60 && now <= to * 60) col.createDiv({ cls: "ql-cal-now" }).style.top = `${y(now)}px`;
  }
  return cal;
}

function block(col: HTMLElement, ctx: Ctx, s: Session, top: number, bottom: number, lane: number, lanes: number, onClick: () => void): HTMLElement {
  const q = ctx.store.quest(s.quest);
  const name = questName(q, s.quest);
  const b = col.createDiv({ cls: "ql-cal-block" + (q?.kind === "other" ? " is-other" : "") });
  b.style.setProperty("--ql-color", q?.color ?? "var(--text-faint)");
  b.style.top = `${top}px`;
  b.style.height = `${Math.max(14, bottom - top - 2)}px`;
  b.style.left = `calc(${(lane / lanes) * 100}% + 2px)`;
  b.style.width = `calc(${100 / lanes}% - 4px)`;
  b.setAttr("aria-label", `${fmtClock(s.start)}–${fmtClock(s.end)} · ${s.taskText} · ${name} (${fmtDuration(dur(s))})${s.note ? `\n${s.note}` : ""}`);
  b.createDiv({ cls: "ql-cal-block-title", text: s.taskText });
  if (bottom - top > 30) b.createDiv({ cls: "ql-cal-block-meta", text: `${fmtClock(s.start)}–${fmtClock(s.end)} · ${name}` });
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}
