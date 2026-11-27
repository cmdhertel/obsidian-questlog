// Modules: the parts of Questlog that can be switched off for a lighter app. Switching a module off only hides
// it; notes, sessions, stages and reviews stay untouched. Pure, no Obsidian imports.

export const MODULES = [
  "plan",
  "calendar",
  "review",
  "longReviews",
  "hours",
  "stages",
  "vision",
  "ritualStart",
  "ritualClose",
  "ritualWeek",
  "ritualCheckin",
] as const;
export type ModuleId = (typeof MODULES)[number];
export type Modules = Record<ModuleId, boolean>;

export const PRESET_IDS = ["light", "standard", "full"] as const;
export type Preset = (typeof PRESET_IDS)[number];

const all = (on: boolean): Modules => Object.fromEntries(MODULES.map((m) => [m, on])) as Modules;

export const PRESETS: Record<Preset, Modules> = {
  /** Home, Focus and Calendar. */
  light: { ...all(false), calendar: true },
  /** Light plus Plan, the weekly review, hour targets and the rituals. */
  standard: {
    ...all(true),
    longReviews: false,
    stages: false,
    vision: false,
  },
  full: all(true),
};

/** The preset the switches match, or "custom". */
export function presetOf(m: Modules): Preset | "custom" {
  return PRESET_IDS.find((p) => MODULES.every((k) => PRESETS[p][k] === m[k])) ?? "custom";
}

/**
 * Stored switches over a base: a fresh install starts with Standard, an existing install without switches
 * (from before 2.2) keeps everything on. Unknown keys and non-booleans are dropped.
 */
export function mergeModules(stored: unknown, fresh: boolean): Modules {
  const base = { ...(fresh ? PRESETS.standard : PRESETS.full) };
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return base;
  for (const m of MODULES) {
    const v = (stored as Record<string, unknown>)[m];
    if (typeof v === "boolean") base[m] = v;
  }
  return base;
}

/** Whether a module is on; the longer reviews need the review. */
export function moduleOn(m: Modules, id: ModuleId): boolean {
  if (id === "longReviews") return m.longReviews && m.review;
  return m[id];
}
