// Stage edits the UI needs, composed from the writers in stages.ts. Pure, no Obsidian imports.
import { bare, codeMask, splitLines } from "./lines";
import type { Stage } from "./model";
import { currentStage, moveStage, moveTaskToStage, parseStages, removeStage, setStageDates, startCurrentStage, type SectionNames } from "./stages";

const OPEN_RE = /^\s*[-*+] \[ \] /;
const ANY_RE = /^\s*[-*+] \[.\] /;

/** First task line (matching `re`) in the body of stage `index`, or -1. */
function firstTaskIn(content: string, index: number, re: RegExp): number {
  const s = parseStages(content)[index];
  if (!s) return -1;
  const ls = splitLines(content);
  const mask = codeMask(ls);
  for (let i = s.line + 1; i < s.end; i++) if (!mask[i] && re.test(bare(ls[i] ?? ""))) return i;
  return -1;
}

/** Move task lines (with their indented children) out of stage `index`, one at a time in note order. */
function moveAll(content: string, index: number, re: RegExp, target: number | "loose", names: SectionNames): string {
  let out = content;
  for (let guard = 0; guard < 10000; guard++) {
    const line = firstTaskIn(out, index, re);
    if (line === -1) break;
    const next = moveTaskToStage(out, line, target, names);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** The first stage after `index` that is not reached, or null. */
export function nextOpenStage(stages: Pick<Stage, "index" | "reached">[], index: number): number | null {
  return stages.find((s) => s.index > index && !s.reached)?.index ?? null;
}

/** Number of open tasks (`- [ ]`) in the body of stage `index`. */
export function openTaskCount(content: string, index: number): number {
  const s = parseStages(content)[index];
  if (!s) return 0;
  const ls = splitLines(content);
  const mask = codeMask(ls);
  let n = 0;
  for (let i = s.line + 1; i < s.end; i++) if (!mask[i] && OPEN_RE.test(bare(ls[i] ?? ""))) n++;
  return n;
}

/**
 * Mark stage `index` as reached today. Its open tasks move to the next unreached stage ("next"; loose when there is
 * none) or to the Tasks section ("loose"). Then the new current stage gets 🛫 today unless it has one.
 */
export function reachStage(content: string, index: number, today: string, openTasks: "next" | "loose", names: SectionNames = { stages: "Stages", tasks: "Tasks" }): string {
  const stages = parseStages(content);
  const s = stages[index];
  if (!s || s.reached) return content;
  const next = openTasks === "next" ? nextOpenStage(stages, index) : null;
  let out = moveAll(content, index, OPEN_RE, next ?? "loose", names);
  out = setStageDates(out, index, { reached: today });
  return isCurrent(stages, index) ? startCurrentStage(out, today) : out;
}

/** Delete stage `index`: all its tasks (open, done, cancelled) move unchanged to the end of Tasks, then the heading line goes. */
export function deleteStageKeepTasks(content: string, index: number, today: string, names: SectionNames = { stages: "Stages", tasks: "Tasks" }): string {
  const stages = parseStages(content);
  if (!stages[index]) return content;
  const wasCurrent = isCurrent(stages, index);
  const after = (c: string) => (wasCurrent ? startCurrentStage(c, today) : c);
  const out = moveAll(content, index, ANY_RE, "loose", names);
  const removed = removeStage(out, index);
  if (removed !== out) return after(removed);
  // Text other than tasks stays; only the heading line goes.
  const s = parseStages(out)[index];
  if (!s) return out;
  const ls = splitLines(out);
  ls.splice(s.line, 1);
  const last = ls.length - 1;
  if (s.line > last && ls[last]?.endsWith("\r")) ls[last] = ls[last].slice(0, -1);
  return after(ls.join("\n"));
}

/** Move stage `index` one place up (-1) or down (+1); a stage that becomes current gets 🛫 today. */
export function moveStageStep(content: string, index: number, dir: -1 | 1, today: string): string {
  const to = index + dir;
  const moved = moveStage(content, index, to);
  if (moved === content) return content;
  const before = currentStage(parseStages(content))?.index ?? null;
  const after = currentStage(parseStages(moved))?.index ?? null;
  // Where the old current stage stands after the swap of two neighbours.
  const was = before === index ? to : before === to ? index : before;
  return after !== null && after !== was ? startCurrentStage(moved, today) : moved;
}

/** True when another stage (not `exceptIndex`) already has this name (case and spacing ignored). */
export function nameTaken(stages: Pick<Stage, "index" | "name">[], name: string, exceptIndex: number | null = null): boolean {
  const key = (n: string) => n.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const k = key(name);
  return stages.some((s) => s.index !== exceptIndex && key(s.name) === k);
}

/** True when stage `index` is the current one (first without ✅). */
export function isCurrent(stages: Stage[], index: number): boolean {
  return currentStage(stages)?.index === index;
}
