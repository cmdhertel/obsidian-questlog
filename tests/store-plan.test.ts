import { describe, expect, it } from "vitest";
import { parsePlanHours, renameKey } from "../src/data/plan-hours";

describe("parsePlanHours", () => {
  it("accepts a map and drops non-numbers", () => {
    expect(parsePlanHours({ "Travel book": 8, Garden: 0, Bad: "x", Inf: Infinity })).toEqual({ "Travel book": 8, Garden: 0 });
    expect(parsePlanHours({})).toEqual({});
  });
  it("rejects arrays, strings and absence", () => {
    expect(parsePlanHours([8, 4])).toBeNull();
    expect(parsePlanHours("Travel book: 8")).toBeNull();
    expect(parsePlanHours(undefined)).toBeNull();
    expect(parsePlanHours(null)).toBeNull();
  });
});

describe("renameKey", () => {
  it("keeps order and other keys", () => {
    const r = renameKey({ A: 1, B: 2, C: 3 }, "B", "Bee");
    expect(Object.entries(r)).toEqual([["A", 1], ["Bee", 2], ["C", 3]]);
  });
  it("absent key stays absent", () => {
    const m = { A: 1 };
    expect(renameKey(m, "B", "Bee")).toBe(m);
    expect("Bee" in renameKey(m, "B", "Bee")).toBe(false);
  });
});
