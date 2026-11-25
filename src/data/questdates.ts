import type { QuestStatus } from "./model";
import { isoDay } from "./dates";

/** A frontmatter day as `YYYY-MM-DD`: strings are kept if valid, YAML date objects are formatted; anything else is null. */
export function fmDay(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoDay(v);
  if (typeof v === "string") {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(v.trim());
    return m && isoDay(new Date(`${m[0]}T00:00:00`)) === m[0] ? m[0] : null;
  }
  return null;
}

/** Frontmatter changes for a status change: a day sets the key, null removes it, undefined leaves it. No change, no patch. */
export function statusDates(
  from: QuestStatus,
  to: QuestStatus,
  today: string,
): { paused?: string | null; finished?: string | null } {
  if (from === to) return {};
  if (to === "paused") return { paused: today, finished: null };
  if (to === "done") return { finished: today };
  return { paused: null, finished: null };
}
