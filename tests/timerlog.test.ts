import { describe, expect, it } from "vitest";
import { runToSessions, workTitle } from "../src/data/timerlog";
import type { RunningTimer } from "../src/data/model";
import { parseSessions, sessionLine } from "../src/data/markdown";

const at = (h: number, m: number, d = 20) => new Date(2026, 10, d, h, m, 0).getTime();
const run = (start: number, over: Partial<RunningTimer> = {}): RunningTimer => ({
  taskId: "abc123", taskText: "Draft", quest: "Travel book", start, box: 0, note: "", ...over,
});

describe("runToSessions", () => {
  it("logs a 40 minute run as one session", () => {
    const s = runToSessions(run(at(9, 0)), at(9, 40), 1);
    expect(s).toEqual([{ day: "2026-11-20", start: 540, end: 580, taskText: "Draft", quest: "Travel book", taskId: "abc123", note: "" }]);
  });
  it("logs nothing under the minimum, and never under one minute", () => {
    expect(runToSessions(run(at(9, 0)), at(9, 4), 5)).toEqual([]);
    expect(runToSessions(run(at(9, 0)), at(9, 0) + 30_000, 0)).toEqual([]);
    expect(runToSessions(run(at(9, 0)), at(9, 5), 5)).toHaveLength(1);
  });
  it("splits a run over midnight", () => {
    const s = runToSessions(run(at(23, 50)), at(0, 20, 21), 1);
    expect(s.map((x) => [x.day, x.start, x.end])).toEqual([["2026-11-20", 1430, 1440], ["2026-11-21", 0, 20]]);
  });
  it("prefers the resolved text and quest", () => {
    const s = runToSessions(run(at(9, 0)), at(9, 30), 1, { text: "Renamed", quest: "Journeys" });
    expect(s[0]).toMatchObject({ taskText: "Renamed", quest: "Journeys" });
  });
  it("keeps an empty text for a quest-only run and writes the dash", () => {
    const s = runToSessions(run(at(9, 0), { taskId: "", taskText: "", note: "idea" }), at(9, 40), 1);
    expect(s[0]).toMatchObject({ taskId: "", taskText: "", note: "idea" });
    const line = sessionLine(s[0]!);
    expect(line).toBe("- 09:00–09:40 — · [[Travel book]] — idea");
    expect(parseSessions(line, "d")[0]).toMatchObject({ taskText: "—", taskId: "", quest: "Travel book" });
  });
});

describe("workTitle", () => {
  it("falls back to the quest label", () => {
    expect(workTitle("", "Travel book")).toBe("Travel book");
    expect(workTitle("—", "Travel book")).toBe("Travel book");
    expect(workTitle("  ", "Other")).toBe("Other");
    expect(workTitle("Draft", "Travel book")).toBe("Draft");
  });
});
