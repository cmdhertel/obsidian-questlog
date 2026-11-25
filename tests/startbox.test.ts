import { describe, expect, it } from "vitest";
import { buildRows, matchQuest, parseStartInput, rankTasks, type TaskEntry } from "../src/data/startbox";
import type { Quest, Task } from "../src/data/model";

const task = (text: string, line: number, id = "", done = false): Task => ({
  id, text, done, doneDate: null, line, questPath: "", stage: null, stageIndex: null,
});
const quest = (name: string, order: number, over: Partial<Quest> = {}): Quest => ({
  path: `${name}.md`, name, kind: "quest", status: "active", color: "", icon: "", why: "",
  weeklyHours: 0, order, tasks: [], stages: [], created: null, checkedIn: null, paused: null, finished: null, ...over,
});
const travel = quest("Travel book", 1);
const trade = quest("Book trade", 2);
const other = quest("Other", 9, { kind: "other" });
const quests = [travel, trade, other];
const names = ["Other", "Sonstiges"];

describe("matchQuest", () => {
  it("matches case-insensitively, with dropped spaces or hyphens", () => {
    expect(matchQuest("TRAVEL", quests, names)).toBe(travel);
    expect(matchQuest("travelbook", quests, names)).toBe(travel);
    expect(matchQuest("travel-book", quests, names)).toBe(travel);
  });
  it("prefers prefix over contains, then store order", () => {
    expect(matchQuest("book", quests, names)).toBe(trade);
    expect(matchQuest("t", quests, names)).toBe(travel);
  });
  it("handles umlauts", () => {
    const q = quest("Übersetzung", 0);
    expect(matchQuest("üb", [q], names)).toBe(q);
    expect(matchQuest("ÜBERS", [q], names)).toBe(q);
  });
  it("matches Other by its translated name", () => {
    expect(matchQuest("sonst", quests, names)).toBe(other);
    expect(matchQuest("oth", quests, names)).toBe(other);
  });
  it("finds nothing among workable quests only", () => {
    expect(matchQuest("garden", quests, names)).toBeNull();
    expect(matchQuest("", quests, names)).toBeNull();
  });
});

describe("parseStartInput", () => {
  it("takes a trailing token", () => {
    const p = parseStartInput("Draft the Lisbon chapter #travel", quests, names);
    expect(p).toEqual({ text: "Draft the Lisbon chapter", quest: travel, tokenUsed: true });
  });
  it("returns empty text for a token alone", () => {
    expect(parseStartInput("#travel", quests, names)).toEqual({ text: "", quest: travel, tokenUsed: true });
  });
  it("keeps unmatched or inner tokens", () => {
    expect(parseStartInput("Call #idea", quests, names)).toEqual({ text: "Call #idea", quest: null, tokenUsed: false });
    expect(parseStartInput("Fix #2 bug", quests, names).text).toBe("Fix #2 bug");
    expect(parseStartInput("#", quests, names).text).toBe("#");
    expect(parseStartInput("a#travel", quests, names).tokenUsed).toBe(false);
  });
  it("copes with whitespace", () => {
    const p = parseStartInput("  Write   it \t #travel-book  ", quests, names);
    expect(p.text).toBe("Write it");
    expect(p.quest).toBe(travel);
  });
  it("matches Other by translated name", () => {
    expect(parseStartInput("x #sonstiges", quests, names).quest).toBe(other);
  });
  it("ignores a quest that is not passed (paused)", () => {
    expect(parseStartInput("x #garden", quests, names).tokenUsed).toBe(false);
  });
});

