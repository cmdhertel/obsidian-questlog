import { describe, expect, it } from "vitest";
import { checkinLine, parseCheckins, pickCheckinQuest, quietWeeks, type CheckinCandidate } from "../src/data/checkin";
import { appendToSectionAny } from "../src/data/markdown";

const today = "2026-11-25";
const c = (o: Partial<CheckinCandidate> = {}): CheckinCandidate => ({ name: "Garden", status: "active", order: 0, quietWeeks: 3, checkedIn: null, ...o });

describe("pickCheckinQuest", () => {
  it("1. quiet enough", () => {
    expect(pickCheckinQuest([c()], today, 3)?.name).toBe("Garden");
    expect(pickCheckinQuest([c({ quietWeeks: 2 })], today, 3)).toBeNull();
  });
  it("2. a recent check-in blocks", () => {
    expect(pickCheckinQuest([c({ quietWeeks: 4, checkedIn: "2026-11-10" })], today, 3)).toBeNull();
    expect(pickCheckinQuest([c({ quietWeeks: 4, checkedIn: "2026-11-02" })], today, 3)).toBeNull();
    expect(pickCheckinQuest([c({ quietWeeks: 4, checkedIn: "2026-10-26" })], today, 3)?.name).toBe("Garden");
  });
  it("3. paused and done never", () => {
    expect(pickCheckinQuest([c({ status: "paused", quietWeeks: 9 }), c({ status: "done", quietWeeks: 9 })], today, 3)).toBeNull();
  });
  it("4. most quiet wins, ties to the lower order", () => {
    expect(pickCheckinQuest([c({ name: "A", quietWeeks: 3 }), c({ name: "B", quietWeeks: 5, order: 3 })], today, 3)?.name).toBe("B");
    expect(pickCheckinQuest([c({ name: "A", order: 2 }), c({ name: "B", order: 1 })], today, 3)?.name).toBe("B");
  });
  it("5. checkinWeeks 2", () => {
    expect(pickCheckinQuest([c({ quietWeeks: 2 })], today, 2)?.name).toBe("Garden");
  });
});

describe("quietWeeks", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it("counts full past weeks without time since the start", () => {
    expect(quietWeeks({ today, created: "2026-09-01", firstSession: null, minutes: m({ "2026-10-26": 30 }) })).toBe(3);
    expect(quietWeeks({ today, created: "2026-11-10", firstSession: null, minutes: m({}) })).toBe(2);
    expect(quietWeeks({ today, created: null, firstSession: null, minutes: m({}) })).toBe(0);
  });
  it("a week with time now is not quiet", () => {
    expect(quietWeeks({ today, created: "2026-09-01", firstSession: null, minutes: m({ "2026-11-23": 10 }) })).toBe(0);
  });
});

describe("checkinLine", () => {
  it("6. format", () => {
    expect(checkinLine(today, "pause", "Winter break.")).toBe("- 2026-11-25 pause: Winter break.");
    expect(checkinLine(today, "pause", "")).toBe("- 2026-11-25 pause");
    expect(checkinLine(today, "keep", "One\ntwo")).toBe("- 2026-11-25 keep: One two");
  });
});

describe("parseCheckins", () => {
  it("7. both languages, skips malformed lines and unknown actions", () => {
    const en = "## Tasks\n- [ ] x\n\n## Check-ins\n- 2026-09-02 keep: Still: tomatoes.\n- 2026-10-01 dance: no\n- nonsense\n- 2026-11-25 pause\n";
    expect(parseCheckins(en)).toEqual([
      { date: "2026-09-02", action: "keep", text: "Still: tomatoes." },
      { date: "2026-11-25", action: "pause", text: "" },
    ]);
    expect(parseCheckins("## Standortbestimmung\r\n- 2026-09-02 shrink: Weniger.\r\n")).toEqual([{ date: "2026-09-02", action: "shrink", text: "Weniger." }]);
    expect(parseCheckins("## Tasks\n- 2026-09-02 keep\n")).toEqual([]);
  });
});

describe("appendToSectionAny", () => {
  const H = ["Check-ins", "Standortbestimmung"];
  it("8. adds to an existing German section, creates the English one at the end", () => {
    const de = "---\ntype: quest\n---\n## Standortbestimmung\n- 2026-09-02 keep\n\n## Aufgaben\n- [ ] x\n";
    expect(appendToSectionAny(de, H, "- 2026-11-25 pause")).toBe(
      "---\ntype: quest\n---\n## Standortbestimmung\n- 2026-09-02 keep\n- 2026-11-25 pause\n\n## Aufgaben\n- [ ] x\n",
    );
    expect(appendToSectionAny("## Tasks\n- [ ] x\n", H, "- 2026-11-25 keep")).toBe("## Tasks\n- [ ] x\n\n## Check-ins\n- 2026-11-25 keep\n");
  });
});
