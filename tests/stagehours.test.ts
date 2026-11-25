import { describe, expect, it } from "vitest";
import { stageMinutes } from "../src/data/stagehours";

const stages = [
  { index: 0, started: "2026-09-01", reached: "2026-09-28" },
  { index: 1, started: "2026-10-20", reached: null },
];
const tasks = [
  { id: "abc", stageIndex: 0 },
  { id: "def", stageIndex: 1 },
  { id: "ghi", stageIndex: null },
];
const s = (day: string, min: number, taskId = "") => ({ day, start: 600, end: 600 + min, taskId });

describe("stageMinutes", () => {
  it("matches the worked example", () => {
    const r = stageMinutes(stages, tasks, [
      s("2026-09-10", 60, "abc"),
      s("2026-10-22", 30, "def"),
      s("2026-09-15", 45),
      s("2026-10-25", 60, "zzz"),
      s("2026-10-05", 20),
      s("2026-10-30", 40, "ghi"),
    ]);
    expect(r.byStage.get(0)).toBe(105);
    expect(r.byStage.get(1)).toBe(90);
    expect(r.outside).toBe(60);
  });

  it("gives zeros for empty input", () => {
    const r = stageMinutes(stages, [], []);
    expect([...r.byStage.values()]).toEqual([0, 0]);
    expect(r.outside).toBe(0);
    expect(stageMinutes([], [], []).byStage.size).toBe(0);
  });

  it("gives a stage without 🛫 only task-based minutes", () => {
    const st = [{ index: 0, started: null, reached: null }];
    const r = stageMinutes(st, [{ id: "abc", stageIndex: 0 }], [s("2026-09-10", 60, "abc"), s("2026-09-10", 30)]);
    expect(r.byStage.get(0)).toBe(60);
    expect(r.outside).toBe(30);
  });

  it("gives an overlapping day to the first stage", () => {
    const st = [
      { index: 0, started: "2026-09-01", reached: "2026-10-05" },
      { index: 1, started: "2026-10-05", reached: null },
    ];
    const r = stageMinutes(st, [], [s("2026-10-05", 25)]);
    expect(r.byStage.get(0)).toBe(25);
    expect(r.byStage.get(1)).toBe(0);
  });

  it("uses the first task when an id repeats", () => {
    const r = stageMinutes(stages, [{ id: "abc", stageIndex: 1 }, { id: "abc", stageIndex: 0 }], [s("2026-09-10", 10, "abc")]);
    expect(r.byStage.get(1)).toBe(10);
  });
});
