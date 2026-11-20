// Week-board logic, kept pure for tests. A day note's `plan:` list is the source of truth.
// Unfinished tasks are carried forward virtually: a task whose latest planned day lies in the past
// shows up on today without rewriting any file. Moving or reordering it on today makes it explicit.

export interface PlanDay {
  day: string;
  plan: string[];
}

export type Position = "top" | "bottom" | number;

/** For each task id, the latest day it was planned for and its index there. */
export function latestPlanned(days: Iterable<PlanDay>): Map<string, { day: string; index: number }> {
  const out = new Map<string, { day: string; index: number }>();
  for (const d of days) {
    d.plan.forEach((id, index) => {
      const cur = out.get(id);
      if (!cur || cur.day < d.day) out.set(id, { day: d.day, index });
    });
  }
  return out;
}

/** Ids shown on a day, in order. Today = carried tasks (oldest first) + today's plan. Past days show nothing open. */
export function dayIds(days: PlanDay[], day: string, today: string, isOpen: (id: string) => boolean): string[] {
  if (day < today) return [];
  const own = (days.find((d) => d.day === day)?.plan ?? []).filter(isOpen);
  if (day > today) return [...new Set(own)];
  const carried = [...latestPlanned(days)]
    .filter(([id, p]) => p.day < today && isOpen(id))
    .sort((a, b) => a[1].day.localeCompare(b[1].day) || a[1].index - b[1].index)
    .map(([id]) => id);
  return [...new Set([...carried, ...own])];
}

/** True when the task is planned for today or a later day (incl. carried), i.e. not in the backlog. */
export function isScheduled(days: PlanDay[], id: string): boolean {
  return latestPlanned(days).has(id);
}

/**
 * Move a task to a day (or to the backlog with `target = null`) at a position.
 * Returns the new plan lists of every day that changes.
 */
export function moveTask(
  days: PlanDay[],
  today: string,
  id: string,
  target: string | null,
  pos: Position,
  isOpen: (id: string) => boolean,
): Map<string, string[]> {
  const changes = new Map<string, string[]>();
  for (const d of days) {
    if (!d.plan.includes(id) || d.day === target) continue;
    // Past plans only matter for carrying; drop them when the task leaves today's flow entirely.
    if (target === null || d.day >= today) {
      changes.set(d.day, d.plan.filter((x) => x !== id));
    }
  }
  if (target === null) return changes;
  const base = (target === today ? dayIds(days, today, today, isOpen) : (days.find((d) => d.day === target)?.plan ?? []).filter(isOpen)).filter(
    (x) => x !== id,
  );
  const at = pos === "top" ? 0 : pos === "bottom" ? base.length : Math.max(0, Math.min(base.length, pos));
  base.splice(at, 0, id);
  changes.set(target, base);
  return changes;
}
