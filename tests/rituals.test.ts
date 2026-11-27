import { describe, expect, it } from "vitest";
import type { Quest, Task } from "../src/data/model";
import {
  closeTime,
  dismissRitual,
  fmClock,
  leftovers,
  pickRitual,
  planPrefill,
  startCandidates,
  weekToPlan,
  type Dismissed,
  type RitualInput,
} from "../src/data/rituals";

const WED = "2026-11-25";
const MON = "2026-11-23";
const SUN = "2026-11-29";
const none: Dismissed = { start: null, close: null, week: null, checkin: null };
const at = (h: number, m = 0) => h * 60 + m;

function input(o: Partial<RitualInput> & { plan?: string[] } = {}): RitualInput {
  const { plan = [], ...rest } = o;
  return {
    today: WED,
    nowMin: at(9),
    todayHasSessions: false,
    todayStarted: false,
    todayClosed: false,
    yesterdayHasSessions: false,
    yesterdayClosed: false,
    yesterdayHasGaps: false,
    reviewAnswered: false,
    hasPlanHours: (w) => plan.includes(w),
    checkinQuest: null,
    dismissed: none,
    ...rest,
  };
}

describe("pickRitual", () => {
  it("skips a switched-off ritual so the next one can show", () => {
    const evening = { nowMin: at(17), todayHasSessions: true, checkinQuest: "Q" };
    expect(pickRitual(input(evening))).toBe("close-day");
    expect(pickRitual(input({ ...evening, enabled: { close: false } }))).toBe("check-in");
    expect(pickRitual(input({ ...evening, enabled: { close: false, checkin: false } }))).toBeNull();
    expect(pickRitual(input({ enabled: { start: false } }))).toBeNull();
    expect(pickRitual(input({ enabled: { start: true } }))).toBe("start-day");
    const yesterday = { yesterdayHasSessions: true, yesterdayHasGaps: true };
    expect(pickRitual(input(yesterday))).toBe("close-yesterday");
    expect(pickRitual(input({ ...yesterday, enabled: { close: false } }))).toBe("start-day");
  });

  it("1. start-day in the morning until 13:59", () => {
    expect(pickRitual(input())).toBe("start-day");
    expect(pickRitual(input({ nowMin: at(13, 59) }))).toBe("start-day");
    expect(pickRitual(input({ nowMin: at(14) }))).toBeNull();
  });

  it("2. not when the day is started", () => {
    expect(pickRitual(input({ todayStarted: true }))).toBeNull();
  });

  it("3. start dismissal holds for the day only", () => {
    expect(pickRitual(input({ dismissed: { ...none, start: WED } }))).toBeNull();
    expect(pickRitual(input({ dismissed: { ...none, start: "2026-11-24" } }))).toBe("start-day");
  });

  it("4. close-day from 16:00 with sessions", () => {
    const base = { todayHasSessions: true, todayStarted: true };
    expect(pickRitual(input({ ...base, nowMin: at(17) }))).toBe("close-day");
    expect(pickRitual(input({ ...base, nowMin: at(15, 59) }))).toBeNull();
    expect(pickRitual(input({ ...base, nowMin: at(16) }))).toBe("close-day");
  });

  it("5. not when closed or without sessions", () => {
    expect(pickRitual(input({ nowMin: at(17), todayHasSessions: true, todayClosed: true }))).toBeNull();
    expect(pickRitual(input({ nowMin: at(17) }))).toBeNull();
  });

  it("6. close dismissal holds for the day only", () => {
    const base = { nowMin: at(17), todayHasSessions: true };
    expect(pickRitual(input({ ...base, dismissed: { ...none, close: WED } }))).toBeNull();
    expect(pickRitual(input({ ...base, dismissed: { ...none, close: "2026-11-24" } }))).toBe("close-day");
  });

  const open = { yesterdayHasSessions: true, yesterdayHasGaps: true };
  it("7. close-yesterday beats start-day", () => {
    expect(pickRitual(input(open))).toBe("close-yesterday");
  });

  it("8. no gaps or closed yesterday falls back to start-day", () => {
    expect(pickRitual(input({ ...open, yesterdayHasGaps: false }))).toBe("start-day");
    expect(pickRitual(input({ ...open, yesterdayClosed: true }))).toBe("start-day");
  });

  it("9. dismissed close-yesterday falls back to start-day", () => {
    expect(pickRitual(input({ ...open, dismissed: { ...none, close: "2026-11-24" } }))).toBe("start-day");
  });

  it("10. Monday without plan hours", () => {
    expect(pickRitual(input({ today: MON, todayStarted: true }))).toBe("plan-week");
    expect(pickRitual(input({ today: MON, todayStarted: true, plan: ["2026-W48"] }))).toBeNull();
    expect(pickRitual(input({ today: MON, todayStarted: true, plan: ["2026-W49"] }))).toBeNull();
  });

  it("11. answered review on a weekday", () => {
    expect(pickRitual(input({ nowMin: at(14, 30), reviewAnswered: true }))).toBe("plan-week");
    expect(pickRitual(input({ nowMin: at(14, 30) }))).toBeNull();
  });

  it("12. answered review: only the coming week counts", () => {
    expect(pickRitual(input({ today: SUN, nowMin: at(14, 30), reviewAnswered: true, plan: ["2026-W48"] }))).toBe("plan-week");
    expect(pickRitual(input({ today: SUN, nowMin: at(14, 30), reviewAnswered: true, plan: ["2026-W49"] }))).toBeNull();
  });

  it("13. plan dismissal holds for the week", () => {
    const base = { nowMin: at(14, 30), reviewAnswered: true };
    expect(pickRitual(input({ ...base, dismissed: { ...none, week: "2026-W48" } }))).toBeNull();
    expect(pickRitual(input({ ...base, dismissed: { ...none, week: "2026-W47" } }))).toBe("plan-week");
  });

  it("14. check-in", () => {
    expect(pickRitual(input({ nowMin: at(14, 30), checkinQuest: "Garden" }))).toBe("check-in");
    expect(pickRitual(input({ nowMin: at(14, 30), checkinQuest: "Garden", dismissed: { ...none, checkin: WED } }))).toBeNull();
  });

  it("15. priority", () => {
    const all = { today: MON, todayHasSessions: true, checkinQuest: "Garden" };
    expect(pickRitual(input({ ...all, nowMin: at(17) }))).toBe("close-day");
    expect(pickRitual(input({ ...all, nowMin: at(9) }))).toBe("start-day");
    expect(pickRitual(input({ ...all, nowMin: at(14, 30) }))).toBe("plan-week");
  });
});

