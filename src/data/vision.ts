// Reads and writes Questlog/Vision.md. Pure: no Obsidian imports, so it is tested directly.
import { bare, bodyStart, codeMask, eolOf, splitLines } from "./lines";
import type { VisionNote } from "./model";

/** Section and entry words written to the note; both languages are read. */
export interface VisionHeads {
  earlier: string;
  until: string;
}
const EN: VisionHeads = { earlier: "Earlier", until: "until" };
const EARLIER = ["Earlier", "Früher"];
const UNTIL = ["until", "bis"];
const ENTRY_RE = new RegExp(`^###\\s+(?:${UNTIL.join("|")})\\s+(\\d{4}-\\d{2}-\\d{2})\\s*$`, "i");
const H2_RE = /^##(\s|$)/;
const H3_RE = /^###(\s|$)/;

const isEarlierHeading = (line: string): boolean => {
  const m = /^##\s+(.*?)\s*$/.exec(line);
  return !!m && EARLIER.some((e) => e.toLowerCase() === m[1]!.toLowerCase());
};

/** Text lines without CR, so a pasted CRLF text is one text. */
const textLines = (text: string): string[] => text.trim().split(/\r?\n/);

/** Prefix a backslash to lines that would read as headings (up to `level` hashes), outside fences. */
function escapeLines(ls: string[], level: number): string[] {
  const re = new RegExp(`^\\\\*#{1,${level}}(?=\\s|$)`);
  const mask = codeMask(ls, 0);
  return ls.map((l, i) => (!mask[i] && re.test(l) ? "\\" + l : l));
}
function unescapeLines(ls: string[], level: number): string[] {
  const re = new RegExp(`^\\\\+#{1,${level}}(?=\\s|$)`);
  const mask = codeMask(ls, 0);
  return ls.map((l, i) => (!mask[i] && re.test(l) ? l.slice(1) : l));
}
/** A fence the text opens but never closes would swallow the sections below it; close it. */
function closeFence(ls: string[]): string[] {
  const fences = ls.filter((l) => /^\s*(```|~~~)/.test(l)).length;
  return fences % 2 === 1 ? [...ls, "```"] : ls;
}

interface Layout {
  ls: string[];
  start: number;
  /** First line after the lead block (the first `##` heading, or the end). */
  leadEnd: number;
  mask: boolean[];
}
function layout(content: string): Layout {
  const ls = splitLines(content);
  const start = bodyStart(ls);
  const mask = codeMask(ls, start);
  let leadEnd = ls.length;
  for (let i = start; i < ls.length; i++) {
    if (!mask[i] && H2_RE.test(bare(ls[i]!))) {
      leadEnd = i;
      break;
    }
  }
  return { ls, start, leadEnd, mask };
}

/** Index of the `## Earlier` / `## Früher` heading, or -1. */
function earlierAt(lay: Layout): number {
  for (let i = lay.leadEnd; i < lay.ls.length; i++) if (!lay.mask[i] && isEarlierHeading(bare(lay.ls[i]!))) return i;
  return -1;
}

export function parseVision(content: string): VisionNote {
  const lay = layout(content);
  const { ls, start, leadEnd, mask } = lay;
  const lead = unescapeLines(ls.slice(start, leadEnd).map(bare), 2);
  let updated: string | null = null;
  for (let i = 1; i < start - 1; i++) {
    const m = /^updated:\s*["']?([^"'\s]+)["']?\s*$/.exec(bare(ls[i]!));
    if (m) updated = m[1]!;
  }
  const earlier: VisionNote["earlier"] = [];
  const h = earlierAt(lay);
  if (h >= 0) {
    let cur: { until: string; body: string[] } | null = null;
    const flush = () => {
      if (cur) earlier.push({ until: cur.until, text: unescapeLines(cur.body, 3).join("\n").trim() });
      cur = null;
    };
    for (let i = h + 1; i < ls.length; i++) {
      const line = bare(ls[i]!);
      if (!mask[i] && H2_RE.test(line)) break;
      const m = mask[i] ? null : ENTRY_RE.exec(line);
      if (m) {
        flush();
        cur = { until: m[1]!, body: [] };
      } else if (!mask[i] && H3_RE.test(line)) flush();
      else if (cur) (cur as { body: string[] }).body.push(line);
    }
    flush();
  }
  return { text: lead.join("\n").trim(), updated, earlier };
}

/** Replace the lead block; frontmatter and everything from the first `##` heading on stay byte for byte. */
export function setVisionText(content: string, text: string): string {
  const { ls, start, leadEnd } = layout(content);
  const eol = eolOf(content);
  const cr = eol === "\r\n" ? "\r" : "";
  const head = ls.slice(0, start);
  const rest = ls.slice(leadEnd);
  const lead = text.trim() ? closeFence(escapeLines(textLines(text), 2)).map((l) => l + cr) : [];
  if (!rest.length) return [...head, ...lead, ""].join("\n");
  const gap = lead.length ? [cr] : [];
  return [...head, ...lead, ...gap, ...rest].join("\n");
}

/** Put `oldText` at the top of `## Earlier` as `### until <until>`; creates the section when missing. Empty text does nothing. */
export function archiveVision(content: string, oldText: string, until: string, heads: VisionHeads = EN): string {
  if (!oldText.trim()) return content;
  const eol = eolOf(content);
  const cr = eol === "\r\n" ? "\r" : "";
  const entry = [`### ${heads.until} ${until}`, ...closeFence(escapeLines(textLines(oldText), 3))].map((l) => l + cr);
  const lay = layout(content);
  const h = earlierAt(lay);
  if (h >= 0) {
    const ls = [...lay.ls];
    ls.splice(h + 1, 0, ...entry);
    return ls.join("\n");
  }
  const ls = [...lay.ls];
  if (ls[ls.length - 1] === "") ls.pop();
  // Keep a blank line before the new section unless the note is empty so far.
  const blank = ls.length && bare(ls[ls.length - 1]!) !== "" ? [cr] : [];
  return [...ls, ...blank, `## ${heads.earlier}${cr}`, ...entry, ""].join("\n");
}

export function newVisionNote(text: string, today: string): string {
  return setVisionText(`---\ntype: questlog-vision\nupdated: ${today}\n---\n`, text);
}
