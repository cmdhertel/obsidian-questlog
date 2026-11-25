import { describe, expect, it } from "vitest";
import { compass } from "../src/data/compass";
import { daysBetween } from "../src/data/dates";

const base = { today: "2026-11-24", target: "2026-12-15", started: "2026-10-20" };
const days = (n: number, from = "2026-11-0") => Array.from({ length: n }, (_, i) => `${from}${i + 1}`);
const pace = (r: ReturnType<typeof compass>) => (r && r.kind === "left" ? r.pace : "none");

describe("compass", () => {
  it("is tight with 8 done and 10 open", () => {
    const r = compass({ ...base, openTasks: 10, doneDates: days(8) });
    expect(r).toMatchObject({ kind: "left", daysLeft: 21, pace: "tight", done: 8, winDays: 28 });
  });
  it("fits with 8 done and 5 open", () => {
    expect(pace(compass({ ...base, openTasks: 5, doneDates: days(8) }))).toBe("fits");
  });
  it("counts equal as fits", () => {
    expect(pace(compass({ ...base, openTasks: 3, doneDates: days(4) }))).toBe("fits");
  });
  it("splits 7 done at 6 and 5 open", () => {
    expect(pace(compass({ ...base, openTasks: 6, doneDates: days(7) }))).toBe("tight");
    expect(pace(compass({ ...base, openTasks: 5, doneDates: days(7) }))).toBe("fits");
  });
  it("has no pace for a stage younger than 7 days", () => {
    const r = compass({ ...base, started: "2026-11-20", openTasks: 1, doneDates: ["2026-11-21", "2026-11-22", "2026-11-23"] });
    expect(r).toMatchObject({ kind: "left", daysLeft: 21, pace: null, winDays: 5 });
  });
  it("has a pace at exactly 7 days", () => {
    expect(pace(compass({ ...base, started: "2026-11-18", openTasks: 1, doneDates: ["2026-11-19", "2026-11-20"] }))).toBe("fits");
  });
  it("needs two done tasks", () => {
    expect(pace(compass({ ...base, openTasks: 1, doneDates: ["2026-11-19"] }))).toBeNull();
  });
  it("counts only done dates in the window", () => {
    const r = compass({ ...base, openTasks: 10, doneDates: [...days(8), "2026-10-27"] });
    expect(r).toMatchObject({ done: 8 });
    expect(compass({ ...base, openTasks: 0, doneDates: ["2026-10-27", "2026-11-25"] })).toMatchObject({ done: 0, pace: null });
  });
  it("uses the full window without 🛫", () => {
    expect(compass({ ...base, started: null, openTasks: 1, doneDates: days(2) })).toMatchObject({ winDays: 28, pace: "fits" });
  });
  it("is due today on the target date", () => {
    const t = { ...base, today: "2026-12-15", doneDates: ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"] };
    expect(compass({ ...t, openTasks: 0 })).toMatchObject({ kind: "left", daysLeft: 0, pace: "fits" });
    expect(compass({ ...t, openTasks: 1 })).toMatchObject({ kind: "left", daysLeft: 0, pace: "tight" });
  });
  it("has passed the day after", () => {
    expect(compass({ ...base, today: "2026-12-16", openTasks: 1, doneDates: [] })).toEqual({ kind: "passed", daysAgo: 1 });
  });
  it("is null without a target", () => {
    expect(compass({ ...base, target: null, openTasks: 1, doneDates: [] })).toBeNull();
  });
  it("has no pace when 🛫 is in the future", () => {
    expect(compass({ ...base, started: "2026-11-30", openTasks: 0, doneDates: days(5) })).toMatchObject({ pace: null, done: 0 });
  });
});

describe("daysBetween", () => {
  it("counts whole days, also across the DST change", () => {
    // Clocks go back in Europe on 2026-10-25 and forward on 2026-03-29.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-12-16", "2026-12-15")).toBe(-1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });
});
