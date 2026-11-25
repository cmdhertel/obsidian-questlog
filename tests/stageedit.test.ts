import { describe, expect, it } from "vitest";
import { deleteStageKeepTasks, moveStageStep, nameTaken, nextOpenStage, openTaskCount, reachStage } from "../src/data/stageedit";
import { parseStages, reopenStage } from "../src/data/stages";

const note = [
  "---",
  "status: active",
  "---",
  "# Travel book",
  "",
  "## Stages",
  "### Research 🛫 2026-09-01 ✅ 2026-09-28",
  "- [x] Read three guides ✅ 2026-09-20 🆔 aaa111",
  "### Part two 🛫 2026-10-20 📅 2026-12-15",
  "- [ ] Draft the Lisbon chapter 🆔 abc",
  "### Edit",
  "",
  "## Tasks",
  "- [ ] Loose task 🆔 ghi789",
  "",
].join("\n");

const crlf = (s: string) => s.replace(/\n/g, "\r\n");

describe("reachStage", () => {
  it("moves open tasks to the next stage and starts it", () => {
    const out = reachStage(note, 1, "2026-11-24", "next");
    expect(out).toBe(
      note
        .replace("### Part two 🛫 2026-10-20 📅 2026-12-15", "### Part two 🛫 2026-10-20 📅 2026-12-15 ✅ 2026-11-24")
        .replace("- [ ] Draft the Lisbon chapter 🆔 abc\n### Edit\n", "### Edit 🛫 2026-11-24\n- [ ] Draft the Lisbon chapter 🆔 abc\n"),
    );
  });

  it("moves open tasks to the end of Tasks with 'loose'", () => {
    const out = reachStage(note, 1, "2026-11-24", "loose");
    const ls = out.split("\n");
    expect(ls[ls.indexOf("## Tasks") + 2]).toBe("- [ ] Draft the Lisbon chapter 🆔 abc");
    expect(out).toContain("### Edit 🛫 2026-11-24\n");
    expect(out).not.toMatch(/### Part two.*\n- \[ \]/);
  });

  it("keeps an existing 🛫 on the next stage", () => {
    const n = note.replace("### Edit", "### Edit 🛫 2026-11-01");
    expect(reachStage(n, 1, "2026-11-24", "next")).toContain("### Edit 🛫 2026-11-01\n- [ ] Draft");
  });

  it("falls back to loose when there is no next stage", () => {
    const n = note.replace("### Edit\n", "");
    const out = reachStage(n, 1, "2026-11-24", "next");
    expect(out.trimEnd().endsWith("- [ ] Draft the Lisbon chapter 🆔 abc")).toBe(true);
  });

  it("leaves a reached stage and the current one's 🛫 alone when reaching a later stage", () => {
    expect(reachStage(note, 0, "2026-11-24", "next")).toBe(note);
    const out = reachStage(note.replace("### Part two 🛫 2026-10-20", "### Part two"), 2, "2026-11-24", "next");
    expect(out).toContain("### Part two 📅 2026-12-15\n");
    expect(out).toContain("### Edit ✅ 2026-11-24");
  });

  it("moves indented children with the task and keeps CRLF", () => {
    const n = crlf(note.replace("- [ ] Draft the Lisbon chapter 🆔 abc", "- [ ] Draft the Lisbon chapter 🆔 abc\n  - ferry times\n- [x] Map 🆔 m1\n- [-] Cancelled"));
    const out = reachStage(n, 1, "2026-11-24", "next");
    expect(out).toContain("### Edit 🛫 2026-11-24\r\n- [ ] Draft the Lisbon chapter 🆔 abc\r\n  - ferry times\r\n");
    expect(out).toMatch(/✅ 2026-11-24\r\n- \[x\] Map 🆔 m1\r\n- \[-\] Cancelled\r\n### Edit/);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("counts open tasks and finds the next open stage", () => {
    expect(openTaskCount(note, 1)).toBe(1);
    expect(openTaskCount(note, 0)).toBe(0);
    expect(nextOpenStage(parseStages(note), 1)).toBe(2);
    expect(nextOpenStage(parseStages(note), 2)).toBeNull();
  });
});

describe("moveStageStep", () => {
  it("moves Edit before Part two and starts it", () => {
    const out = moveStageStep(note, 2, -1, "2026-11-24");
    const names = parseStages(out).map((s) => s.name);
    expect(names).toEqual(["Research", "Edit", "Part two"]);
    expect(out).toContain("### Edit 🛫 2026-11-24\n### Part two 🛫 2026-10-20 📅 2026-12-15\n- [ ] Draft the Lisbon chapter 🆔 abc\n");
  });

  it("does not add 🛫 when the current stage stays", () => {
    const n = note.replace("### Part two 🛫 2026-10-20", "### Part two");
    const out = moveStageStep(n, 0, 1, "2026-11-24");
    expect(parseStages(out).map((s) => s.name)).toEqual(["Part two", "Research", "Edit"]);
    expect(out).not.toContain("🛫 2026-11-24");
  });

  it("does nothing at the edges", () => {
    expect(moveStageStep(note, 0, -1, "2026-11-24")).toBe(note);
    expect(moveStageStep(note, 2, 1, "2026-11-24")).toBe(note);
  });
});

describe("deleteStageKeepTasks", () => {
  it("moves done and open tasks to Tasks in order", () => {
    const n = note.replace("- [ ] Draft the Lisbon chapter 🆔 abc", "- [x] Outline ✅ 2026-10-21 🆔 o1\n- [ ] Draft the Lisbon chapter 🆔 abc");
    const out = deleteStageKeepTasks(n, 1, "2026-11-24");
    expect(parseStages(out).map((s) => s.name)).toEqual(["Research", "Edit"]);
    expect(out).toContain("## Tasks\n- [ ] Loose task 🆔 ghi789\n- [x] Outline ✅ 2026-10-21 🆔 o1\n- [ ] Draft the Lisbon chapter 🆔 abc\n");
    // Part two was current: Edit takes over and starts today.
    expect(out).toContain("### Edit 🛫 2026-11-24");
  });

  it("leaves an empty Stages heading after the last stage", () => {
    let out = note;
    for (let i = 2; i >= 0; i--) out = deleteStageKeepTasks(out, i, "2026-11-24");
    expect(parseStages(out)).toEqual([]);
    expect(out).toContain("## Stages\n");
    expect(out).toContain("- [x] Read three guides");
  });

  it("keeps text that is not a task", () => {
    const n = note.replace("### Edit\n", "### Edit\nSome thoughts.\n");
    const out = deleteStageKeepTasks(n, 2, "2026-11-24");
    expect(out).toContain("- [ ] Draft the Lisbon chapter 🆔 abc\nSome thoughts.\n");
    expect(out).not.toContain("### Edit");
  });
});

describe("nameTaken and reopen", () => {
  it("finds a duplicate name except the stage itself", () => {
    const st = parseStages(note);
    expect(nameTaken(st, "part TWO")).toBe(true);
    expect(nameTaken(st, "Part two", 1)).toBe(false);
    expect(nameTaken(st, "Polish")).toBe(false);
  });

  it("returns the same string when reopening an open stage", () => {
    expect(reopenStage(note, 1)).toBe(note);
    expect(reopenStage(note, 0)).toContain("### Research 🛫 2026-09-01\n");
  });
});
