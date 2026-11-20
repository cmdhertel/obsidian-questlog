import { describe, expect, it } from "vitest";
import { dayIds, isScheduled, latestPlanned, moveTask, type PlanDay } from "../src/data/plan";

const TODAY = "2026-11-20";
const open = (done: string[] = []) => (id: string) => !done.includes(id);

describe("week board", () => {
  const days: PlanDay[] = [
    { day: "2026-11-18", plan: ["a", "b"] },
    { day: "2026-11-19", plan: ["c", "a"] },
    { day: TODAY, plan: ["d"] },
    { day: "2026-11-22", plan: ["e"] },
  ];

  it("finds the latest planned day of each task", () => {
    const m = latestPlanned(days);
    expect(m.get("a")).toEqual({ day: "2026-11-19", index: 1 });
    expect(m.get("b")).toEqual({ day: "2026-11-18", index: 1 });
  });

  it("carries unfinished tasks of past days to today, oldest first", () => {
    expect(dayIds(days, TODAY, TODAY, open())).toEqual(["b", "c", "a", "d"]);
    expect(dayIds(days, TODAY, TODAY, open(["b"]))).toEqual(["c", "a", "d"]);
  });

  it("shows no open tasks on past days and only the own plan on future days", () => {
    expect(dayIds(days, "2026-11-19", TODAY, open())).toEqual([]);
    expect(dayIds(days, "2026-11-22", TODAY, open())).toEqual(["e"]);
  });

  it("knows what is scheduled", () => {
    expect(isScheduled(days, "a")).toBe(true);
    expect(isScheduled(days, "z")).toBe(false);
  });

  it("moves a task to a future day and keeps past plans for history", () => {
    const ch = moveTask(days, TODAY, "d", "2026-11-22", "top", open());
    expect(ch.get(TODAY)).toEqual([]);
    expect(ch.get("2026-11-22")).toEqual(["d", "e"]);
    expect(ch.has("2026-11-18")).toBe(false);
  });

  it("reordering on today makes carried tasks explicit", () => {
    const ch = moveTask(days, TODAY, "d", TODAY, 0, open());
    expect(ch.get(TODAY)).toEqual(["d", "b", "c", "a"]);
  });

  it("moving a carried task to a later day takes it off today", () => {
    const ch = moveTask(days, TODAY, "a", "2026-11-21", "bottom", open());
    expect(ch.get("2026-11-21")).toEqual(["a"]);
    const after = days.map((d) => ({ day: d.day, plan: ch.get(d.day) ?? d.plan })).concat([{ day: "2026-11-21", plan: ["a"] }]);
    expect(dayIds(after, TODAY, TODAY, open())).toEqual(["b", "c", "d"]);
  });

  it("back to backlog removes the task everywhere", () => {
    const ch = moveTask(days, TODAY, "a", null, "bottom", open());
    expect(ch.get("2026-11-18")).toEqual(["b"]);
    expect(ch.get("2026-11-19")).toEqual(["c"]);
    const after = days.map((d) => ({ day: d.day, plan: ch.get(d.day) ?? d.plan }));
    expect(isScheduled(after, "a")).toBe(false);
  });
});
