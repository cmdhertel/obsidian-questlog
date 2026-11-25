// Review periods: ISO weeks, calendar months, calendar quarters and years. Pure, no Obsidian imports.
// Ids: "2026-W48", "2026-11", "2026-Q4", "2026". Ranges are days, both ends inclusive.
import { addDays, daysBetween, isoWeek, pad, weekIdToDay, weekStart } from "./dates";

export type Period = "week" | "month" | "quarter" | "year";
export const PERIODS: Period[] = ["week", "month", "quarter", "year"];

export interface Range {
  start: string;
  end: string;
}

export interface ParsedPeriod {
  period: Period;
  year: number;
  /** Week, month or quarter number; 0 for a year. */
  n: number;
}

/** Number of ISO weeks in an ISO year (52 or 53): the week of 28 December. */
export function isoWeeksInYear(year: number): number {
  return Number(isoWeek(`${year}-12-28`).slice(-2));
}

/** The id of the period of `period` that contains `day`. */
export function periodId(period: Period, day: string): string {
  const y = day.slice(0, 4);
  const m = Number(day.slice(5, 7));
  switch (period) {
    case "week":
      return isoWeek(day);
    case "month":
      return day.slice(0, 7);
    case "quarter":
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case "year":
      return y;
  }
}

/** Period, year and number of an id; null for anything that is not a real period (`2026-13`, `2026-Q5`, `2026-W54`). */
export function parsePeriodId(id: string): ParsedPeriod | null {
  let m = /^(\d{4})$/.exec(id);
  if (m) return { period: "year", year: Number(m[1]), n: 0 };
  m = /^(\d{4})-(\d{2})$/.exec(id);
  if (m) {
    const n = Number(m[2]);
    return n >= 1 && n <= 12 ? { period: "month", year: Number(m[1]), n } : null;
  }
  m = /^(\d{4})-Q(\d)$/.exec(id);
  if (m) {
    const n = Number(m[2]);
    return n >= 1 && n <= 4 ? { period: "quarter", year: Number(m[1]), n } : null;
  }
  m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (m) {
    const year = Number(m[1]);
    const n = Number(m[2]);
    return n >= 1 && n <= isoWeeksInYear(year) ? { period: "week", year, n } : null;
  }
  return null;
}

function monthStart(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}

/** Last day of a month (1-12). */
function monthEnd(year: number, month: number): string {
  return month === 12 ? `${year}-12-31` : addDays(monthStart(year, month + 1), -1);
}

/** First and last day of a period; null for an invalid id. */
export function periodRange(id: string): Range | null {
  const p = parsePeriodId(id);
  if (!p) return null;
  switch (p.period) {
    case "week": {
      const start = weekIdToDay(id);
      return start ? { start, end: addDays(start, 6) } : null;
    }
    case "month":
      return { start: monthStart(p.year, p.n), end: monthEnd(p.year, p.n) };
    case "quarter":
      return { start: monthStart(p.year, (p.n - 1) * 3 + 1), end: monthEnd(p.year, p.n * 3) };
    case "year":
      return { start: `${p.year}-01-01`, end: `${p.year}-12-31` };
  }
}

/** The period `n` steps after (negative: before) `id`, of the same kind. Invalid ids come back unchanged. */
export function shiftPeriod(id: string, n: number): string {
  const p = parsePeriodId(id);
  if (!p) return id;
  switch (p.period) {
    case "week":
      return isoWeek(addDays(weekIdToDay(id) ?? "1970-01-05", 7 * n));
    case "month": {
      const i = p.year * 12 + (p.n - 1) + n;
      return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
    }
    case "quarter": {
      const i = p.year * 4 + (p.n - 1) + n;
      return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
    }
    case "year":
      return String(p.year + n);
  }
}

/** Number of days in a period (0 for an invalid id). */
export function periodDays(id: string): number {
  const r = periodRange(id);
  return r ? daysBetween(r.start, r.end) + 1 : 0;
}

/** Every day of a range, in order. */
export function daysOf(r: Range): string[] {
  const n = daysBetween(r.start, r.end) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(r.start, i));
}

export interface WeekSlice {
  /** ISO week id. */
  week: string;
  /** First and last day of the week inside the range. */
  start: string;
  end: string;
  /** Days of the week inside the range (1-7). */
  days: number;
}

/** ISO weeks that overlap a period, clipped to it, with the number of days inside. */
export function weeksIn(id: string): WeekSlice[] {
  const r = periodRange(id);
  return r ? weeksInRange(r) : [];
}

export function weeksInRange(r: Range): WeekSlice[] {
  const out: WeekSlice[] = [];
  for (let mon = weekStart(r.start); mon <= r.end; mon = addDays(mon, 7)) {
    const start = mon < r.start ? r.start : mon;
    const sun = addDays(mon, 6);
    const end = sun > r.end ? r.end : sun;
    out.push({ week: isoWeek(mon), start, end, days: daysBetween(start, end) + 1 });
  }
  return out;
}

/** Month ids inside a period, in order. */
export function monthsIn(id: string): string[] {
  const r = periodRange(id);
  if (!r) return [];
  const out: string[] = [];
  for (let m = r.start.slice(0, 7); m <= r.end.slice(0, 7); m = shiftPeriod(m, 1)) out.push(m);
  return out;
}

/** A weekly target spread over `days` days, one decimal: 20h a week over 30 days is 85.7h. */
export function scaleTarget(weeklyHours: number, days: number): number {
  return Math.round(((weeklyHours * days) / 7) * 10) / 10;
}

/** The month a weekly id belongs to: the month of its Thursday, as ISO weeks belong to years. */
export function monthOfWeek(weekId: string): string | null {
  const mon = weekIdToDay(weekId);
  return mon ? addDays(mon, 3).slice(0, 7) : null;
}