describe("dismissRitual", () => {
  it("16. sets one key, keeps the others", () => {
    const d: Dismissed = { start: "x", close: "y", week: "z", checkin: "w" };
    expect(dismissRitual(d, "close-day", WED)).toEqual({ ...d, close: WED });
    expect(dismissRitual(d, "close-yesterday", WED)).toEqual({ ...d, close: "2026-11-24" });
    expect(dismissRitual(d, "plan-week", WED)).toEqual({ ...d, week: "2026-W48" });
    expect(dismissRitual(d, "start-day", WED)).toEqual({ ...d, start: WED });
    expect(dismissRitual(d, "check-in", WED)).toEqual({ ...d, checkin: WED });
  });
});

describe("weekToPlan", () => {
  it("17. coming week once answered", () => {
    expect(weekToPlan(WED, true)).toBe("2026-W49");
    expect(weekToPlan(MON, false)).toBe("2026-W48");
    expect(weekToPlan("2026-12-30", true)).toBe("2027-W01");
  });
});

describe("fmClock", () => {
  it("accepts H:MM and HH:MM strings only", () => {
    expect(fmClock("08:12")).toBe(492);
    expect(fmClock("8:12")).toBe(492);
    expect(fmClock(492)).toBeNull();
    expect(fmClock("soon")).toBeNull();
    expect(fmClock(null)).toBeNull();
  });
});

