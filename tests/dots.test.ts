import { describe, expect, it } from "vitest";
import { minutesByWeekStart, weekDots } from "../src/data/dots";

const today = "2026-11-24";
const m = (o: Record<string, number>) => new Map(Object.entries(o));
const run = (o: Partial<Parameters<typeof weekDots>[0]>) =>
  weekDots({ today, status: "active", created: null, firstSession: null, minutes: new Map(), targetHours: () => 8, ...o });
const levels = (r: ReturnType<typeof weekDots>) => r.dots.map((d) => d.level);

describe("weekDots", () => {
  const five = { "2026-10-26": 420, "2026-11-02": 0, "2026-11-09": 200, "2026-11-16": 360, "2026-11-23": 0 };

  it("levels and counts from created", () => {
    const r = run({ created: "2026-10-26", minutes: m(five) });
    expect(levels(r)).toEqual(["full", "none", "partial", "full", "none"]);
    expect(r.dots.map((d) => d.current)).toEqual([false, false, false, false, true]);
    expect(r.summary).toEqual({ kind: "count", weeks: 3, of: 4 });
    expect(levels(run({ created: "2026-10-26", minutes: m({ ...five, "2026-11-16": 359 }) }))[3]).toBe("partial");
  });

  it("counts the current week when it has time", () => {
    const r = run({ created: "2026-10-26", minutes: m({ ...five, "2026-11-23": 45 }) });
    expect(levels(r)[4]).toBe("partial");
    expect(r.summary).toEqual({ kind: "count", weeks: 4, of: 5 });
  });

  it("uses 60 minutes without a target", () => {
    const r = run({ created: "2026-11-09", targetHours: () => 0, minutes: m({ "2026-11-09": 59, "2026-11-16": 60 }) });
    expect(levels(r)).toEqual(["partial", "full", "none"]);
  });

  it("shows 12 weeks and a quiet stretch", () => {
    const r = run({ created: "2026-09-01", minutes: m({ "2026-09-28": 30 }) });
    expect(r.dots).toHaveLength(12);
    expect(r.dots[0]!.weekStart).toBe("2026-09-07");
    expect(r.summary).toEqual({ kind: "quiet", weeks: 7 });
  });

  it("says paused for a paused quest", () => {
    const r = run({ status: "paused", created: "2026-09-01", minutes: m({ "2026-09-28": 30 }) });
    expect(r.dots).toHaveLength(12);
    expect(r.summary).toEqual({ kind: "paused" });
  });

  it("has one dot and no text in the first week", () => {
    const r = run({ created: "2026-11-23" });
    expect(r.dots).toHaveLength(1);
    expect(r.summary).toBeNull();
  });

  it("starts at the first session without created", () => {
    const r = run({ firstSession: "2026-11-10", minutes: m({ "2026-11-09": 30 }) });
    expect(r.dots.map((d) => d.weekStart)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });

  it("is not quiet when the current week has time", () => {
    const r = run({ created: "2026-10-26", minutes: m({ "2026-10-26": 60, "2026-11-23": 30 }) });
    expect(r.summary).toEqual({ kind: "count", weeks: 2, of: 5 });
  });

  it("has no dots for done quests, nothing to start from, or a future start", () => {
    expect(run({ status: "done", created: "2026-09-01" }).dots).toEqual([]);
    expect(run({}).dots).toEqual([]);
    expect(run({ created: "2026-12-01" }).dots).toEqual([]);
  });
});

describe("minutesByWeekStart", () => {
  it("splits Sunday and Monday", () => {
    const r = minutesByWeekStart([
      { day: "2026-11-22", start: 600, end: 630 },
      { day: "2026-11-23", start: 600, end: 645 },
      { day: "2026-11-29", start: 0, end: 15 },
    ]);
    expect(r.get("2026-11-16")).toBe(30);
    expect(r.get("2026-11-23")).toBe(60);
  });
});
