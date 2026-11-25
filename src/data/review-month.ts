// Monthly review numbers: stages reached, targets for the month, last month's hours. Pure, no Obsidian imports.
import { daysBetween } from "./dates";
import { periodRange, shiftPeriod, type Range, type WeekSlice } from "./periods";
import { dur } from "./stats";

export interface ReachedStage {
  quest: string;
  index: number;
  name: string;
  reached: string;
  started: string | null;
}

/** Stages whose ✅ date lies in the range, by date then quest order. Planned (📅) but unreached stages are not listed. */
export function stagesReachedIn(
  quests: { name: string; stages: { index: number; name: string; started: string | null; reached: string | null }[] }[],
  r: Range,
): ReachedStage[] {
  const out: (ReachedStage & { order: number })[] = [];
  quests.forEach((q, order) => {
    for (const s of q.stages) {
      if (s.reached && s.reached >= r.start && s.reached <= r.end) {
        out.push({ quest: q.name, index: s.index, name: s.name, reached: s.reached, started: s.started, order });
      }
    }
  });
  out.sort((a, b) => a.reached.localeCompare(b.reached) || a.order - b.order || a.index - b.index);
  return out.map(({ order: _order, ...s }) => s);
}

/**
 * Hours planned per quest for the weeks of a period: each week's target (`weekTarget`, the week's plan or the quest's
 * weekly hours) times the days of the week inside the period / 7. Days before the quest's `created` day do not count.
 * One decimal.
 */
export function monthTargets(
  quests: { name: string; weeklyHours: number; created: string | null }[],
  weeks: WeekSlice[],
  weekTarget: (quest: { name: string; weeklyHours: number }, week: string) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of quests) {
    let h = 0;
    for (const w of weeks) {
      let days = w.days;
      if (q.created && q.created > w.start) {
        if (q.created > w.end) days = 0;
        else days = w.days - daysBetween(w.start, q.created);
      }
      if (days > 0) h += (weekTarget(q, w.week) * days) / 7;
    }
    out.set(q.name, Math.round(h * 10) / 10);
  }
  return out;
}

/** Minutes per quest in the month before `monthId` (January looks at the previous December). */
export function previousMonthHours(sessions: { day: string; start: number; end: number; quest: string }[], monthId: string): Map<string, number> {
  const out = new Map<string, number>();
  const r = periodRange(shiftPeriod(monthId, -1));
  if (!r) return out;
  for (const s of sessions) {
    if (s.day < r.start || s.day > r.end) continue;
    out.set(s.quest, (out.get(s.quest) ?? 0) + dur(s));
  }
  return out;
}
