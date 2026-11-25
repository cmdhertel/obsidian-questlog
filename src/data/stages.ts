// Stage reading and writing for quest notes. Pure, no Obsidian imports.
import { bare, bodyStart, codeMask, eolOf, splitLines } from "./lines";
import type { Stage } from "./model";

export const STAGES_HEADINGS = ["Stages", "Etappen"];
export const TASKS_HEADINGS = ["Tasks", "Aufgaben"];

/** Section names in the language to write. */
export interface SectionNames {
  stages: string;
  tasks: string;
}
/** What a caller remembers of a stage to find it again in changed content. */
export type StageRef = Pick<Stage, "index" | "line" | "name">;

export interface StageDates {
  started?: string | null;
  target?: string | null;
  reached?: string | null;
}

const MARK_RE = /(🛫|📅|✅)️?\s*(\d{4}-\d{2}-\d{2})(?!\d)/gu;
const STAGE_RE = /^###(?: (.*))?$/;
const SECTION_END_RE = /^#{1,2} /;
const TASKLINE_RE = /^\s*[-*+] \[.\] /;

function validDate(d: string): boolean {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** Heading text -> name and the first valid marker of each kind. Invalid dates stay in the name. */
function parseHeading(text: string): { name: string; started: string | null; target: string | null; reached: string | null } {
  const got: Record<string, string> = {};
  const name = text
    .replace(MARK_RE, (all, e: string, d: string) => {
      if (!validDate(d)) return all;
      if (!(e in got)) got[e] = d;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { name, started: got["🛫"] ?? null, target: got["📅"] ?? null, reached: got["✅"] ?? null };
}

/** A name fit for a heading: no line breaks, nothing that parses as a marker. */
function cleanName(name: string): string {
  return parseHeading(name.replace(/[\r\n]+/g, " ")).name;
}

function headingLine(name: string, s: string | null, t: string | null, r: string | null): string {
  return ["###", name, s && `🛫 ${s}`, t && `📅 ${t}`, r && `✅ ${r}`].filter(Boolean).join(" ");
}

interface Layout {
  ls: string[];
  mask: boolean[];
  /** Line of the first `## Stages` heading, -1 when missing. */
  h: number;
  /** First line after the Stages section. */
  end: number;
}

function layout(content: string): Layout {
  const ls = splitLines(content);
  const mask = codeMask(ls);
  let h = -1;
  for (let i = bodyStart(ls); i < ls.length; i++) {
    if (mask[i]) continue;
    const l = bare(ls[i] ?? "").trimEnd();
    if (STAGES_HEADINGS.some((n) => l === `## ${n}`)) {
      h = i;
      break;
    }
  }
  let end = ls.length;
  if (h !== -1) {
    for (let i = h + 1; i < ls.length; i++) {
      if (!mask[i] && SECTION_END_RE.test(bare(ls[i] ?? ""))) {
        end = i;
        break;
      }
    }
  }
  return { ls, mask, h, end };
}

function stagesOf(lay: Layout): Stage[] {
  const out: Stage[] = [];
  if (lay.h === -1) return out;
  for (let i = lay.h + 1; i < lay.end; i++) {
    if (lay.mask[i]) continue;
    const m = STAGE_RE.exec(bare(lay.ls[i] ?? ""));
    if (!m) continue;
    const prev = out[out.length - 1];
    if (prev) prev.end = i;
    out.push({ index: out.length, ...parseHeading(m[1] ?? ""), line: i, end: lay.end });
  }
  return out;
}

export function parseStages(content: string): Stage[] {
  return stagesOf(layout(content));
}

export function currentStage(stages: Stage[]): Stage | null {
  return stages.find((s) => !s.reached) ?? null;
}

/** The stage whose line range holds this line, or null (loose). */
export function stageOfLine(stages: Stage[], line: number): Stage | null {
  return stages.find((s) => line >= s.line && line < s.end) ?? null;
}

/** Index of the stage in the parsed content: by line and name, then index and name, then first name match; -1 if none. */
export function locateStage(content: string, stage: Pick<Stage, "index" | "line" | "name">): number {
  const stages = parseStages(content);
  return (
    stages.find((s) => s.line === stage.line && s.name === stage.name)?.index ??
    stages.find((s) => s.index === stage.index && s.name === stage.name)?.index ??
    stages.find((s) => s.name === stage.name)?.index ??
    -1
  );
}

// ---------------------------------------------------------------- line helpers

/** After a splice in a CRLF file: the last line has no "\r", a line that is no longer last (`exLast`) has one. Others stay as they are. */
function fixEnds(ls: string[], eol: string, exLast = -1): void {
  if (eol !== "\r\n") return;
  const last = ls.length - 1;
  const ex = ls[exLast];
  if (ex !== undefined && exLast < last && !ex.endsWith("\r")) ls[exLast] = `${ex}\r`;
  const l = ls[last];
  if (l?.endsWith("\r")) ls[last] = l.slice(0, -1);
}

/** Insert new lines (without line ending) at `at`, using the file's line ending. */
export function insertAt(ls: string[], at: number, add: string[], eol: string): void {
  const atEnd = at === ls.length;
  ls.splice(at, 0, ...(eol === "\r\n" ? add.map((l) => `${l}\r`) : add));
  fixEnds(ls, eol, atEnd ? at - 1 : -1);
}

/** Index after the last non-blank line in [from, to), at least `from`. */
function afterLastContent(ls: string[], from: number, to: number): number {
  let at = to;
  while (at > from && bare(ls[at - 1] ?? "").trim() === "") at--;
  return at;
}

/** The `## <heading>` section for one of `headings`: [heading line, end), or null. */
function sectionOf(ls: string[], mask: boolean[], headings: string[]): [number, number] | null {
  for (let i = bodyStart(ls); i < ls.length; i++) {
    if (mask[i]) continue;
    const l = bare(ls[i] ?? "").trimEnd();
    if (!headings.some((n) => l === `## ${n}`)) continue;
    let end = ls.length;
    for (let j = i + 1; j < ls.length; j++) {
      if (!mask[j] && SECTION_END_RE.test(bare(ls[j] ?? ""))) {
        end = j;
        break;
      }
    }
    return [i, end];
  }
  return null;
}

/** Append a whole section at the end of the note, like appendToSection. */
function appendSection(content: string, heading: string, add: string[]): string {
  const eol = eolOf(content);
  const trimmed = content.replace(/\s*$/, "");
  return `${trimmed}${trimmed ? eol + eol : ""}${[`## ${heading}`, ...add].join(eol)}${eol}`;
}

function editHeading(content: string, index: number, fn: (s: Stage) => string): string {
  const lay = layout(content);
  const s = stagesOf(lay)[index];
  if (!s) return content;
  const old = lay.ls[s.line] ?? "";
  const next = fn(s) + (old.endsWith("\r") ? "\r" : "");
  if (next === old) return content;
  lay.ls[s.line] = next;
  return lay.ls.join("\n");
}

// ---------------------------------------------------------------- writers

export function addStage(content: string, s: { name: string; started?: string; target?: string }, names: SectionNames): string {
  const name = cleanName(s.name);
  if (!name) return content;
  const ok = (d?: string) => (d && validDate(d) ? d : null);
  const heading = headingLine(name, ok(s.started), ok(s.target), null);
  const lay = layout(content);
  const eol = eolOf(content);
  if (lay.h !== -1) {
    insertAt(lay.ls, afterLastContent(lay.ls, lay.h + 1, lay.end), [heading], eol);
    return lay.ls.join("\n");
  }
  const tasks = sectionOf(lay.ls, lay.mask, TASKS_HEADINGS);
  if (!tasks) return appendSection(content, names.stages, [heading]);
  insertAt(lay.ls, tasks[0], [`## ${names.stages}`, heading, ""], eol);
  return lay.ls.join("\n");
}

export function setStageDates(content: string, index: number, patch: StageDates): string {
  const pick = (v: string | null | undefined, cur: string | null) => (v === undefined ? cur : v === null || validDate(v) ? v : cur);
  return editHeading(content, index, (s) => {
    const started = pick(patch.started, s.started);
    const target = pick(patch.target, s.target);
    const reached = pick(patch.reached, s.reached);
    if (started === s.started && target === s.target && reached === s.reached) return bareHeading(content, s);
    return headingLine(s.name, started, target, reached);
  });
}

/** The heading line as it stands (so an unchanged patch returns the content untouched). */
function bareHeading(content: string, s: Stage): string {
  return bare(splitLines(content)[s.line] ?? "");
}

export function renameStage(content: string, index: number, name: string): string {
  const clean = cleanName(name);
  if (!clean) return content;
  return editHeading(content, index, (s) => (s.name === clean ? bareHeading(content, s) : headingLine(clean, s.started, s.target, s.reached)));
}

export function moveStage(content: string, index: number, toIndex: number): string {
  const lay = layout(content);
  const stages = stagesOf(lay);
  const n = stages.length;
  if (index < 0 || index >= n || toIndex < 0 || toIndex >= n || index === toIndex) return content;
  const blocks = stages.map((s) => ({ start: s.line, end: afterLastContent(lay.ls, s.line + 1, s.end) }));
  const order = stages.map((_, i) => i);
  order.splice(index, 1);
  order.splice(toIndex, 0, index);
  const first = blocks[0]!.start;
  const lastEnd = blocks[n - 1]!.end;
  const out = lay.ls.slice(0, first);
  order.forEach((o, k) => {
    const b = blocks[o]!;
    out.push(...lay.ls.slice(b.start, b.end));
    const here = blocks[k]!;
    if (k < n - 1) out.push(...lay.ls.slice(here.end, blocks[k + 1]!.start));
  });
  out.push(...lay.ls.slice(lastEnd));
  // Without a final newline the moved stage may have held the note's last line.
  const tail = lastEnd === lay.ls.length ? out.indexOf(lay.ls[lastEnd - 1] ?? "", first) : -1;
  fixEnds(out, eolOf(content), tail);
  return out.join("\n");
}

export function removeStage(content: string, index: number): string {
  const lay = layout(content);
  const s = stagesOf(lay)[index];
  if (!s) return content;
  for (let i = s.line + 1; i < s.end; i++) if (bare(lay.ls[i] ?? "").trim() !== "") return content;
  lay.ls.splice(s.line, 1);
  fixEnds(lay.ls, eolOf(content));
  return lay.ls.join("\n");
}

/** Insert lines at the end of a stage body or of the Tasks section (created when missing). */
function insertBlock(content: string, target: number | "loose", add: string[], names: SectionNames): string {
  const lay = layout(content);
  const eol = eolOf(content);
  if (target === "loose") {
    const sec = sectionOf(lay.ls, lay.mask, TASKS_HEADINGS);
    if (!sec) return appendSection(content, names.tasks, add.map(bare));
    insertAt(lay.ls, afterLastContent(lay.ls, sec[0] + 1, sec[1]), add, eol);
    return lay.ls.join("\n");
  }
  const s = stagesOf(lay)[target];
  if (!s) return content;
  insertAt(lay.ls, afterLastContent(lay.ls, s.line + 1, s.end), add, eol);
  return lay.ls.join("\n");
}

export function addTaskToStage(content: string, index: number | "loose", line: string, names: SectionNames): string {
  return insertBlock(content, index, [bare(line)], names);
}

export function moveTaskToStage(content: string, taskLine: number, target: number | "loose", names: SectionNames): string {
  const lay = layout(content);
  const stages = stagesOf(lay);
  const first = lay.ls[taskLine];
  if (first === undefined || lay.mask[taskLine] || !TASKLINE_RE.test(bare(first))) return content;
  const from = stageOfLine(stages, taskLine);
  if (target === "loose" ? !from && !inStagesSection(lay, taskLine) : from?.index === target) return content;
  if (target !== "loose" && !stages[target]) return content;
  const indent = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
  const base = indent(first);
  let e = taskLine + 1;
  // Indented lines belong to the task; a code block that starts indented belongs to it whole, blank lines included.
  let fence = false;
  for (; e < lay.ls.length; e++) {
    const l = bare(lay.ls[e] ?? "");
    if (!fence && (l.trim() === "" || indent(l) <= base)) break;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
  }
  const block = lay.ls.slice(taskLine, e).map(bare);
  lay.ls.splice(taskLine, e - taskLine);
  fixEnds(lay.ls, eolOf(content));
  return insertBlock(lay.ls.join("\n"), target, block, names);
}

/** True for lines of the Stages section outside every stage (before the first `###`). */
function inStagesSection(lay: Layout, line: number): boolean {
  return lay.h !== -1 && line > lay.h && line < lay.end;
}

export function startCurrentStage(content: string, today: string): string {
  const cur = currentStage(parseStages(content));
  if (!cur || cur.started) return content;
  return setStageDates(content, cur.index, { started: today });
}

export function reopenStage(content: string, index: number): string {
  return setStageDates(content, index, { reached: null });
}
