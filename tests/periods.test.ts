import { describe, expect, it } from "vitest";
import { monthOfWeek, monthsIn, parsePeriodId, periodDays, periodId, periodRange, scaleTarget, shiftPeriod, weeksIn } from "../src/data/periods";

describe("periods", () => {
  it("builds ids for each period", () => {
    expect(periodId("month", "2026-11-25")).toBe("2026-11");
    expect(periodId("quarter", "2026-11-25")).toBe("2026-Q4");
    expect(periodId("year", "2026-11-25")).toBe("2026");
    expect(periodId("week", "2026-11-25")).toBe("2026-W48");
    expect(periodId("quarter", "2026-01-01")).toBe("2026-Q1");
    expect(periodId("quarter", "2026-03-31")).toBe("2026-Q1");
    expect(periodId("quarter", "2026-04-01")).toBe("2026-Q2");
  });

  it("gives month ranges, leap years included", () => {
    expect(periodRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(periodDays("2026-11")).toBe(30);
  });

  it("gives quarter, year and week ranges", () => {
    expect(periodRange("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(periodRange("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodRange("2028")).toEqual({ start: "2028-01-01", end: "2028-12-31" });
    expect(periodDays("2028")).toBe(366);
    expect(periodRange("2026-W01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
  });

  it("shifts across boundaries", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-Q1", -1)).toBe("2025-Q4");
    expect(shiftPeriod("2026-Q4", 1)).toBe("2027-Q1");
    expect(shiftPeriod("2026", 1)).toBe("2027");
    expect(shiftPeriod("2026-W53", 1)).toBe("2027-W01");
    expect(shiftPeriod("2026-W01", -1)).toBe("2025-W52");
  });

  it("parses the four formats and rejects the rest", () => {
    expect(parsePeriodId("2026-13")).toBeNull();
    expect(parsePeriodId("2026-00")).toBeNull();
    expect(parsePeriodId("2026-Q5")).toBeNull();
    expect(parsePeriodId("2026-Q0")).toBeNull();
    expect(parsePeriodId("26")).toBeNull();
    expect(parsePeriodId("2026-W54")).toBeNull();
    expect(parsePeriodId("2025-W53")).toBeNull(); // 2025 has 52 ISO weeks
    expect(parsePeriodId("2026-W53")).toEqual({ period: "week", year: 2026, n: 53 });
    expect(parsePeriodId("2026-11")).toEqual({ period: "month", year: 2026, n: 11 });
    expect(parsePeriodId("2026-Q4")).toEqual({ period: "quarter", year: 2026, n: 4 });
    expect(parsePeriodId("2026")).toEqual({ period: "year", year: 2026, n: 0 });
  });

  it("lists clipped ISO weeks of a month (53-week year)", () => {
    const w = weeksIn("2026-12");
    expect(w.map((x) => [x.week, x.days])).toEqual([
      ["2026-W49", 6],
      ["2026-W50", 7],
      ["2026-W51", 7],
      ["2026-W52", 7],
      ["2026-W53", 4],
    ]);
    expect(w[0]!.start).toBe("2026-12-01");
    expect(w[4]!.end).toBe("2026-12-31");
    expect(w.reduce((a, x) => a + x.days, 0)).toBe(31);
    expect(monthsIn("2026-Q4")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthsIn("2026")).toHaveLength(12);
  });

  it("scales a weekly target to the days of a period", () => {
    expect(scaleTarget(20, 30)).toBe(85.7);
    expect(scaleTarget(20, 7)).toBe(20);
    expect(scaleTarget(0, 30)).toBe(0);
  });

  it("assigns a week to the month of its Thursday", () => {
    expect(monthOfWeek("2026-W01")).toBe("2026-01");
    expect(monthOfWeek("2025-W52")).toBe("2025-12");
    expect(monthOfWeek("nope")).toBeNull();
  });
});
