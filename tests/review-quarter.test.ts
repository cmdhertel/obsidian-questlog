import { describe, expect, it } from "vitest";
import { diffDecisions, parseHours, quarterRows, type DecisionInput } from "../src/data/review-quarter";
import { monthsIn, periodRange } from "../src/data/periods";

const s = (day: string, quest: string, min: number) => ({ day, start: 600, end: 600 + min, quest });
const q4 = periodRange("2026-Q4")!;
const months = monthsIn("2026-Q4");

describe("quarterly review", () => {
  it("splits quarter hours per month and leaves out days outside", () => {
    const quests = [{ name: "A", status: "active" as const, weeklyHours: 8 }];
    const sessions = [s("2026-09-30", "A", 60), s("2026-10-01", "A", 30), s("2026-11-15", "A", 45), s("2026-12-31", "A", 15), s("2027-01-01", "A", 60)];
    const [row] = quarterRows(quests, sessions, q4, months);
    expect(row!.minutes).toBe(90);
    expect(row!.byMonth).toEqual([
      ["2026-10", 30],
      ["2026-11", 45],
      ["2026-12", 15],
    ]);
  });

  it("keeps paused quests with time, drops done quests and quiet paused ones", () => {
    const quests = [
      { name: "P", status: "paused" as const, weeklyHours: 2 },
      { name: "Q", status: "paused" as const, weeklyHours: 2 },
      { name: "D", status: "done" as const, weeklyHours: 2 },
      { name: "A", status: "active" as const, weeklyHours: 2 },
    ];
    const rows = quarterRows(quests, [s("2026-10-03", "P", 30), s("2026-10-03", "D", 30)], q4, months);
    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual(["P:paused", "A:active"]);
  });

  it("turns decisions into patches, only where something differs", () => {
    const rows = [
      { name: "Keep", status: "active" as const, weeklyHours: 8 },
      { name: "Pause", status: "active" as const, weeklyHours: 8 },
      { name: "Resume", status: "paused" as const, weeklyHours: 8 },
      { name: "Hours", status: "active" as const, weeklyHours: 8 },
      { name: "Both", status: "active" as const, weeklyHours: 8 },
    ];
    const inputs = new Map<string, DecisionInput>([
      ["Keep", { decision: "keep", hours: "8" }],
      ["Pause", { decision: "pause", hours: "8" }],
      ["Resume", { decision: "resume", hours: "8" }],
      ["Hours", { decision: "keep", hours: "6" }],
      ["Both", { decision: "finish", hours: "3,5" }],
    ]);
    expect(diffDecisions(rows, inputs)).toEqual([
      { name: "Pause", patch: { status: "paused" } },
      { name: "Resume", patch: { status: "active" } },
      { name: "Hours", patch: { weeklyHours: 6 } },
      { name: "Both", patch: { status: "done", weeklyHours: 3.5 } },
    ]);
  });

  it("ignores invalid or negative hours", () => {
    const rows = [{ name: "A", status: "active" as const, weeklyHours: 8 }];
    expect(diffDecisions(rows, new Map([["A", { decision: "keep" as const, hours: "abc" }]]))).toEqual([]);
    expect(diffDecisions(rows, new Map([["A", { decision: "keep" as const, hours: "-2" }]]))).toEqual([]);
    expect(parseHours("0")).toBe(0);
    expect(parseHours("")).toBeNull();
  });
});
