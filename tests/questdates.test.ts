import { describe, expect, it } from "vitest";
import { fmDay, statusDates } from "../src/data/questdates";

describe("statusDates", () => {
  it("sets paused and clears finished", () => {
    expect(statusDates("active", "paused", "2026-11-25")).toEqual({ paused: "2026-11-25", finished: null });
  });
  it("sets finished", () => {
    expect(statusDates("active", "done", "2026-11-25")).toEqual({ finished: "2026-11-25" });
  });
  it("removes both when active again", () => {
    expect(statusDates("done", "active", "2026-11-25")).toEqual({ paused: null, finished: null });
  });
  it("does nothing when the status is unchanged", () => {
    expect(statusDates("paused", "paused", "2026-11-25")).toEqual({});
  });
});

describe("fmDay", () => {
  it("reads strings and dates, else null", () => {
    expect(fmDay("2026-11-25")).toBe("2026-11-25");
    expect(fmDay(new Date(2026, 10, 25))).toBe("2026-11-25");
    expect(fmDay(undefined)).toBeNull();
    expect(fmDay("soon")).toBeNull();
  });
});
