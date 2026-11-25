// Week dots: the rhythm of a quest over the last 12 weeks. Pure, no Obsidian imports.
import { addDays, weekStart } from "./dates";
import { dur } from "./stats";

export type Level = "full" | "partial" | "none";
export interface Dot {
  weekStart: string;
  level: Level;
  minutes: number;
  targetMinutes: number;
  current: boolean;
}
export type DotsSummary = null | { kind: "count"; weeks: number; of: number } | { kind: "quiet"; weeks: number } | { kind: "paused" };

export const DOT_WEEKS = 12;

export function minutesByWeekStart(sessions: { day: string; start: number; end: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const w = weekStart(s.day);
    m.set(w, (m.get(w) ?? 0) + dur(s));
  }
  return m;
}

/** Full at 75% of the target, or at 60 minutes without a target; partial for any time below. */
export function levelOf(minutes: number, targetMinutes: number): Level {
  if (minutes <= 0) return "none";
  const full = targetMinutes > 0 ? minutes * 4 >= targetMinutes * 3 : minutes >= 60;
  return full ? "full" : "partial";
}

export function weekDots(i: {
  today: string;
  status: "active" | "paused" | "done";
  created: string | null;
  firstSession: string | null;
  minutes: Map<string, number>;
  targetHours: (weekStart: string) => number;
}): { dots: Dot[]; summary: DotsSummary } {
  const start = i.created ?? i.firstSession;
  if (i.status === "done" || !start || start > i.today) return { dots: [], summary: null };
  const now = weekStart(i.today);
  const earliest = addDays(now, -7 * (DOT_WEEKS - 1));
  const first = weekStart(start) > earliest ? weekStart(start) : earliest;
  const dots: Dot[] = [];
  for (let w = first; w <= now; w = addDays(w, 7)) {
    const minutes = i.minutes.get(w) ?? 0;
    const targetMinutes = Math.max(0, Math.round(i.targetHours(w) * 60));
    dots.push({ weekStart: w, level: levelOf(minutes, targetMinutes), minutes, targetMinutes, current: w === now });
  }
  if (i.status === "paused") return { dots, summary: dots.length ? { kind: "paused" } : null };
  // The current week counts only when it has time; it is never a miss.
  const countable = dots.filter((d) => !d.current || d.minutes > 0);
  if (countable.length < 2) return { dots, summary: null };
  const nowHasTime = dots.some((d) => d.current && d.minutes > 0);
  if (!nowHasTime) {
    let quiet = 0;
    for (let k = dots.length - 2; k >= 0 && dots[k]!.minutes === 0; k--) quiet++;
    if (quiet >= 2) return { dots, summary: { kind: "quiet", weeks: quiet } };
  }
  return { dots, summary: { kind: "count", weeks: countable.filter((d) => d.minutes > 0).length, of: countable.length } };
}
