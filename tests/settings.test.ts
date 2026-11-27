import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/data/settings-merge";
import { formatDate } from "../src/i18n/format";
import { MODULES, PRESETS, mergeModules, moduleOn, presetOf } from "../src/data/modules";

const defaults = {
  folder: "Questlog",
  rituals: { start: null, close: null, week: null, checkin: null } as Record<string, string | null>,
  checkinWeeks: 3,
  nudgeMinutes: 15,
  lastWork: null as { taskId: string; taskText: string; quest: string } | null,
  modules: { ...PRESETS.full },
};

describe("modules", () => {
  it("starts a fresh install with Standard and keeps an existing one on Full", () => {
    expect(mergeSettings(defaults, {}).modules).toEqual(PRESETS.standard);
    expect(mergeSettings(defaults, { folder: "X" }).modules).toEqual(PRESETS.full);
  });

  it("merges stored switches over the base and drops wrong types", () => {
    const m = mergeSettings(defaults, { folder: "X", modules: { plan: false, hours: "no", bogus: true } }).modules;
    expect(m).toEqual({ ...PRESETS.full, plan: false });
    expect(m).not.toHaveProperty("bogus");
    expect(mergeModules([], true)).toEqual(PRESETS.standard);
    expect(mergeModules({ vision: true }, true)).toEqual({ ...PRESETS.standard, vision: true });
  });

  it("does not share the preset objects", () => {
    const m = mergeModules(undefined, false);
    m.plan = false;
    expect(PRESETS.full.plan).toBe(true);
  });

  it("names the preset the switches match", () => {
    expect(presetOf(PRESETS.light)).toBe("light");
    expect(presetOf(PRESETS.standard)).toBe("standard");
    expect(presetOf(PRESETS.full)).toBe("full");
    expect(presetOf({ ...PRESETS.standard, vision: true })).toBe("custom");
  });

  it("has presets with every module and Light keeps the calendar only", () => {
    for (const p of Object.values(PRESETS)) expect(Object.keys(p).sort()).toEqual([...MODULES].sort());
    expect(MODULES.filter((k) => PRESETS.light[k])).toEqual(["calendar"]);
  });

  it("turns the longer reviews off with the review", () => {
    expect(moduleOn({ ...PRESETS.full, review: false }, "longReviews")).toBe(false);
    expect(moduleOn(PRESETS.full, "longReviews")).toBe(true);
  });
});

describe("mergeSettings", () => {
  it("fills missing keys with defaults", () => {
    const m = mergeSettings(defaults, { folder: "X" });
    expect(m).toEqual({ ...defaults, folder: "X" });
  });

  it("merges rituals one level deep and does not share the default object", () => {
    const m = mergeSettings(defaults, { rituals: { week: "2026-W10" } });
    expect(m.rituals).toEqual({ start: null, close: null, week: "2026-W10", checkin: null });
    expect(m.rituals).not.toBe(defaults.rituals);
    expect(defaults.rituals.week).toBeNull();
    expect(mergeSettings(defaults, {}).rituals).not.toBe(defaults.rituals);
  });

  it("replaces a wrong rituals type by the default", () => {
    for (const bad of ["x", 5, [], null]) expect(mergeSettings(defaults, { rituals: bad }).rituals).toEqual(defaults.rituals);
    expect(mergeSettings(defaults, { rituals: { start: 3 } }).rituals.start).toBeNull();
  });

  it("falls back for wrong types", () => {
    const m = mergeSettings(defaults, { checkinWeeks: "3", nudgeMinutes: NaN, lastWork: { taskId: 1 } });
    expect(m.checkinWeeks).toBe(3);
    expect(m.nudgeMinutes).toBe(15);
    expect(m.lastWork).toBeNull();
  });

  it("keeps valid values, including 0 for nudgeMinutes", () => {
    const lw = { taskId: "a", taskText: "b", quest: "c" };
    const m = mergeSettings(defaults, { nudgeMinutes: 0, checkinWeeks: 5, lastWork: lw });
    expect(m).toMatchObject({ nudgeMinutes: 0, checkinWeeks: 5, lastWork: lw });
  });

  it("keeps checkinWeeks between 2 and 8", () => {
    expect(mergeSettings(defaults, { checkinWeeks: 1 }).checkinWeeks).toBe(2);
    expect(mergeSettings(defaults, { checkinWeeks: 40 }).checkinWeeks).toBe(8);
  });

  it("normalises nudgeMinutes to the offered choices", () => {
    for (const bad of [12, -5, 600, 0.5, "15"]) expect(mergeSettings(defaults, { nudgeMinutes: bad }).nudgeMinutes).toBe(15);
    for (const ok of [0, 10, 15, 20, 30, 45]) expect(mergeSettings(defaults, { nudgeMinutes: ok }).nudgeMinutes).toBe(ok);
  });

  it("keeps unknown keys and survives non-object input", () => {
    expect(mergeSettings(defaults, { future: 1 })).toHaveProperty("future", 1);
    expect(mergeSettings(defaults, null)).toEqual({ ...defaults, modules: PRESETS.standard });
    expect(mergeSettings(defaults, "x")).toEqual({ ...defaults, modules: PRESETS.standard });
  });
});

describe("formatDate", () => {
  const d = new Date(2026, 2, 5);
  it("does not throw for en, de, en-gb or a bad tag", () => {
    for (const l of ["en", "de", "en-gb", "zh-cn", "not a locale!"]) {
      expect(() => formatDate(d, l, { day: "numeric", month: "short" })).not.toThrow();
    }
  });
  it("uses the given language", () => {
    expect(formatDate(d, "de", { month: "long" })).toBe("März");
  });
});

describe("question lists", () => {
  it("keeps string lists and drops wrong types", () => {
    expect((mergeSettings(defaults, { monthlyQuestions: [" a ", 3, ""] }) as Record<string, unknown>).monthlyQuestions).toEqual(["a"]);
    expect((mergeSettings(defaults, { monthlyQuestions: "x" }) as Record<string, unknown>).monthlyQuestions).toBeNull();
    expect("monthlyQuestions" in mergeSettings(defaults, {})).toBe(false);
  });
});
