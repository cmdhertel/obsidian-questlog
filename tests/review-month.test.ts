import { describe, expect, it } from "vitest";
import { monthTargets, previousMonthHours, stagesReachedIn } from "../src/data/review-month";
import { periodRange, weeksIn } from "../src/data/periods";
import { pickQuestions } from "../src/data/settings-merge";

const nov = periodRange("2026-11")!;
const stage = (index: number, reached: string | null, started: string | null = null) => ({ index, name: `S${index}`, started, reached });

describe("monthly review", () => {
  it("lists stages reached inside the month, both ends included", () => {
    const quests = [
      { name: "A", stages: [stage(0, "2026-10-31"), stage(1, "2026-11-01"), stage(2, "2026-11-30")] },
      { name: "B", stages: [stage(0, "2026-12-01"), stage(1, "2026-11-01")] },
    ];
    const r = stagesReachedIn(quests, nov);
    expect(r.map((s) => `${s.quest}:${s.index}:${s.reached}`)).toEqual(["A:1:2026-11-01", "B:1:2026-11-01", "A:2:2026-11-30"]);
  });

  it("leaves out unreached stages, even with a target date in the month", () => {
    // The target (📅) is not part of the input: only ✅ counts.
    expect(stagesReachedIn([{ name: "A", stages: [stage(0, null, "2026-11-02")] }], nov)).toEqual([]);
  });

  it("sums week targets over the month, clipped by days", () => {
    const q = { name: "A", weeklyHours: 8, created: null };
    const weeks = weeksIn("2026-11");
    expect(monthTargets([q], weeks, (x) => x.weeklyHours).get("A")).toBe(34.3);
    // One full week (W46, 9-15 Nov) planned at 4h: 8 * 23/7 + 4 = 30.3
    const plan = (x: { weeklyHours: number }, w: string) => (w === "2026-W46" ? 4 : x.weeklyHours);
    expect(monthTargets([q], weeks, plan).get("A")).toBe(30.3);
  });

  it("counts a new quest only from its created day", () => {
    const q = { name: "A", weeklyHours: 7, created: "2026-11-16" };
    expect(monthTargets([q], weeksIn("2026-11"), (x) => x.weeklyHours).get("A")).toBe(15);
    expect(monthTargets([{ ...q, created: "2026-12-05" }], weeksIn("2026-11"), (x) => x.weeklyHours).get("A")).toBe(0);
  });

  it("reads last month's hours; January looks at December", () => {
    const s = (day: string, quest: string, min: number) => ({ day, start: 600, end: 600 + min, quest });
    const sessions = [s("2025-12-31", "A", 60), s("2025-12-01", "A", 30), s("2026-01-02", "A", 90), s("2025-11-30", "B", 45)];
    const jan = previousMonthHours(sessions, "2026-01");
    expect(jan.get("A")).toBe(90);
    expect(jan.has("B")).toBe(false);
  });

  it("uses the stored questions, or the defaults for null and an empty list", () => {
    const d = ["a", "b", "c"];
    expect(pickQuestions(null, d)).toEqual(d);
    expect(pickQuestions([], d)).toEqual(d);
    expect(pickQuestions(["x"], d)).toEqual(["x"]);
  });
});
