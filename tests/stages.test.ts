import { describe, expect, it } from "vitest";
import * as md from "../src/data/markdown";
import * as st from "../src/data/stages";

const NAMES = { stages: "Stages", tasks: "Tasks" };
const DE = { stages: "Etappen", tasks: "Aufgaben" };

const NOTE = `---
type: quest
---

## Stages
### Research 🛫 2026-09-01 ✅ 2026-09-28
- [x] Read three guides ✅ 2026-09-20 🆔 abc123
### Part two 🛫 2026-10-20 📅 2026-12-15
- [ ] Draft the Lisbon chapter 🆔 def456
  - [ ] sub item 🆔 sub111
  note under it
### Edit
## Tasks
- [ ] Loose task 🆔 ghi789
`;

const crlf = (s: string) => s.replace(/\n/g, "\r\n");

/** Indexes of lines that differ, after aligning equal-length arrays. */
function diffIdx(a: string, b: string): number[] {
  const x = a.split("\n");
  const y = b.split("\n");
  expect(y.length).toBe(x.length);
  return x.flatMap((l, i) => (l === y[i] ? [] : [i]));
}

describe("parseStages", () => {
  it("reads the example note", () => {
    const s = st.parseStages(NOTE);
    expect(s.map((x) => [x.index, x.name, x.started, x.target, x.reached, x.line])).toEqual([
      [0, "Research", "2026-09-01", null, "2026-09-28", 5],
      [1, "Part two", "2026-10-20", "2026-12-15", null, 7],
      [2, "Edit", null, null, null, 11],
    ]);
    expect(s[0]!.end).toBe(7);
    expect(s[2]!.end).toBe(12);
    expect(st.currentStage(s)?.name).toBe("Part two");
    const ts = md.parseTasks(NOTE, "Q.md");
    expect(ts.map((t) => [t.text, t.stage, t.stageIndex])).toEqual([
      ["Read three guides", "Research", 0],
      ["Draft the Lisbon chapter", "Part two", 1],
      ["sub item", "Part two", 1],
      ["Loose task", null, null],
    ]);
  });

  it("reads markers in any order, with U+FE0F, first one wins, invalid dates stay in the name", () => {
    const c = "## Stages\n### A ✅️ 2026-02-01 📅 2026-01-01 🛫 2025-12-01 📅 2027-01-01\n### B 📅 2026-02-30 🛫 x\n";
    const [a, b] = st.parseStages(c);
    expect([a!.name, a!.started, a!.target, a!.reached]).toEqual(["A", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect([b!.name, b!.target]).toEqual(["B 📅 2026-02-30 🛫 x", null]);
  });

  it("keeps other signifiers in the name", () => {
    expect(st.parseStages("## Stages\n### Go ⏳ 2026-01-01 🛫 2026-01-02\n")[0]!.name).toBe("Go ⏳ 2026-01-01");
  });

  it("accepts an empty heading as a stage with an empty name", () => {
    const s = st.parseStages("## Stages\n###\n### \n### x\n");
    expect(s.map((x) => x.name)).toEqual(["", "", "x"]);
  });

  it("keeps repeated names as separate stages", () => {
    const c = "## Stages\n### Same\n- [ ] a\n### Same\n- [ ] b\n";
    const ts = md.parseTasks(c, "Q.md");
    expect(ts.map((t) => [t.stage, t.stageIndex])).toEqual([["Same", 0], ["Same", 1]]);
  });

  it("current is the first stage without a done mark, later done marks do not change it", () => {
    const s = st.parseStages("## Stages\n### A ✅ 2026-01-01\n### B\n### C ✅ 2026-01-02\n### D\n");
    expect(st.currentStage(s)?.name).toBe("B");
    expect(st.currentStage(st.parseStages("## Stages\n### A ✅ 2026-01-01\n"))).toBeNull();
    expect(st.currentStage([])).toBeNull();
  });

  it("ignores headings, sections and tasks in code fences", () => {
    const c = "## Stages\n### A\n```\n### fake\n## Tasks\n- [ ] in code\n```\n- [ ] real\n~~~\n### x\n~~~\n";
    expect(st.parseStages(c).map((s) => s.name)).toEqual(["A"]);
    expect(md.parseTasks(c, "Q").map((t) => t.text)).toEqual(["real"]);
    expect(st.parseStages("```\n## Stages\n### A\n```\n")).toEqual([]);
  });

  it("ends the section at # or ##, #### belongs to the body, ### outside is no stage", () => {
    const c = "### Before\n## Stages\n### A\n#### deep\n- [ ] t\n# Top\n### After\n## Tasks\n### Other\n";
    const s = st.parseStages(c);
    expect(s.map((x) => x.name)).toEqual(["A"]);
    expect(s[0]!.end).toBe(5);
    const ts = md.parseTasks(c, "Q");
    expect(ts[0]!.stage).toBe("A");
  });

  it("only the first Stages section counts; both languages read", () => {
    const c = "## Etappen\n### A\n## Stages\n### B\n- [ ] late\n## Tasks\n";
    expect(st.parseStages(c).map((s) => s.name)).toEqual(["A"]);
    expect(md.parseTasks(c, "Q")[0]!.stage).toBeNull();
    expect(st.parseStages("## Etappen\n### Eins\n").length).toBe(1);
  });

  it("heading match is exact and at column 0", () => {
    expect(st.parseStages(" ## Stages\n### A\n")).toEqual([]);
    expect(st.parseStages("## stages\n### A\n")).toEqual([]);
  });

  it("loose tasks: before the first ###, outside the section, cancelled skipped", () => {
    const c = "## Stages\n- [ ] early\n### A\n- [-] gone\n- [ ] in A\n## Tasks\n- [ ] late\n";
    expect(md.parseTasks(c, "Q").map((t) => [t.text, t.stage])).toEqual([["early", null], ["in A", "A"], ["late", null]]);
  });

  it("1.x notes without stages parse as before", () => {
    const c = "---\nstatus: active\n---\n\n## Tasks\n- [ ] a 🆔 abc123\n- [x] b ✅ 2026-11-19\n";
    expect(st.parseStages(c)).toEqual([]);
    expect(md.parseTasks(c, "Q").map((t) => [t.id, t.text, t.done, t.doneDate, t.line, t.stage, t.stageIndex])).toEqual([
      ["abc123", "a", false, null, 5, null, null],
      ["", "b", true, "2026-11-19", 6, null, null],
    ]);
  });

  it("stageOfLine and locateStage", () => {
    const s = st.parseStages(NOTE);
    expect(st.stageOfLine(s, 8)?.name).toBe("Part two");
    expect(st.stageOfLine(s, 14)).toBeNull();
    expect(st.locateStage(NOTE, s[1]!)).toBe(1);
    const moved = "## Stages\n### New\n### Part two\n";
    expect(st.locateStage(moved, s[1]!)).toBe(1); // by name
    expect(st.locateStage(moved, { index: 0, line: 99, name: "Nope" })).toBe(-1);
  });
});

describe("CRLF", () => {
  it("parses the same as LF", () => {
    expect(st.parseStages(crlf(NOTE))).toEqual(st.parseStages(NOTE));
    expect(md.parseTasks(crlf(NOTE), "Q")).toEqual(md.parseTasks(NOTE, "Q"));
  });

  it("writers keep CRLF and add no LF-only lines", () => {
    const c = crlf(NOTE);
    const outs = [
      st.addStage(c, { name: "Ship" }, NAMES),
      st.addTaskToStage(c, 1, "- [ ] new 🆔 n1", NAMES),
      st.addTaskToStage(c, "loose", "- [ ] new 🆔 n1", NAMES),
      st.moveTaskToStage(c, 8, 0, NAMES),
      st.moveStage(c, 2, 0),
      st.setStageDates(c, 2, { target: "2027-01-01" }),
      st.renameStage(c, 0, "Study"),
      st.startCurrentStage(crlf("## Stages\n### A\n"), "2026-01-01"),
      md.setTaskDone(c, 8, true, "2026-11-25"),
      md.setTaskText(c, 8, "Renamed"),
    ];
    for (const o of outs) {
      expect(o).not.toBe(c);
      expect(o.replace(/\r\n/g, "").includes("\n")).toBe(false);
      expect(o.replace(/\r\n/g, "").includes("\r")).toBe(false);
    }
    expect(md.setTaskDone(c, 8, true, "2026-11-25").split("\r\n")[8]).toBe("- [x] Draft the Lisbon chapter ✅ 2026-11-25 🆔 def456");
  });

  it("task writers keep the \\r", () => {
    const c = "## Tasks\r\n- [ ] a\r\n- [ ] b 🆔 x1y2z3\r\n";
    expect(md.setTaskId(c, 1, "abc123")).toBe("## Tasks\r\n- [ ] a 🆔 abc123\r\n- [ ] b 🆔 x1y2z3\r\n");
    expect(md.setTaskText(c, 2, "c")).toBe("## Tasks\r\n- [ ] a\r\n- [ ] c 🆔 x1y2z3\r\n");
    expect(md.setTaskDone(c, 1, true, "2026-01-01")).toBe("## Tasks\r\n- [x] a ✅ 2026-01-01\r\n- [ ] b 🆔 x1y2z3\r\n");
  });

  it("appendToSection uses the file's line ending", () => {
    expect(md.appendToSection("## Tasks\r\n- [ ] a\r\n", "Tasks", "- [ ] b")).toBe("## Tasks\r\n- [ ] a\r\n- [ ] b\r\n");
    expect(md.appendToSection("x\r\n", "Tasks", "- [ ] b")).toBe("x\r\n\r\n## Tasks\r\n- [ ] b\r\n");
  });

  it("no trailing newline: insert at the end", () => {
    const c = "## Stages\r\n### A\r\n- [ ] a";
    expect(st.addTaskToStage(c, 0, "- [ ] b", NAMES)).toBe("## Stages\r\n### A\r\n- [ ] a\r\n- [ ] b");
    expect(st.moveTaskToStage(c, 2, "loose", NAMES)).toBe("## Stages\r\n### A\r\n\r\n## Tasks\r\n- [ ] a\r\n".replace("\r\n\r\n## Tasks", "\r\n\r\n## Tasks"));
  });
});

describe("addStage", () => {
  it("appends after the last non-empty line of the section", () => {
    const o = st.addStage(NOTE, { name: "Ship", started: "2027-01-01", target: "2027-02-01" }, NAMES);
    expect(o.split("\n")[12]).toBe("### Ship 🛫 2027-01-01 📅 2027-02-01");
    expect(o.split("\n").length).toBe(NOTE.split("\n").length + 1);
    expect(st.parseStages(o).map((s) => s.name)).toEqual(["Research", "Part two", "Edit", "Ship"]);
  });

  it("creates the section before Tasks, in either language, written in the given one", () => {
    const c = "---\na: 1\n---\n\nIntro\n\n## Aufgaben\n- [ ] t\n";
    const o = st.addStage(c, { name: "Eins" }, DE);
    expect(o).toBe("---\na: 1\n---\n\nIntro\n\n## Etappen\n### Eins\n\n## Aufgaben\n- [ ] t\n");
    expect(st.parseStages(o)[0]!.name).toBe("Eins");
  });

  it("appends the section at the end without a Tasks heading", () => {
    expect(st.addStage("Intro\n", { name: "A" }, NAMES)).toBe("Intro\n\n## Stages\n### A\n");
    expect(st.addStage("", { name: "A" }, NAMES)).toBe("## Stages\n### A\n");
  });

  it("ignores a Tasks heading in a code fence", () => {
    const c = "```\n## Tasks\n```\n";
    expect(st.addStage(c, { name: "A" }, NAMES)).toBe("```\n## Tasks\n```\n\n## Stages\n### A\n");
  });

  it("sanitises names, never writes an empty one", () => {
    expect(st.addStage("## Stages\n", { name: "A\nB 🛫 2026-01-01" }, NAMES)).toBe("## Stages\n### A B\n");
    expect(st.addStage("## Stages\n", { name: "  " }, NAMES)).toBe("## Stages\n");
    expect(st.addStage("## Stages\n", { name: "A", started: "nope" }, NAMES)).toBe("## Stages\n### A\n");
  });

  it("keeps a missing final newline in the middle, one newline when appending a section", () => {
    expect(st.addStage("## Stages\n### A", { name: "B" }, NAMES)).toBe("## Stages\n### A\n### B");
    expect(st.addStage("x", { name: "B" }, NAMES)).toBe("x\n\n## Stages\n### B\n");
  });

  it("changes only the added lines", () => {
    const o = st.addStage(NOTE, { name: "Ship" }, NAMES);
    const a = NOTE.split("\n");
    const b = o.split("\n");
    expect([...b.slice(0, 12), ...b.slice(13)]).toEqual(a);
  });
});

describe("setStageDates", () => {
  it("rewrites only the heading line, in normal form", () => {
    const o = st.setStageDates(NOTE, 1, { target: null, reached: "2026-11-01" });
    expect(diffIdx(NOTE, o)).toEqual([7]);
    expect(o.split("\n")[7]).toBe("### Part two 🛫 2026-10-20 ✅ 2026-11-01");
    expect(st.setStageDates(NOTE, 2, { started: "2026-01-01", target: "2026-02-01" }).split("\n")[11]).toBe("### Edit 🛫 2026-01-01 📅 2026-02-01");
  });

  it("returns the same string when nothing changes, even for hand-written order", () => {
    const c = "## Stages\n### A ✅ 2026-02-01 🛫 2026-01-01\n";
    expect(st.setStageDates(c, 0, { started: "2026-01-01", reached: "2026-02-01" })).toBe(c);
    expect(st.setStageDates(c, 0, {})).toBe(c);
    expect(st.setStageDates(c, 5, { started: "2026-01-01" })).toBe(c);
    expect(st.setStageDates(c, 0, { started: "2026-13-01" })).toBe(c);
  });

  it("is idempotent", () => {
    const once = st.setStageDates(NOTE, 2, { target: "2027-01-01" });
    expect(st.setStageDates(once, 2, { target: "2027-01-01" })).toBe(once);
    const removed = st.setStageDates(NOTE, 0, { reached: null });
    expect(st.setStageDates(removed, 0, { reached: null })).toBe(removed);
  });

  it("keeps an empty name empty", () => {
    expect(st.setStageDates("## Stages\n###\n", 0, { started: "2026-01-01" })).toBe("## Stages\n### 🛫 2026-01-01\n");
    expect(st.setStageDates("## Stages\n### 🛫 2026-01-01\n", 0, { started: null })).toBe("## Stages\n###\n");
  });
});

describe("renameStage / removeStage / reopen / start", () => {
  it("renames only the heading, keeps markers", () => {
    const o = st.renameStage(NOTE, 0, "Study");
    expect(diffIdx(NOTE, o)).toEqual([5]);
    expect(o.split("\n")[5]).toBe("### Study 🛫 2026-09-01 ✅ 2026-09-28");
    expect(st.renameStage(o, 0, "Study")).toBe(o);
    expect(st.renameStage(NOTE, 0, "  ")).toBe(NOTE);
    expect(st.renameStage(NOTE, 9, "x")).toBe(NOTE);
    expect(st.renameStage(NOTE, 0, "A\nB ✅ 2026-01-01").split("\n")[5]).toBe("### A B 🛫 2026-09-01 ✅ 2026-09-28");
  });

  it("removes a stage only when its body is empty", () => {
    expect(st.removeStage(NOTE, 1)).toBe(NOTE);
    const o = st.removeStage(NOTE, 2);
    expect(o.split("\n")).toEqual([...NOTE.split("\n").slice(0, 11), ...NOTE.split("\n").slice(12)]);
    const blank = "## Stages\n### A\n\n### B\n- [ ] x\n";
    expect(st.removeStage(blank, 0)).toBe("## Stages\n\n### B\n- [ ] x\n");
  });

  it("reopens (idempotent) and starts the current stage once", () => {
    const o = st.reopenStage(NOTE, 0);
    expect(o.split("\n")[5]).toBe("### Research 🛫 2026-09-01");
    expect(st.reopenStage(o, 0)).toBe(o);
    expect(st.reopenStage(NOTE, 2)).toBe(NOTE);
    const s = st.startCurrentStage(NOTE, "2026-11-25");
    expect(s).toBe(NOTE); // Part two already started
    const n = "## Stages\n### A ✅ 2026-01-01\n### B\n- [ ] t\n";
    const s2 = st.startCurrentStage(n, "2026-11-25");
    expect(s2).toBe("## Stages\n### A ✅ 2026-01-01\n### B 🛫 2026-11-25\n- [ ] t\n");
    expect(st.startCurrentStage(s2, "2026-12-01")).toBe(s2);
    expect(st.startCurrentStage("## Stages\n### A ✅ 2026-01-01\n", "2026-11-25")).toBe("## Stages\n### A ✅ 2026-01-01\n");
    expect(st.startCurrentStage("nothing", "2026-11-25")).toBe("nothing");
  });
});

describe("moveStage", () => {
  const C = "## Stages\n### A\n- [ ] a\n### B\n- [ ] b\n  child\n### C\n\n## Tasks\n- [ ] l\n";
  it("moves heading plus body and leaves the separator blank line in place", () => {
    const o = st.moveStage(C, 2, 0);
    expect(o).toBe("## Stages\n### C\n### A\n- [ ] a\n### B\n- [ ] b\n  child\n\n## Tasks\n- [ ] l\n");
    expect(st.parseStages(o).map((s) => s.name)).toEqual(["C", "A", "B"]);
    expect(md.parseTasks(o, "Q").map((t) => t.stage)).toEqual(["A", "B", null]);
  });
  it("moves down and ignores bad indexes", () => {
    expect(st.moveStage(C, 0, 1)).toBe("## Stages\n### B\n- [ ] b\n  child\n### A\n- [ ] a\n### C\n\n## Tasks\n- [ ] l\n");
    expect(st.moveStage(C, 1, 1)).toBe(C);
    expect(st.moveStage(C, 0, 3)).toBe(C);
    expect(st.moveStage(C, -1, 0)).toBe(C);
  });
  it("keeps a missing final newline at the end", () => {
    expect(st.moveStage("## Stages\n### A\n- [ ] a\n### B\n- [ ] b", 1, 0)).toBe("## Stages\n### B\n- [ ] b\n### A\n- [ ] a");
    expect(st.moveStage("## Stages\r\n### A\r\n- [ ] a\r\n### B\r\n- [ ] b", 1, 0)).toBe("## Stages\r\n### B\r\n- [ ] b\r\n### A\r\n- [ ] a");
  });
});

describe("tasks and stages", () => {
  it("adds a task after the last non-empty line of the stage body", () => {
    const o = st.addTaskToStage(NOTE, 1, "- [ ] new 🆔 n1", NAMES);
    expect(o.split("\n")[11]).toBe("- [ ] new 🆔 n1");
    expect(o.split("\n").length).toBe(NOTE.split("\n").length + 1);
    const empty = st.addTaskToStage(NOTE, 2, "- [ ] new", NAMES);
    expect(empty.split("\n")[12]).toBe("- [ ] new");
    expect(md.parseTasks(empty, "Q").find((t) => t.text === "new")?.stage).toBe("Edit");
    expect(st.addTaskToStage(NOTE, 7, "- [ ] x", NAMES)).toBe(NOTE);
  });

  it("adds loose tasks to Tasks or Aufgaben, creating the section when missing", () => {
    expect(st.addTaskToStage("## Aufgaben\n- [ ] a\n\n## X\n", "loose", "- [ ] b", NAMES)).toBe("## Aufgaben\n- [ ] a\n- [ ] b\n\n## X\n");
    expect(st.addTaskToStage("## Stages\n### A\n", "loose", "- [ ] b", DE)).toBe("## Stages\n### A\n\n## Aufgaben\n- [ ] b\n");
  });

  it("moves a task with its sub-items and notes to the end of the target", () => {
    const o = st.moveTaskToStage(NOTE, 8, 0, NAMES);
    const ls = o.split("\n");
    expect(ls.slice(5, 11)).toEqual([
      "### Research 🛫 2026-09-01 ✅ 2026-09-28",
      "- [x] Read three guides ✅ 2026-09-20 🆔 abc123",
      "- [ ] Draft the Lisbon chapter 🆔 def456",
      "  - [ ] sub item 🆔 sub111",
      "  note under it",
      "### Part two 🛫 2026-10-20 📅 2026-12-15",
    ]);
    expect(ls.length).toBe(NOTE.split("\n").length);
    expect(md.parseTasks(o, "Q").map((t) => t.stage)).toEqual(["Research", "Research", "Research", null]);
  });

  it("moves a task to loose and from loose into a stage", () => {
    const o = st.moveTaskToStage(NOTE, 8, "loose", NAMES);
    expect(o.split("\n").slice(-6)).toEqual(["## Tasks", "- [ ] Loose task 🆔 ghi789", "- [ ] Draft the Lisbon chapter 🆔 def456", "  - [ ] sub item 🆔 sub111", "  note under it", ""]);
    const back = st.moveTaskToStage(o, 10, 2, NAMES);
    expect(md.parseTasks(back, "Q").find((t) => t.text === "Loose task")?.stage).toBe("Edit");
  });

  it("leaves content alone for impossible moves", () => {
    expect(st.moveTaskToStage(NOTE, 8, 1, NAMES)).toBe(NOTE); // already there
    expect(st.moveTaskToStage(NOTE, 13, "loose", NAMES)).toBe(NOTE);
    expect(st.moveTaskToStage(NOTE, 6, 9, NAMES)).toBe(NOTE);
    expect(st.moveTaskToStage(NOTE, 5, 0, NAMES)).toBe(NOTE); // not a task line
    expect(st.moveTaskToStage(NOTE, 99, 0, NAMES)).toBe(NOTE);
  });

  it("moves a loose task out of the Stages preamble into Tasks", () => {
    const c = "## Stages\n- [ ] early\n### A\n## Tasks\n- [ ] l\n";
    expect(st.moveTaskToStage(c, 1, "loose", NAMES)).toBe("## Stages\n### A\n## Tasks\n- [ ] l\n- [ ] early\n");
  });

  it("round trips through parse after every writer", () => {
    const ops = [
      st.addStage(NOTE, { name: "Ship" }, NAMES),
      st.renameStage(NOTE, 2, "Polish"),
      st.moveStage(NOTE, 0, 2),
      st.setStageDates(NOTE, 2, { started: "2027-01-01" }),
    ];
    for (const o of ops) {
      const ts = md.parseTasks(o, "Q");
      expect(ts.map((t) => t.text).sort()).toEqual(md.parseTasks(NOTE, "Q").map((t) => t.text).sort());
    }
  });
});

describe("mixed line endings and code blocks", () => {
  it("writers leave other lines of a mixed file alone", () => {
    const c = ["## Stages", "### A\r", "- [ ] one", "- [ ] two\r", "", "## Tasks\r", "- [ ] loose"].join("\n");
    const o = st.addTaskToStage(c, 0, "- [ ] new", { stages: "Stages", tasks: "Tasks" });
    expect(o.split("\n").filter((l) => !l.startsWith("- [ ] new"))).toEqual(c.split("\n"));
    expect(md.appendToSection(c, "Tasks", "- [ ] new").split("\n").slice(0, 6)).toEqual(c.split("\n").slice(0, 6));
  });
  it("CRLF without a final newline: moving the last stage up keeps the endings", () => {
    const c = ["## Stages", "### A", "### B", "- [ ] one"].join("\r\n");
    expect(st.moveStage(c, 1, 0)).toBe(["## Stages", "### B", "- [ ] one", "### A"].join("\r\n"));
    expect(st.removeStage(["## Stages", "### A", "### B"].join("\r\n"), 1)).toBe(["## Stages", "### A"].join("\r\n"));
  });
  it("moves a code block under a task whole, and leaves one at the same level", () => {
    const c = ["## Stages", "### A", "- [ ] one", "  ```", "  x", "", "  y", "  ```", "```", "z", "```", "", "### B", ""].join("\n");
    expect(st.moveTaskToStage(c, 2, 1, { stages: "Stages", tasks: "Tasks" })).toBe(
      ["## Stages", "### A", "```", "z", "```", "", "### B", "- [ ] one", "  ```", "  x", "", "  y", "  ```", ""].join("\n"),
    );
  });
});
