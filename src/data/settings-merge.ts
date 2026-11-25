import type { LastWork } from "./model";

/** The keys of the settings that need more than a shallow merge. */
export interface MergeShape {
  rituals: Record<string, string | null>;
  checkinWeeks: number;
  nudgeMinutes: number;
  lastWork: LastWork | null;
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
  return {
    ...defaults,
    ...data,
    rituals,
    checkinWeeks: num(data.checkinWeeks, defaults.checkinWeeks),
    nudgeMinutes: num(data.nudgeMinutes, defaults.nudgeMinutes),
    lastWork: validLastWork(data.lastWork),
  };
}
