import { describe, expect, it } from "vitest";
import { clampStart, clampToday, lastEndBefore, midnightOf, minuteToMs } from "../src/data/startearlier";

const midnight = new Date(2026, 10, 25).getTime();
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 25, h, m, s).getTime();

describe("lastEndBefore", () => {
  it("is 0 for no sessions", () => expect(lastEndBefore([], 600)).toBe(0));
  it("takes the latest end at or before the limit, ignoring overlap", () => {
    const s = [{ start: 540, end: 570 }, { start: 580, end: 595 }, { start: 605, end: 650 }];
    expect(lastEndBefore(s, 600)).toBe(595);
    expect(lastEndBefore(s, 570)).toBe(570);
    expect(lastEndBefore(s, 539)).toBe(0);
  });
});

describe("minuteToMs", () => {
  it("is local wall-clock time", () => expect(minuteToMs(midnight, 9 * 60 + 30)).toBe(at(9, 30)));
});

describe("clampStart", () => {
  const now = at(10, 0, 30);
  it("keeps a free start", () => {
    expect(clampStart(now - 10 * 60000, now, midnight, 0)).toEqual({ start: now - 600000, clamped: "none" });
  });
  it("clamps to midnight", () => {
    const n = at(0, 7);
    expect(clampStart(n - 20 * 60000, n, midnight, 0)).toEqual({ start: midnight, clamped: "midnight" });
  });
  it("clamps to the last session end", () => {
    const n = at(10, 0);
    expect(clampStart(n - 10 * 60000, n, midnight, 9 * 60 + 55)).toEqual({ start: at(9, 55), clamped: "session" });
  });
  it("does not clamp a start exactly on the boundary", () => {
    expect(clampStart(at(9, 55), now, midnight, 595).clamped).toBe("none");
  });
  it("clamps the future to now", () => {
    expect(clampStart(now + 60000, now, midnight, 0)).toEqual({ start: now, clamped: "future" });
  });
  it("boundary in the current minute gives a start within the last minute", () => {
    const r = clampStart(now - 600000, now, midnight, 600);
    expect(r).toEqual({ start: at(10, 0), clamped: "session" });
    expect(r.start).toBeLessThanOrEqual(now);
  });
  it("never returns the future even with a boundary later than now", () => {
    const r = clampStart(at(9, 0), now, midnight, 11 * 60);
    expect(r).toEqual({ start: now, clamped: "future" });
  });
});

describe("clampToday", () => {
  const sessions = [{ start: 9 * 60, end: 9 * 60 + 30 }, { start: 10 * 60 + 5, end: 10 * 60 + 40 }];
  it("uses now as limit for a new run", () => {
    const r = clampToday(at(9, 40), at(9, 50), sessions, at(9, 50));
    expect(r).toEqual({ start: at(9, 40), clamped: "none" });
    expect(clampToday(at(9, 10), at(9, 50), sessions, at(9, 50))).toEqual({ start: at(9, 30), clamped: "session" });
  });
  it("ignores sessions after the run's current start", () => {
    const r = clampToday(at(8, 0), at(11, 0), sessions, at(10, 0));
    expect(r).toEqual({ start: at(9, 30), clamped: "session" });
  });
  it("clamps to midnight and to now", () => {
    expect(clampToday(at(0, 0) - 60000, at(0, 7), [], at(0, 7)).clamped).toBe("midnight");
    expect(clampToday(at(12, 0), at(11, 0), [], at(10, 0)).clamped).toBe("future");
    expect(midnightOf(at(15, 3))).toBe(midnight);
  });
});
