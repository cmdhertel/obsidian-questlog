import { describe, expect, it } from "vitest";
import { biggestShifts, quarterHours, questionsSeen, weeklyAnswersByMonth, type Quarters } from "../src/data/review-year";

const s = (day: string, quest: string, min: number) => ({ day, start: 600, end: 600 + min, quest });
const wk = (id: string, answers: Record<string, string>) => ({ id, period: "week", answers });

describe("yearly review", () => {
  it("puts sessions into calendar quarters of the year", () => {
    const h = quarterHours([s("2025-12-31", "A", 5), s("2026-03-31", "A", 10), s("2026-04-01", "A", 20), s("2026-12-31", "A", 40), s("2027-01-01", "A", 80)], 2026);
    expect(h.get("A")).toEqual([10, 20, 0, 40]);
  });

  it("finds the biggest shifts, largest first", () => {
    const h = new Map<string, Quarters>([
      ["Garden", [10, 12, 4, 4]],
      ["Travel", [6, 6, 8, 20]],
    ]);
    const r = biggestShifts(h);
    expect(r.map((x) => [x.quest, x.from, x.delta])).toEqual([
      ["Travel", 2, 12],
      ["Garden", 1, -8],
    ]);
    expect(biggestShifts(h, 1)).toHaveLength(1);
    expect(biggestShifts(new Map<string, Quarters>([["A", [0, 5, 0, 0]], ["B", [0, 3, 0, 0]]]))).toEqual([]);
  });

  it("breaks ties by quest order, then name", () => {
    const h = new Map<string, Quarters>([
      ["Zed", [0, 4, 0, 0]],
      ["Alpha", [4, 0, 0, 0]],
      ["Beta", [0, 0, 4, 0]],
    ]);
    expect(biggestShifts(h, 3, ["Zed"]).map((x) => x.quest)).toEqual(["Zed", "Alpha", "Beta"]);
  });

  it("groups weekly answers by the month of the week's Thursday", () => {
    const q = "Went well?";
    const reviews = [
      wk("2026-W01", { [q]: "new year" }),
      wk("2025-W52", { [q]: "old year" }),
      wk("2026-W05", { [q]: "  " }),
      wk("2026-W06", { [q]: "feb" }),
      wk("2026-W07", { other: "x" }),
      { id: "2026-02", period: "month", answers: { [q]: "month note" } },
    ];
    expect(weeklyAnswersByMonth(reviews, 2026, q)).toEqual([
      { month: "2026-02", answers: [{ week: "2026-W06", text: "feb" }] },
      { month: "2026-01", answers: [{ week: "2026-W01", text: "new year" }] },
    ]);
  });

  it("lists each question once with its count", () => {
    const reviews = [wk("2026-W10", { b: "1", a: "1" }), wk("2026-W11", { b: "2", c: "" }), wk("2025-W10", { z: "1" })];
    expect(questionsSeen(reviews, 2026)).toEqual([
      { question: "b", count: 2 },
      { question: "a", count: 1 },
    ]);
  });
});