describe("rankTasks", () => {
  const a = task("Draft the Lisbon outline", 3, "a");
  const b = task("Pack bags", 5, "b");
  const c = task("Call trade partner", 1, "c");
  const d = task("Done thing", 0, "d", true);
  const entries: TaskEntry[] = [
    { task: c, quest: trade }, { task: b, quest: travel }, { task: a, quest: travel }, { task: d, quest: travel },
  ];
  it("returns all open tasks for an empty query, in the given order", () => {
    expect(rankTasks("", entries, []).map((e) => e.task.id)).toEqual(["c", "b", "a"]);
  });
  it("finds tasks of Other by its translated name", () => {
    const e = { task: task("Call the bank", 2, "x"), quest: other };
    expect(rankTasks("bank sonstiges", [e], [], names)).toEqual([e]);
    expect(rankTasks("bank sonstiges", [e], [])).toEqual([]);
  });
  it("matches composed input against decomposed names", () => {
    const e = { task: task("Plan", 2, "x"), quest: quest("U\u0308bung", 3) };
    expect(rankTasks("\u00fcbung", [e], [])).toEqual([e]);
  });
  it("requires every word, in task text or quest name", () => {
    expect(rankTasks("LISBON draft", entries, []).map((e) => e.task.id)).toEqual(["a"]);
    expect(rankTasks("pack travel", entries, []).map((e) => e.task.id)).toEqual(["b"]);
    expect(rankTasks("lisbon chapter", entries, [])).toEqual([]);
  });
  it("puts planned tasks first in plan order", () => {
    expect(rankTasks("", entries, ["a", "b"]).map((e) => e.task.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildRows", () => {
  const a = task("Draft the Lisbon outline", 3, "a");
  const e = task("Draft the Lisbon chapter", 4, "e");
  const x = task("Other draft", 0, "x");
  const entries: TaskEntry[] = [
    { task: a, quest: travel }, { task: e, quest: travel }, { task: x, quest: trade },
  ];
  const base = { quests, otherNames: names, entries, plannedIds: [] as string[], lastQuest: null, mode: "start" as const };
  const kinds = (r: ReturnType<typeof buildRows>) => r.map((row) => row.kind);

  it("puts create rows first with a token and limits tasks to that quest", () => {
    const r = buildRows({ ...base, input: "Draft the Lisbon #travel" });
    expect(kinds(r)).toEqual(["start", "add", "task", "task"]);
    expect(r.every((row) => row.quest === travel)).toBe(true);
  });
  it("follows the strict every-word rule: the outline row is not listed for 'chapter'", () => {
    const r = buildRows({ ...base, input: "Draft the Lisbon chapter #travel" });
    expect(r.filter((row) => row.kind === "task")).toHaveLength(1);
  });
  it("puts create rows after tasks without a token, destination Other by default", () => {
    const r = buildRows({ ...base, input: "draft" });
    expect(kinds(r)).toEqual(["task", "task", "task", "start", "add"]);
    expect(r[3]).toMatchObject({ kind: "start", quest: other });
  });
  it("uses the last quest, and puts create rows first when nothing matches", () => {
    const r = buildRows({ ...base, input: "brand new", lastQuest: trade });
    expect(kinds(r)).toEqual(["start", "add"]);
    expect(r[0]).toMatchObject({ quest: trade });
  });
  it("puts add first in add mode", () => {
    expect(kinds(buildRows({ ...base, mode: "add", input: "brand new" }))).toEqual(["add", "backlog", "start"]);
    expect(kinds(buildRows({ ...base, mode: "add", input: "x #travel" }))[0]).toBe("add");
    // matching tasks never come before the add row
    expect(kinds(buildRows({ ...base, mode: "add", input: "draft" }))).toEqual(["add", "backlog", "start", "task", "task", "task"]);
  });
  it("offers the backlog row only in add mode", () => {
    expect(kinds(buildRows({ ...base, input: "brand new" }))).not.toContain("backlog");
    expect(buildRows({ ...base, mode: "add", input: "x #travel" })[1]).toMatchObject({ kind: "backlog", quest: travel, text: "x" });
  });
  it("has no create rows for empty text", () => {
    expect(kinds(buildRows({ ...base, input: "#travel" }))).toEqual(["task", "task"]);
    expect(kinds(buildRows({ ...base, input: "" }))).toEqual(["task", "task", "task"]);
  });
  it("keeps an unmatched token in the text", () => {
    const r = buildRows({ ...base, input: "Call #idea" });
    expect(r.find((row) => row.kind === "start")).toMatchObject({ text: "Call #idea" });
  });
});
