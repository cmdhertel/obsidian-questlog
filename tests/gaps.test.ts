import { describe, expect, it } from "vitest";
import { findGaps, formatBreak, gapSuggestions, hasFreeStretch, parseBreaks, runningSpan, type GapItem } from "../src/data/gaps";

const h = (x: number) => x * 60;
const base = { from: h(8), to: h(20), breaks: [] };

describe("findGaps", () => {
  it("finds one gap between two sessions, with edges", () => {
    const g = findGaps({ ...base, covered: [{ start: h(9), end: h(10) }, { start: h(11), end: h(12) }] });
    expect(g).toEqual([
      { start: h(8), end: h(9), edge: "before" },
      { start: h(10), end: h(11), edge: "none" },
      { start: h(12), end: h(20), edge: "after" },
    ]);
  });
  it("merges overlaps and touching spans", () => {
    const g = findGaps({ ...base, covered: [{ start: h(9), end: h(11) }, { start: h(10), end: h(12) }, { start: h(12), end: h(13) }] });
    expect(g.map((x) => x.edge)).toEqual(["before", "after"]);
  });
  it("counts sessions outside the window as covered but does not stretch it", () => {
    expect(findGaps({ ...base, covered: [{ start: h(6), end: h(7) }] })).toEqual([{ start: h(8), end: h(20), edge: "after" }]);
    expect(findGaps({ ...base, covered: [{ start: h(7), end: h(9) }] })).toEqual([{ start: h(9), end: h(20), edge: "after" }]);
    expect(findGaps({ ...base, covered: [{ start: h(21), end: h(22) }] })).toEqual([{ start: h(8), end: h(20), edge: "before" }]);
  });
  it("cuts at now", () => {
    const g = findGaps({ ...base, now: h(11) + 30, covered: [{ start: h(9), end: h(10) }] });
    expect(g).toEqual([{ start: h(8), end: h(9), edge: "before" }, { start: h(10), end: h(11) + 30, edge: "after" }]);
  });
  it("returns nothing when now is before the window", () => {
    expect(findGaps({ ...base, now: h(7), covered: [{ start: h(6), end: h(6) + 30 }] })).toEqual([]);
  });
  it("returns nothing for an empty day", () => {
    expect(findGaps({ ...base, covered: [] })).toEqual([]);
  });
  it("a running span reaching now leaves no gap after it", () => {
    const g = findGaps({ ...base, now: h(12), covered: [{ start: h(9), end: h(10) }, { start: h(10) + 30, end: h(12) }] });
    expect(g.map((x) => [x.start, x.end])).toEqual([[h(8), h(9)], [h(10), h(10) + 30]]);
  });
  it("cuts a break inside a gap into two", () => {
    const g = findGaps({ ...base, covered: [{ start: h(9), end: h(10) }, { start: h(13), end: h(14) }], breaks: [{ start: h(11), end: h(12) }] });
    expect(g.filter((x) => x.edge === "none")).toEqual([{ start: h(10), end: h(11), edge: "none" }, { start: h(12), end: h(13), edge: "none" }]);
  });
  it("hides a gap fully covered by a break and drops short remainders", () => {
    const covered = [{ start: h(9), end: h(10) }, { start: h(11), end: h(12) }];
    const g = findGaps({ ...base, covered, breaks: [{ start: h(10), end: h(11) }, { start: h(8), end: h(8) + 50 }] });
    expect(g.map((x) => x.edge)).toEqual(["after"]);
  });
  it("keeps 15 minutes, drops 14", () => {
    const c = (len: number) => [{ start: h(9), end: h(10) }, { start: h(10) + len, end: h(11) }];
    const mid = (len: number) => findGaps({ ...base, covered: c(len) }).filter((x) => x.edge === "none");
    expect(mid(15)).toHaveLength(1);
    expect(mid(14)).toHaveLength(0);
  });
  it("a 14 minute break inside a 29 minute gap leaves 15", () => {
    const g = findGaps({ ...base, covered: [{ start: h(9), end: h(10) }, { start: h(10) + 29, end: h(11) }], breaks: [{ start: h(10), end: h(10) + 14 }] });
    expect(g.filter((x) => x.edge === "none")).toEqual([{ start: h(10) + 14, end: h(10) + 29, edge: "none" }]);
  });
  it("ignores invalid spans and respects minLen", () => {
    const g = findGaps({ ...base, minLen: 60, covered: [{ start: h(9), end: h(9) }, { start: h(10), end: h(9) }, { start: h(9), end: h(10) }, { start: h(10) + 30, end: h(19) + 30 }] });
    expect(g).toEqual([{ start: h(8), end: h(9), edge: "before" }]);
  });
});

