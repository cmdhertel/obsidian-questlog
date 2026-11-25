import { describe, expect, it } from "vitest";
import { ActivityCounter, nudgeDue } from "../src/data/nudge";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);

describe("ActivityCounter", () => {
  it("counts a minute once, however many events", () => {
    const c = new ActivityCounter();
    for (let i = 0; i < 50; i++) c.note(T0 + i * 1000, "2026-01-05");
    expect(c.minutes).toBe(1);
  });
  it("counts separate minutes", () => {
    const c = new ActivityCounter();
    c.note(T0, "d");
    c.note(T0 + MIN, "d");
    c.note(T0 + 5 * MIN, "d");
    expect(c.minutes).toBe(3);
  });
  it("does not count idle minutes", () => {
    const c = new ActivityCounter();
    c.note(T0, "d");
    c.note(T0 + 15 * MIN, "d");
    expect(c.minutes).toBe(2);
  });
  it("resets on reset(), and counts the same minute again afterwards", () => {
    const c = new ActivityCounter();
    c.note(T0, "d");
    c.reset();
    expect(c.minutes).toBe(0);
    c.note(T0, "d");
    expect(c.minutes).toBe(1);
  });
  it("starts over on a new day", () => {
    const c = new ActivityCounter();
    c.note(T0, "d1");
    c.note(T0 + MIN, "d1");
    c.note(T0 + 2 * MIN, "d2");
    expect(c.minutes).toBe(1);
  });
});

describe("nudgeDue", () => {
  const base = { minutes: 15, nudgeMinutes: 15, running: false, plannedQuestTasks: 1, mobile: false };
  it("is true when all hold", () => expect(nudgeDue(base)).toBe(true));
  it("is true above the threshold", () => expect(nudgeDue({ ...base, minutes: 40 })).toBe(true));
  it("is false below the threshold", () => expect(nudgeDue({ ...base, minutes: 14 })).toBe(false));
  it("is false when off", () => expect(nudgeDue({ ...base, nudgeMinutes: 0 })).toBe(false));
  it("is false while a timer runs", () => expect(nudgeDue({ ...base, running: true })).toBe(false));
  it("is false without planned quest tasks", () => expect(nudgeDue({ ...base, plannedQuestTasks: 0 })).toBe(false));
  it("is false on mobile", () => expect(nudgeDue({ ...base, mobile: true })).toBe(false));
});