const task = (id: string, quest: string, o: Partial<Task> = {}): Task => ({
  id,
  text: id,
  done: false,
  doneDate: null,
  line: 0,
  questPath: quest,
  stage: null,
  stageIndex: null,
  ...o,
});
type Q = Pick<Quest, "path" | "kind" | "status" | "tasks" | "stages">;
const quest = (path: string, tasks: Task[], o: Partial<Q> = {}): Q => ({ path, kind: "quest", status: "active", tasks, stages: [], ...o });

describe("startCandidates", () => {
  it("carried first, then the own plan's order", () => {
    const r = startCandidates([task("b", "A.md"), task("c", "A.md"), task("a", "A.md")], [], ["a", "b"]);
    expect(r.planned.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("one suggestion per quest without a planned task; paused, Other and done excluded", () => {
    const A = quest("A.md", [task("a1", "A.md")]);
    const B = quest("B.md", [task("b0", "B.md", { done: true }), task("b1", "B.md"), task("b2", "B.md")]);
    const P = quest("P.md", [task("p1", "P.md")], { status: "paused" });
    const O = quest("O.md", [task("o1", "O.md")], { kind: "other" });
    const r = startCandidates([task("a1", "A.md"), task("x", "A.md", { done: true })], [A, B, P, O], ["a1"]);
    expect(r.planned.map((x) => x.id)).toEqual(["a1"]);
    expect(r.suggested.map((x) => x.id)).toEqual(["b1"]);
  });

  it("suggests from the current stage", () => {
    const stages = [
      { index: 0, name: "One", started: "2026-11-01", target: null, reached: "2026-11-10", line: 0, end: 0 },
      { index: 1, name: "Two", started: "2026-11-11", target: null, reached: null, line: 0, end: 0 },
    ];
    const A = quest("A.md", [task("loose", "A.md"), task("s0", "A.md", { stageIndex: 0 }), task("s1", "A.md", { stageIndex: 1 })], { stages });
    expect(startCandidates([], [A], []).suggested.map((x) => x.id)).toEqual(["s1"]);
  });

  it("empty input", () => {
    expect(startCandidates([], [], [])).toEqual({ planned: [], suggested: [] });
  });
});

describe("leftovers", () => {
  const days = [
    { day: "2026-11-23", plan: ["old", "gone"] },
    { day: "2026-11-24", plan: ["y1", "y2", "done", "moved"] },
    { day: WED, plan: ["t1", "moved"] },
    { day: "2026-11-26", plan: ["later"] },
  ];
  const isOpen = (id: string) => id !== "done";

  it("today: carried and own, not done, not later days", () => {
    expect(leftovers(days, isOpen, WED, WED)).toEqual(["old", "gone", "y1", "y2", "t1", "moved"]);
  });

  it("yesterday: only tasks whose latest plan day is yesterday", () => {
    expect(leftovers(days, isOpen, "2026-11-24", WED)).toEqual(["y1", "y2"]);
  });
});

describe("closeTime", () => {
  const s = [
    { day: "2026-11-24", end: at(17, 50) },
    { day: "2026-11-24", end: at(12) },
    { day: WED, end: at(9) },
  ];
  it("now for today, last session end for yesterday, null without sessions", () => {
    expect(closeTime(WED, WED, at(18), s)).toBe(at(18));
    expect(closeTime("2026-11-24", WED, at(9), s)).toBe(at(17, 50));
    expect(closeTime("2026-11-22", WED, at(9), s)).toBeNull();
  });
});

describe("planPrefill", () => {
  const q = { name: "Garden", weeklyHours: 2 };
  it("week entry, else previous week, else weekly_hours", () => {
    expect(planPrefill(q, "2026-W49", (w) => (w === "2026-W49" ? { Garden: 5 } : { Garden: 3 }))).toBe(5);
    expect(planPrefill(q, "2026-W49", (w) => (w === "2026-W48" ? { Garden: 3 } : null))).toBe(3);
    expect(planPrefill(q, "2027-W01", (w) => (w === "2026-W53" ? { Garden: 4 } : null))).toBe(4);
    expect(planPrefill(q, "2026-W49", () => ({ Other: 1 }))).toBe(2);
    expect(planPrefill(q, "2026-W49", () => ({ Garden: "lots" }) as unknown as Record<string, number>)).toBe(2);
  });
});
