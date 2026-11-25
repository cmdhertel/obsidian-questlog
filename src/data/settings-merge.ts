import type { LastWork } from "./model";
import { NUDGE_OPTIONS } from "./nudge";

/** The keys of the settings that need more than a shallow merge. */
export interface MergeShape {
  rituals: Record<string, string | null>;
  checkinWeeks: number;
  nudgeMinutes: number;
  lastWork: LastWork | null;
}

/** A stored question list: strings only (trimmed, empty lines dropped); anything else means "use the defaults". */
function questionList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

/** The questions to ask: the stored list, or the defaults when it is null or empty. Pure. */
export function pickQuestions(stored: string[] | null | undefined, defaults: string[]): string[] {
  return stored?.length ? stored : defaults;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validLastWork(v: unknown): LastWork | null {
  if (!isRecord(v)) return null;
  const { taskId, taskText, quest } = v;
  return typeof taskId === "string" && typeof taskText === "string" && typeof quest === "string"
    ? { taskId, taskText, quest }
    : null;
}

/** Stored data over the defaults: `rituals` merged one level deep, wrong types fall back, unknown keys are kept. Pure. */
export function mergeSettings<T extends MergeShape>(defaults: T, stored: unknown): T {
  const data = isRecord(stored) ? stored : {};
  const rituals: Record<string, string | null> = { ...defaults.rituals };
  if (isRecord(data.rituals)) {
    for (const [k, v] of Object.entries(data.rituals)) {
      if (v === null || typeof v === "string") rituals[k] = v;
    }
  }
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const lists: Record<string, string[] | null> = {};
  for (const k of ["weeklyQuestions", "monthlyQuestions"]) if (k in data) lists[k] = questionList(data[k]);
  const nudge = (v: unknown, fallback: number) => (typeof v === "number" && NUDGE_OPTIONS.includes(v) ? v : fallback);
  return {
    ...defaults,
    ...data,
    ...lists,
    rituals,
    checkinWeeks: Math.min(8, Math.max(2, Math.round(num(data.checkinWeeks, defaults.checkinWeeks)))),
    nudgeMinutes: nudge(data.nudgeMinutes, defaults.nudgeMinutes),
    lastWork: validLastWork(data.lastWork),
  };
}
