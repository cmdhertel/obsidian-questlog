// Time grid for one or more days, filled from logged sessions plus the running timer.
// Used by Calendar (week or single day) and the Home sidebar (today).
import { fmtClock, fmtDuration, isoDay, minutesOfDay, parseDay } from "../data/dates";
import { findGaps, gapSuggestions, hasFreeStretch, runningSpan, type GapItem } from "../data/gaps";
import { dur, layoutLanes, totalMinutes } from "../data/stats";
import type { Session } from "../data/model";
import { workTitle } from "../data/timerlog";
import { t, weekdayShort } from "../i18n";
import type { Ctx } from "./ctx";
import { SessionModal } from "./modals";
import { resolveContinueSession } from "../data/lastwork";
import { playButton, questName } from "./components";

export interface TimelineOpts {
  hourPx?: number;
  /** Show a header row with weekday, date and day total. */
  head?: boolean;
  /** Always show the whole day instead of the configured hours. */
  fullDay?: boolean;
  /** Draw unlogged stretches of today and yesterday (default true). */
  gaps?: boolean;
}

export function renderTimeline(el: HTMLElement, ctx: Ctx, days: string[], opts: TimelineOpts = {}): HTMLElement {
  const { store, plugin, today } = ctx;
  const hourPx = opts.hourPx ?? 48;
  const sessions = store.sessions(days);
  const running = plugin.settings.timer;
  const now = minutesOfDay(new Date());
  const yesterday = isoDay(new Date(parseDay(today).getFullYear(), parseDay(today).getMonth(), parseDay(today).getDate() - 1));

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

    if (opts.gaps !== false && (day === today || day === yesterday)) drawGaps(col, ctx, day, sessions.filter((s) => s.day === day), y);

    for (const { session, lane, lanes } of layoutLanes(sessions.filter((s) => s.day === day))) {
      block(col, ctx, session, y(session.start), y(session.end), lane, lanes, () => new SessionModal(plugin, session, session).open(), true);
    }

    if (running && day === today) {
      const start = minutesOfDay(new Date(Math.max(running.start, parseDay(today).getTime())));
      const live: Session = {
        day, start, end: Math.max(start + 1, now),
        taskText: running.taskText, quest: running.quest, taskId: running.taskId, note: "", line: -1,
      };
      block(col, ctx, live, y(live.start), y(live.end), 0, 1, () => ctx.view.showTab("focus"), false).addClass("is-live");
    }

    if (day === today && now >= from * 60 && now <= to * 60) col.createDiv({ cls: "ql-cal-now" }).style.top = `${y(now)}px`;
  }
  return cal;
}

