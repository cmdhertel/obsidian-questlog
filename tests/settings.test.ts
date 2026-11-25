import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/data/settings-merge";
import { formatDate } from "../src/i18n/format";

const defaults = {
  folder: "Questlog",
  rituals: { start: null, close: null, week: null, checkin: null } as Record<string, string | null>,
  checkinWeeks: 3,
  nudgeMinutes: 15,
  lastWork: null as { taskId: string; taskText: string; quest: string } | null,
};

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

  it("keeps unknown keys and survives non-object input", () => {
    expect(mergeSettings(defaults, { future: 1 })).toHaveProperty("future", 1);
    expect(mergeSettings(defaults, null)).toEqual(defaults);
    expect(mergeSettings(defaults, "x")).toEqual(defaults);
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
