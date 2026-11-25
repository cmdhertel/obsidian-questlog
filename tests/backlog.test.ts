import { describe, expect, it } from "vitest";
import { filterBacklog, isFiltering, matchesQuery, normalizeText, validChip } from "../src/data/backlog";

const items = [
  { text: "Draft the Lisbon chapter", quest: "Travel book" },
  { text: "Café scene in Porto", quest: "Travel book" },
  { text: "Agua y fuego vocabulary", quest: "Spanish B2" },
  { text: "Order seeds", quest: "Garden" },
];

describe("backlog filter", () => {
  it("normalizes case and accents", () => {
    expect(normalizeText("Café ÀGUA")).toBe("cafe agua");
  });

  it("matches case-insensitively and ignores accents both ways", () => {
    expect(matchesQuery("Agua y fuego", "Spanish", "agua")).toBe(true);
    expect(matchesQuery("Café scene", "Travel", "cafe")).toBe(true);
    expect(matchesQuery("Cafe scene", "Travel", "café")).toBe(true);
  });

  it("needs every word, in text or quest name", () => {
    expect(matchesQuery("Draft the Lisbon chapter", "Travel book", "lisbon travel")).toBe(true);
    expect(matchesQuery("Draft the Lisbon chapter", "Travel book", "lisbon porto")).toBe(false);
  });

  it("treats an empty or blank query as no filter", () => {
    expect(matchesQuery("x", "y", "")).toBe(true);
    expect(matchesQuery("x", "y", "   ")).toBe(true);
    expect(isFiltering({ quest: null, query: "  " })).toBe(false);
    expect(isFiltering({ quest: null, query: "a" })).toBe(true);
    expect(isFiltering({ quest: "Garden", query: "" })).toBe(true);
  });

  it("matches regex characters as plain text", () => {
    expect(matchesQuery("Fix (a+b)*", "Other", "(a+b)*")).toBe(true);
    expect(matchesQuery("Fix ab", "Other", ".*")).toBe(false);
  });

  it("filters by chip, by query and by both, keeping the order", () => {
    expect(filterBacklog(items, { quest: "Travel book", query: "" }).map((x) => x.text)).toEqual(["Draft the Lisbon chapter", "Café scene in Porto"]);
    expect(filterBacklog(items, { quest: null, query: "o" }).map((x) => x.quest)).toEqual(["Travel book", "Travel book", "Spanish B2", "Garden"]);
    expect(filterBacklog(items, { quest: "Travel book", query: "porto" })).toHaveLength(1);
    expect(filterBacklog(items, { quest: "Garden", query: "lisbon" })).toHaveLength(0);
  });

  it("drops a chip whose quest left the backlog", () => {
    expect(validChip("Garden", ["Garden", "Spanish B2"])).toBe("Garden");
    expect(validChip("Garden", ["Spanish B2"])).toBeNull();
    expect(validChip(null, [])).toBeNull();
  });
});