describe("runningSpan", () => {
  const at = (d: string, hh: number, mm = 0) => new Date(`${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`).getTime();
  it("clips to the day", () => {
    expect(runningSpan(at("2026-11-20", 9), at("2026-11-20", 10, 30), "2026-11-20")).toEqual({ start: h(9), end: h(10) + 30 });
  });
  it("covers both sides of midnight", () => {
    const s = at("2026-11-19", 23, 30), n = at("2026-11-20", 1);
    expect(runningSpan(s, n, "2026-11-19")).toEqual({ start: h(23) + 30, end: 1440 });
    expect(runningSpan(s, n, "2026-11-20")).toEqual({ start: 0, end: 60 });
    expect(runningSpan(s, n, "2026-11-21")).toBeNull();
  });
  it("returns null when not started yet", () => {
    expect(runningSpan(at("2026-11-20", 10), at("2026-11-20", 9), "2026-11-20")).toBeNull();
  });
});

describe("breaks", () => {
  it("parses hyphen and en dash, skips bad input", () => {
    expect(parseBreaks(["12:00-13:00", "15:30–15:45", "bad", "13:00-12:00", "9:00-9:00", 5, null, "25:00-26:00"])).toEqual([
      { start: h(12), end: h(13) },
      { start: h(15) + 30, end: h(15) + 45 },
    ]);
    expect(parseBreaks(undefined)).toEqual([]);
    expect(parseBreaks({})).toEqual([]);
    expect(parseBreaks("12:00-13:00")).toEqual([{ start: h(12), end: h(13) }]);
  });
  it("sorts and formats", () => {
    expect(parseBreaks(["15:00-16:00", "08:00-09:00"])[0]).toEqual({ start: h(8), end: h(9) });
    expect(formatBreak({ start: h(8) + 5, end: h(9) })).toBe("08:05-09:00");
    expect(parseBreaks([formatBreak({ start: 0, end: 1440 })])).toEqual([{ start: 0, end: 1440 }]);
  });
});

describe("hasFreeStretch", () => {
  it("is true for an open window, false when breaks cover it", () => {
    expect(hasFreeStretch({ ...base, breaks: [] })).toBe(true);
    expect(hasFreeStretch({ ...base, breaks: [{ start: h(8), end: h(20) }] })).toBe(false);
  });
  it("needs minLen left, and respects now", () => {
    expect(hasFreeStretch({ ...base, breaks: [{ start: h(8), end: h(20) - 14 }] })).toBe(false);
    expect(hasFreeStretch({ ...base, breaks: [{ start: h(8), end: h(20) - 15 }] })).toBe(true);
    expect(hasFreeStretch({ ...base, now: h(7), breaks: [] })).toBe(false);
    expect(hasFreeStretch({ ...base, now: h(8) + 14, breaks: [] })).toBe(false);
    expect(hasFreeStretch({ ...base, now: h(8) + 15, breaks: [] })).toBe(true);
  });
});

describe("gapSuggestions", () => {
  const it_ = (quest: string, taskId: string, taskText = taskId): GapItem => ({ quest, taskId, taskText });
  it("orders done, planned, last and removes duplicates", () => {
    const r = gapSuggestions({
      done: [it_("A", "1"), it_("A", "2")],
      planned: [it_("A", "2"), it_("B", "3")],
      last: it_("B", "3"),
    });
    expect(r.map((x) => x.taskId)).toEqual(["1", "2", "3"]);
  });
  it("dedupes id-less items by quest and text, and caps at max", () => {
    const r = gapSuggestions({ done: [it_("A", "", "x"), it_("A", "", "x"), it_("A", "", "y")], planned: [], last: undefined }, 6);
    expect(r).toHaveLength(2);
    const many = Array.from({ length: 10 }, (_, i) => it_("Q", String(i)));
    expect(gapSuggestions({ done: many, planned: [] })).toHaveLength(6);
    expect(gapSuggestions({ done: many, planned: [] }, 2)).toHaveLength(2);
  });
  it("handles an absent last work", () => {
    expect(gapSuggestions({ done: [], planned: [] })).toEqual([]);
  });
});
