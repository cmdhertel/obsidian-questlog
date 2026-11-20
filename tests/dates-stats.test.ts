import { describe, expect, it } from "vitest";
import * as d from "../src/data/dates";
import * as st from "../src/data/stats";
import type { Quest, Session } from "../src/data/model";

describe("dates", () => {
  it("computes ISO weeks, including year boundaries", () => {
    expect(d.isoWeek("2026-11-20")).toBe("2026-W47");
    expect(d.isoWeek("2027-01-01")).toBe("2026-W53");
    expect(d.isoWeek("2025-12-29")).toBe("2026-W01");
    expect(d.weekIdToDay("2026-W47")).toBe("2026-11-16");
    expect(d.weekIdToDay("2026-W01")).toBe("2025-12-29");
  });

  it("starts weeks on Monday", () => {
    expect(d.weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday
    expect(d.weekDays("2026-11-16")).toHaveLength(7);
  });

  it("formats and parses clock times and durations", () => {
    expect(d.fmtClock(555)).toBe("09:15");
    expect(d.parseClock("9.15")).toBe(555);
    expect(d.parseClock("24:00")).toBe(1440);
    expect(d.parseClock("24:01")).toBeNull();
    expect(d.fmtDuration(125)).toBe("2h 05m");
    expect(d.fmtDuration(45)).toBe("45m");
    expect(d.fmtElapsed(3723_000)).toBe("1:02:03");
    expect(d.fmtElapsed(83_000)).toBe("01:23");
  });

  it("splits a span across midnight", () => {
    const start = new Date(2026, 10, 20, 23, 30).getTime();
    const end = new Date(2026, 10, 21, 0, 45).getTime();
    expect(d.splitByDay(start, end)).toEqual([
      { day: "2026-11-20", start: 1410, end: 1440 },
      { day: "2026-11-21", start: 0, end: 45 },
    ]);
  });
});

const s = (day: string, start: number, end: number, quest: string, taskId = ""): Session => ({
  day, start, end, quest, taskId, taskText: "t", note: "", line: 0,
});

describe("stats", () => {
  const sessions = [s("2026-11-20", 60, 120, "A", "x"), s("2026-11-20", 100, 130, "B"), s("2026-11-21", 0, 30, "A", "x")];

  it("aggregates minutes", () => {
    expect(st.totalMinutes(sessions)).toBe(120);
    expect(Object.fromEntries(st.minutesByQuest(sessions))).toEqual({ A: 90, B: 30 });
    expect(st.minutesByTask(sessions).get("x")).toBe(90);
    expect(st.minutesByDay(sessions, ["2026-11-20", "2026-11-21", "2026-11-22"])).toEqual([90, 30, 0]);
  });

  it("finds done tasks in a range", () => {
    const q = { tasks: [
      { id: "1", text: "a", done: true, doneDate: "2026-11-20", line: 0, questPath: "" },
      { id: "2", text: "b", done: true, doneDate: "2026-11-01", line: 1, questPath: "" },
      { id: "3", text: "c", done: false, doneDate: null, line: 2, questPath: "" },
    ] } as Quest;
    expect(st.doneTasks([q], ["2026-11-20"]).map((t) => t.id)).toEqual(["1"]);
  });

  it("counts a streak ending today or yesterday", () => {
    const days = new Set(["2026-11-18", "2026-11-19"]);
    expect(st.streak(days, "2026-11-20", d.addDays)).toBe(2);
    expect(st.streak(days, "2026-11-22", d.addDays)).toBe(0);
  });

  it("lays out overlapping sessions in lanes", () => {
    const lanes = st.layoutLanes([s("d", 60, 120, "A"), s("d", 90, 150, "B"), s("d", 200, 210, "C")]);
    expect(lanes.map((l) => [l.session.quest, l.lane, l.lanes])).toEqual([["A", 0, 2], ["B", 1, 2], ["C", 0, 1]]);
  });
});