function block(col: HTMLElement, ctx: Ctx, s: Session, top: number, bottom: number, lane: number, lanes: number, onClick: () => void, canPlay: boolean): HTMLElement {
  const q = ctx.store.quest(s.quest);
  const name = questName(q, s.quest);
  const b = col.createDiv({ cls: "ql-cal-block" + (q?.kind === "other" ? " is-other" : "") });
  b.style.setProperty("--ql-color", q?.color ?? "var(--text-faint)");
  b.style.top = `${top}px`;
  const height = Math.max(14, bottom - top - 2);
  b.style.height = `${height}px`;
  b.style.left = `calc(${(lane / lanes) * 100}% + 2px)`;
  b.style.width = `calc(${100 / lanes}% - 4px)`;
  const title = workTitle(s.taskText, name);
  // Without a task the title is already the quest name: show it once.
  const where = title === name ? "" : ` · ${name}`;
  b.setAttr("aria-label", `${fmtClock(s.start)}–${fmtClock(s.end)} · ${title}${where} (${fmtDuration(dur(s))})${s.note ? `\n${s.note}` : ""}`);
  b.createDiv({ cls: "ql-cal-block-title", text: title });
  if (bottom - top > 30) b.createDiv({ cls: "ql-cal-block-meta", text: `${fmtClock(s.start)}–${fmtClock(s.end)}${where}` });
  // Short blocks get no icon (the edit dialog has "Continue this work"); narrow lanes hide it in CSS.
  if (canPlay && height >= 40) {
    const play = playButton(b, ctx, resolveContinueSession(s, ctx.store), { cls: "ql-cal-block-play" });
    if (play) {
      b.addClass("has-play");
      // Keep the block's own edit click and any pointer handling of the grid away from the button.
      play.onpointerdown = (e) => e.stopPropagation();
    }
  }
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

/** Unlogged stretches (or one "Nothing logged" row) of today or yesterday, drawn under the sessions. */
function drawGaps(col: HTMLElement, ctx: Ctx, day: string, daySessions: Session[], y: (min: number) => number): void {
  const { store, plugin, today } = ctx;
  const winFrom = plugin.settings.calendarStartHour * 60;
  const winTo = plugin.settings.calendarEndHour * 60;
  const nowMs = Date.now();
  const now = day === today ? minutesOfDay(new Date(nowMs)) : undefined;
  if (now !== undefined && now < winFrom) return;
  const running = plugin.settings.timer;
  const run = running ? runningSpan(running.start, nowMs, day) : null;
  const covered = [...daySessions.map((s) => ({ start: s.start, end: s.end })), ...(run ? [run] : [])];
  const breaks = store.breaksOf(day);
  const items = () => suggestionsFor(ctx, day);
  const add = (start: number, end: number, cls: string, text: string, breakSpan?: { start: number; end: number }) => {
    const mins = end - start;
    const top = y(start);
    const g = col.createDiv({ cls: `ql-cal-gap ${cls}`.trim(), attr: { role: "button", tabindex: "0" } });
    g.style.top = `${top}px`;
    g.style.height = `${Math.max(20, y(end) - top)}px`;
    const label = text || t("gap.aria", { from: fmtClock(start), to: fmtClock(end), dur: fmtDuration(mins) });
    g.setAttr("aria-label", text ? `${text}. ${t("gap.add")}` : label);
    if (y(end) - top >= 30) g.createSpan({ cls: "ql-cal-gap-text", text: text || `${fmtClock(start)}–${fmtClock(end)} · ${t("gap.unlogged")} · ${fmtDuration(mins)}` });
    else if (y(end) - top >= 18) g.createSpan({ cls: "ql-cal-gap-text", text: text || t("gap.unlogged") });
    const open = () => {
      // A stretch that ended at "now" keeps growing until it is opened.
      const end2 = end === now && isoDay(new Date()) === day ? Math.max(end, Math.min(winTo, minutesOfDay(new Date()))) : end;
      new SessionModal(plugin, { day, start, end: end2, suggestions: items(), breakSpan }).open();
    };
    g.onclick = (e) => {
      e.stopPropagation();
      open();
    };
    g.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      open();
    };
  };
  if (covered.length === 0) {
    const to = now === undefined ? winTo : Math.min(winTo, now);
    if (to - winFrom < 15 || !hasFreeStretch({ from: winFrom, to: winTo, now, breaks })) return;
    add(winFrom, to, "is-empty", t("gap.nothing"), { start: winFrom, end: winTo });
    return;
  }
  for (const g of findGaps({ covered, from: winFrom, to: winTo, now, breaks })) {
    add(g.start, g.end, g.edge === "none" ? "" : "is-edge", "");
  }
}

function suggestionsFor(ctx: Ctx, day: string): GapItem[] {
  const { store, plugin } = ctx;
  const item = (x: { id: string; text: string; questPath: string } & Parameters<typeof store.questOf>[0]): GapItem | null => {
    const q = store.questOf(x);
    return q ? { quest: q.name, taskId: x.id, taskText: x.text } : null;
  };
  const list = (tasks: Parameters<typeof store.questOf>[0][]) => tasks.map((x) => item(x)).filter((x): x is GapItem => !!x);
  const last = plugin.settings.lastWork;
  return gapSuggestions({
    done: list(store.doneOn(day)),
    planned: list(day < ctx.today ? store.plannedOn(day) : store.dayTasks(day, ctx.today)),
    last: last ? { quest: last.quest, taskId: last.taskId, taskText: last.taskText } : undefined,
  });
}
