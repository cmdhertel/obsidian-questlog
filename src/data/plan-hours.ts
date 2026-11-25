// `plan_hours` of a week note: hours per quest name for that week. Pure.

/** A map of quest name to finite number; non-numbers are dropped. Arrays, strings and absence give null. */
export function parsePlanHours(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Date) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  }
  return out;
}

/** The map with key `from` renamed to `to`, in the same position. Unchanged (same object) when `from` is absent. */
export function renameKey<T>(map: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in map) || from === to) return map;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === to) continue;
    out[k === from ? to : k] = v;
  }
  return out;
}
