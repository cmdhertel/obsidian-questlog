// Pure aggregation over sessions and tasks (used by Home, Plan, Calendar and Review).
import type { Quest, Session, Task } from "./model";

export const dur = (s: Pick<Session, "start" | "end">): number => Math.max(0, s.end - s.start);

export function totalMinutes(sessions: Session[]): number {
  return sessions.reduce((a, s) => a + dur(s), 0);
}

export function minutesByQuest(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) m.set(s.quest, (m.get(s.quest) ?? 0) + dur(s));
  return m;
}

export function minutesByTask(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const key = s.taskId || `${s.quest}::${s.taskText}`;
    m.set(key, (m.get(key) ?? 0) + dur(s));
  }
  return m;
}

export function minutesByDay(sessions: Session[], days: string[]): number[] {
  return days.map((d) => totalMinutes(sessions.filter((s) => s.day === d)));
}

/** Tasks completed on one of the given days, newest first. */
export function doneTasks(quests: Quest[], days: string[]): Task[] {
  const set = new Set(days);
  return quests
    .flatMap((q) => q.tasks)
    .filter((t) => t.done && t.doneDate !== null && set.has(t.doneDate))
    .sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
}

/** Longest run of consecutive days (ending today or yesterday) with at least one session. */
export function streak(daysWithTime: Set<string>, today: string, addDays: (d: string, n: number) => string): number {
  let day = daysWithTime.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (daysWithTime.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export interface Lane {
  session: Session;
  lane: number;
  lanes: number;
}

/** Lay out overlapping sessions of one day side by side (for the calendar). */
export function layoutLanes(sessions: Session[]): Lane[] {
  const sorted = [...sessions].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Lane[] = [];
  let group: Lane[] = [];
  let groupEnd = -1;
  const close = () => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => (g.lanes = n));
    out.push(...group);
    group = [];
  };
  for (const s of sorted) {
    if (s.start >= groupEnd && group.length) close();
    const used = new Set(group.filter((g) => g.session.end > s.start).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ session: s, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, s.end);
  }
  if (group.length) close();
  return out;
}
