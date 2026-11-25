import { describe, expect, it } from "vitest";
import { resolveContinue, resolveContinueSession, type WorkLookup } from "../src/data/lastwork";
import type { LastWork, Quest, Session, Task } from "../src/data/model";

const mkTask = (id: string, text: string, done = false): Task => ({ id, text, done, doneDate: null, line: 0, questPath: "" });
const mkQuest = (name: string, over: Partial<Quest> = {}): Quest => ({
  path: `${name}.md`, name, kind: "quest", status: "active", color: "", icon: "", why: "",
  weeklyHours: 0, order: 0, tasks: [], ...over,
});

const open = mkTask("t1", "Draft the Lisbon chapter (renamed)");
const finished = mkTask("t2", "Old", true);
const travel = mkQuest("Travel book", { tasks: [open, finished, mkTask("", "Hand written")] });
const paused = mkQuest("Garden", { status: "paused", tasks: [mkTask("g1", "Weed")] });
const other = mkQuest("Other", { kind: "other" });
const quests = [travel, paused, other];
const tasks = [...travel.tasks, ...paused.tasks];

const lookup: WorkLookup = {
  task: (id) => tasks.find((t) => t.id === id),
  quest: (n) => quests.find((q) => q.name === n),
  questOf: (t) => quests.find((q) => q.tasks.includes(t)),
  isWorkable: (q) => q.status === "active" || q.kind === "other",
};
const last = (taskId: string, quest: string): LastWork => ({ taskId, taskText: "stale", quest });

describe("resolveContinue", () => {
  it("starts the open task with its live data", () => {
    const r = resolveContinue(last("t1", "Travel book"), lookup);
    expect(r).toEqual({ kind: "task", task: open, quest: travel });
  });
  it("takes the quest from the task, not from lastWork", () => {
    const r = resolveContinue(last("t1", "Other"), lookup);
    expect(r).toMatchObject({ kind: "task", quest: travel });
  });
  it("falls to the quest for a done or deleted task", () => {
    expect(resolveContinue(last("t2", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
    expect(resolveContinue(last("zzz", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
  });
  it("handles quest-only memory and Other", () => {
    expect(resolveContinue(last("", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
    expect(resolveContinue(last("", "Other"), lookup)).toEqual({ kind: "quest", quest: other });
  });
  it("gives none for paused, missing quest or no memory", () => {
    expect(resolveContinue(last("", "Garden"), lookup)).toEqual({ kind: "none" });
    expect(resolveContinue(last("g1", "Garden"), lookup)).toEqual({ kind: "none" });
    expect(resolveContinue(last("", "Gone"), lookup)).toEqual({ kind: "none" });
    expect(resolveContinue(null, lookup)).toEqual({ kind: "none" });
    expect(resolveContinue(undefined, lookup)).toEqual({ kind: "none" });
  });
  it("uses the stored quest if the open task's own quest is not startable", () => {
    expect(resolveContinue(last("g1", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
  });
});

describe("resolveContinueSession", () => {
  const s = (taskId: string, taskText: string, quest: string): Session => ({
    day: "2026-11-20", start: 0, end: 10, taskText, quest, taskId, note: "", line: 0,
  });
  it("uses the id, falling back to the quest", () => {
    expect(resolveContinueSession(s("t1", "x", "Travel book"), lookup)).toEqual({ kind: "task", task: open, quest: travel });
    expect(resolveContinueSession(s("t2", "Old", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
  });
  it("matches id-less sessions by exact text in the same quest", () => {
    expect(resolveContinueSession(s("", "Hand written", "Travel book"), lookup)).toMatchObject({ kind: "task" });
    expect(resolveContinueSession(s("", "hand written", "Travel book"), lookup)).toEqual({ kind: "quest", quest: travel });
    expect(resolveContinueSession(s("", "Hand written", "Other"), lookup)).toEqual({ kind: "quest", quest: other });
  });
  it("starts the quest for a session without task", () => {
    expect(resolveContinueSession(s("", "", "Other"), lookup)).toEqual({ kind: "quest", quest: other });
  });
  it("gives none for paused or gone quests", () => {
    expect(resolveContinueSession(s("", "", "Garden"), lookup)).toEqual({ kind: "none" });
    expect(resolveContinueSession(s("", "Weed", "Gone"), lookup)).toEqual({ kind: "none" });
  });
});
