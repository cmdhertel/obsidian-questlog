// Local-time date helpers. Days are "YYYY-MM-DD" strings, times are minutes since midnight.

export const pad = (n: number): string => String(n).padStart(2, "0");

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const d = parseDay(day);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(day, -dow);
}

export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** ISO week id, e.g. "2026-W47". */
export function isoWeek(day: string): string {
  const d = parseDay(day);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${pad(week)}`;
}

/** First day (Monday) of an ISO week id. */
export function weekIdToDay(id: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return null;
  const jan4 = isoDay(new Date(Number(m[1]), 0, 4));
  return addDays(weekStart(jan4), (Number(m[2]) - 1) * 7);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtClock(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseClock(s: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** "2h 05m", "45m", "0m" */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${pad(m % 60)}m` : `${m}m`;
}

/** "1:02:03" or "02:03" for a running timer. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const rest = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return h > 0 ? `${h}:${rest}` : rest;
}

/**
 * Split a time span into per-day pieces (minutes since midnight, end exclusive, max 1440),
 * so a session running past midnight lands on both days.
 */
export function splitByDay(startMs: number, endMs: number): { day: string; start: number; end: number }[] {
  const out: { day: string; start: number; end: number }[] = [];
  let cur = new Date(startMs);
  const end = new Date(endMs);
  while (cur < end) {
    const day = isoDay(cur);
    const nextMidnight = parseDay(addDays(day, 1));
    const pieceEnd = end < nextMidnight ? end : nextMidnight;
    const s = minutesOfDay(cur);
    const e = pieceEnd === nextMidnight ? 1440 : minutesOfDay(pieceEnd);
    if (e > s) out.push({ day, start: s, end: e });
    cur = pieceEnd;
  }
  return out;
}

/** Hours for stats: "0h", "1.5h", "12h". */
export function fmtHours(min: number): string {
  const h = Math.max(0, min) / 60;
  if (h === 0) return "0h";
  const r = h < 10 ? Math.round(h * 10) / 10 : Math.round(h);
  return `${r}h`;
}
