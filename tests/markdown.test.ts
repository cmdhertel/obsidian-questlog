import { describe, expect, it } from "vitest";
import * as md from "../src/data/markdown";

const QUEST = `---
type: quest
status: active
---

## Tasks
- [ ] Outline chapters 🆔 abc123
- [x] Research ✅ 2026-11-19 🆔 def456
- [ ] No id yet
- [-] Cancelled
\`\`\`
- [ ] inside code
\`\`\`
`;

describe("tasks", () => {
  it("parses tasks with id and done date, skipping cancelled and code blocks", () => {
    const ts = md.parseTasks(QUEST, "Q.md");
    expect(ts.map((t) => [t.text, t.id, t.done, t.doneDate])).toEqual([
      ["Outline chapters", "abc123", false, null],
      ["Research", "def456", true, "2026-11-19"],
      ["No id yet", "", false, null],
    ]);
    expect(ts[0]!.line).toBe(6);
  });

  it("marks done with date before the id, and undoes it", () => {
    const done = md.setTaskDone(QUEST, 6, true, "2026-11-20");
    expect(done.split("\n")[6]).toBe("- [x] Outline chapters ✅ 2026-11-20 🆔 abc123");
    const undone = md.setTaskDone(done, 6, false, "2026-11-20");
    expect(undone.split("\n")[6]).toBe("- [ ] Outline chapters 🆔 abc123");
  });

  it("adds an id only once", () => {
    const a = md.setTaskId(QUEST, 8, "zzz999");
    expect(a.split("\n")[8]).toBe("- [ ] No id yet 🆔 zzz999");
    expect(md.setTaskId(a, 8, "other1")).toBe(a);
  });

  it("renames while keeping done date and id", () => {
    const r = md.setTaskText(QUEST, 7, "Deep research");
    expect(r.split("\n")[7]).toBe("- [x] Deep research ✅ 2026-11-19 🆔 def456");
  });

  it("locates a task by id after lines moved", () => {
    const shifted = QUEST.replace("## Tasks\n", "## Tasks\n- [ ] new first\n");
    expect(md.locateTask(shifted, { id: "def456", line: 7, text: "Research" })).toBe(8);
    expect(md.locateTask(shifted, { id: "", line: 8, text: "No id yet" })).toBe(9);
    expect(md.locateTask(shifted, { id: "", line: 1, text: "gone" })).toBe(-1);
  });

  it("appends to an existing section before the next heading", () => {
    const c = "## Tasks\n- [ ] a\n\n## Notes\ntext\n";
    expect(md.appendToSection(c, "Tasks", "- [ ] b")).toBe("## Tasks\n- [ ] a\n- [ ] b\n\n## Notes\ntext\n");
  });

  it("creates a missing section", () => {
    expect(md.appendToSection("---\na: 1\n---\n", "Tasks", "- [ ] x")).toBe("---\na: 1\n---\n\n## Tasks\n- [ ] x\n");
  });
});

describe("sessions", () => {
  const DAY = `---
plan: []
---

## Sessions
- 09:15–10:05 Outline chapters · [[Write the book]] 🆔 abc123
- 13:00-13:30 Inbox · zero · [[Admin|alias]]
- garbage line
`;

  it("parses session lines, tolerating hyphens, aliases and ' · ' inside task text", () => {
    const ss = md.parseSessions(DAY, "2026-11-20");
    expect(ss).toEqual([
      { day: "2026-11-20", start: 555, end: 605, taskText: "Outline chapters", quest: "Write the book", taskId: "abc123", note: "", line: 5 },
      { day: "2026-11-20", start: 780, end: 810, taskText: "Inbox · zero", quest: "Admin", taskId: "", note: "", line: 6 },
    ]);
  });

  it("round-trips a session line", () => {
    const line = md.sessionLine({ start: 61, end: 1440, taskText: "Late", quest: "Q", taskId: "id1" });
    expect(line).toBe("- 01:01–24:00 Late · [[Q]] 🆔 id1");
    expect(md.parseSessions(line, "d")[0]).toMatchObject({ start: 61, end: 1440, quest: "Q" });
  });

  it("inserts sorted by start time", () => {
    const c = md.insertSession(DAY, "Sessions", { start: 600 + 60, end: 700, taskText: "Mid", quest: "Q", taskId: "" });
    expect(md.parseSessions(c, "d").map((s) => s.taskText)).toEqual(["Outline chapters", "Mid", "Inbox · zero"]);
    const early = md.insertSession(DAY, "Sessions", { start: 60, end: 90, taskText: "Early", quest: "Q", taskId: "" });
    expect(md.parseSessions(early, "d")[0]!.taskText).toBe("Early");
  });

  it("round-trips a session without a task text as a dash", () => {
    const line = md.sessionLine({ start: 540, end: 580, taskText: "", quest: "Travel book", taskId: "" });
    expect(line).toBe("- 09:00–09:40 — · [[Travel book]]");
    expect(md.parseSessions(line, "d")[0]).toMatchObject({ start: 540, end: 580, taskText: "—", taskId: "", quest: "Travel book" });
  });

  it("round-trips a session note and keeps it out of the link", () => {
    const line = md.sessionLine({ start: 555, end: 605, taskText: "Draft", quest: "Q", taskId: "abc123", note: "intro\n  done — mostly" });
    expect(line).toBe("- 09:15–10:05 Draft · [[Q]] 🆔 abc123 — intro done — mostly");
    expect(md.parseSessions(line, "d")[0]).toMatchObject({ taskText: "Draft", quest: "Q", taskId: "abc123", note: "intro done — mostly" });
    expect(md.parseSessions("- 09:00–10:00 A · [[Q]]", "d")[0]!.note).toBe("");
  });

  it("creates the sessions section in an empty note", () => {
    const c = md.insertSession("", "Sessions", { start: 60, end: 90, taskText: "X", quest: "Q", taskId: "" });
    expect(c).toBe("## Sessions\n- 01:00–01:30 X · [[Q]]\n");
  });

  it("replaces a session and keeps order", () => {
    const c = md.replaceSession(DAY, "Sessions", 5, { start: 900, end: 960, taskText: "Moved", quest: "Q", taskId: "" });
    expect(md.parseSessions(c, "d").map((s) => s.taskText)).toEqual(["Inbox · zero", "Moved"]);
  });
});

describe("answers", () => {
  it("reads and writes question sections without touching other content", () => {
    const base = "---\nx: 1\n---\n\n## Sessions\n- 09:00–10:00 A · [[Q]]\n";
    const w = md.writeAnswers(base, "Reflection", [["Went well?", "Lots"], ["Next?", "More\nlines"]]);
    expect(md.readAnswers(w, "Reflection")).toEqual({ "Went well?": "Lots", "Next?": "More\nlines" });
    expect(md.parseSessions(w, "d")).toHaveLength(1);
    const w2 = md.writeAnswers(w, "Reflection", [["Went well?", "Changed"]]);
    expect(md.readAnswers(w2, "Reflection")).toEqual({ "Went well?": "Changed" });
    expect(w2.match(/## Reflection/g)).toHaveLength(1);
  });

  it("keeps sections after the reflection", () => {
    const c = "## Reflection\n\n### Q\nold\n\n## After\nkeep\n";
    const w = md.writeAnswers(c, "Reflection", [["Q", "new"]]);
    expect(w).toBe("## Reflection\n\n### Q\nnew\n\n## After\nkeep\n");
  });
});
