import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertInside, buildVaultFiles, writeDemoVault } from "../scripts/smoke/demo-vault.mjs";
import { addDays } from "../src/data/dates";
import * as md from "../src/data/markdown";
import { currentStage, parseStages } from "../src/data/stages";
import { parseVision } from "../src/data/vision";

const TODAY = "2026-11-25";
const files = buildVaultFiles(TODAY);
const under = (dir: string) => Object.entries(files).filter(([p]) => p.startsWith(dir));

describe("demo vault", () => {
  it("has three quests with tasks the plugin can read", () => {
    const quests = under("Questlog/Quests/");
    expect(quests.map(([p]) => p).sort()).toEqual(["Questlog/Quests/Garden.md", "Questlog/Quests/Spanish B2.md", "Questlog/Quests/Travel book.md"]);
    for (const [path, content] of quests) {
      const tasks = md.parseTasks(content, path);
      expect(tasks.length).toBeGreaterThan(4);
      expect(tasks.every((x) => x.id)).toBe(true);
      expect(tasks.some((x) => x.done && x.doneDate)).toBe(true);
      expect(tasks.some((x) => !x.done)).toBe(true);
    }
  });

  it("has stages with one current stage each, and a vision", () => {
    for (const [path, content] of under("Questlog/Quests/")) {
      const stages = parseStages(content);
      expect(stages.length).toBeGreaterThan(0);
      expect(currentStage(stages)?.started).toBeTruthy();
      expect(md.parseTasks(content, path).some((x) => x.stage !== null)).toBe(true);
    }
    expect(parseVision(files["Questlog/Vision.md"]!).text).toMatch(/^A finished little book/);
  });

  it("task ids are unique across the vault", () => {
    const ids = Object.entries(files)
      .filter(([p]) => p.endsWith(".md") && !p.includes("/Days/"))
      .flatMap(([p, c]) => md.parseTasks(c, p).map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has about six weeks of sessions, none in the future or before the window", () => {
    const sessions = under("Questlog/Days/").flatMap(([p, c]) => md.parseSessions(c, p.slice(-13, -3)));
    expect(sessions.length).toBeGreaterThan(30);
    const days = new Set(sessions.map((s) => s.day));
    expect(days.size).toBeGreaterThan(20);
    const first = addDays(TODAY, -42);
    for (const d of days) {
      expect(d >= first).toBe(true);
      expect(d < TODAY).toBe(true);
    }
    for (const s of sessions) expect(s.end).toBeGreaterThan(s.start);
    expect(sessions.every((s) => s.taskText && s.quest)).toBe(true);
  });

  it("does not overlap sessions within a day", () => {
    for (const [p, c] of under("Questlog/Days/")) {
      const ss = md.parseSessions(c, p).sort((a, b) => a.start - b.start);
      for (let i = 1; i < ss.length; i++) expect(ss[i]!.start).toBeGreaterThanOrEqual(ss[i - 1]!.end);
    }
  });

  it("plans open tasks for today and tomorrow", () => {
    for (const day of [TODAY, addDays(TODAY, 1)]) {
      const c = files[`Questlog/Days/${day}.md`] ?? "";
      expect(/^plan: \[\w+(, \w+)*\]$/m.test(c)).toBe(true);
    }
  });

  it("has one review for last week and a vision note", () => {
    expect(under("Questlog/Reviews/").map(([p]) => p)).toEqual(["Questlog/Reviews/2026-W47.md"]);
    expect(Object.keys(files)).toContain("Questlog/Vision.md");
  });

  it("enables the plugin and sets alwaysUpdateLinks", () => {
    expect(JSON.parse(files[".obsidian/community-plugins.json"] ?? "")).toEqual(["questlog"]);
    expect(JSON.parse(files[".obsidian/app.json"] ?? "").alwaysUpdateLinks).toBe(true);
  });

  it("is deterministic for one day", () => {
    expect(buildVaultFiles(TODAY)).toEqual(files);
  });
});

describe("demo vault on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "questlog-demo-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes every file inside the target directory", () => {
    const written = writeDemoVault(join(dir, "vault"), { today: TODAY });
    expect(written.length).toBe(Object.keys(files).length);
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const onDisk = walk(join(dir, "vault"));
    expect(onDisk.length).toBe(written.length);
    for (const f of onDisk) expect(relative(join(dir, "vault"), f).startsWith("..")).toBe(false);
    expect(readFileSync(join(dir, "vault", "Questlog", "Vision.md"), "utf8")).toContain("questlog-vision");
  });

  it("refuses paths outside its folder", () => {
    expect(() => assertInside(dir, join(dir, "..", "elsewhere"))).toThrow(/outside/);
    expect(() => assertInside(dir, "/")).toThrow(/outside/);
    expect(assertInside(dir, join(dir, "a", "b"))).toBe(join(dir, "a", "b"));
  });
});
