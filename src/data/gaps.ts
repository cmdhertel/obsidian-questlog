// Unlogged stretches of a day and not-work time. Pure, no Obsidian imports.
import { fmtClock, parseClock, splitByDay } from "./dates";
import type { Span } from "./model";

export interface Gap extends Span {
  edge: "none" | "before" | "after";
}
/** A piece of work offered for a gap. An empty taskId means no task (quest only). */
export interface GapItem {
  quest: string;
  taskId: string;
  taskText: string;
}

const MIN_GAP = 15;

const valid = (s: Span): boolean => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start;

/** Sort and merge overlapping or touching spans; invalid spans are dropped. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter(valid).map((s) => ({ start: s.start, end: s.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push(s);
  }
  return out;
}

/** Subtract merged spans `cut` from `base` (both sorted, merged). */
function subtract(base: Span[], cut: Span[]): Span[] {
  const out: Span[] = [];
  for (const b of base) {
    let pos = b.start;
    for (const c of cut) {
      if (c.end <= pos) continue;
      if (c.start >= b.end) break;
      if (c.start > pos) out.push({ start: pos, end: c.start });
      pos = Math.max(pos, c.end);
    }
    if (pos < b.end) out.push({ start: pos, end: b.end });
  }
  return out;
}

function dayWindow(from: number, to: number, now?: number): Span | null {
  const end = now === undefined ? to : Math.min(to, now);
  const w = { start: from, end };
  return valid(w) ? w : null;
}

/**
 * Unlogged stretches in [from, min(to, now)], minus covered time and breaks, at least minLen long.
 * Minutes since midnight, end exclusive. Sorted by start. Empty when nothing is covered at all.
 * A piece before the first covered span is "before", after the last "after" (judged on the unclipped
 * covered time, before breaks are cut; pieces split by a break keep their edge).
 */
export function findGaps(o: { covered: Span[]; from: number; to: number; now?: number; breaks: Span[]; minLen?: number }): Gap[] {
  const covered = mergeSpans(o.covered);
  const w = dayWindow(o.from, o.to, o.now);
  if (covered.length === 0 || !w) return [];
  const minLen = o.minLen ?? MIN_GAP;
  const first = covered[0]!.start;
  const last = covered[covered.length - 1]!.end;
  const breaks = mergeSpans(o.breaks);
  const out: Gap[] = [];
  for (const piece of subtract([w], covered)) {
    const edge: Gap["edge"] = piece.end <= first ? "before" : piece.start >= last ? "after" : "none";
    for (const g of subtract([piece], breaks)) if (g.end - g.start >= minLen) out.push({ ...g, edge });
  }
  return out;
}

/** The part of a running timer that lies on `day` (end exclusive, up to now), or null. */
export function runningSpan(startMs: number, nowMs: number, day: string): Span | null {
  if (!(nowMs > startMs)) return null;
  const p = splitByDay(startMs, nowMs).find((x) => x.day === day);
  return p ? { start: p.start, end: p.end } : null;
}

const BREAK_RE = /^\s*(\d{1,2}[:.]\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}[:.]\d{2})\s*$/;

/** Tolerant read of the `breaks` frontmatter: array (or one string) of "HH:MM-HH:MM"; invalid entries skipped; sorted. */
export function parseBreaks(v: unknown): Span[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: Span[] = [];
  for (const e of list) {
    if (typeof e !== "string") continue;
    const m = BREAK_RE.exec(e);
    if (!m) continue;
    const a = parseClock(m[1]!), b = parseClock(m[2]!);
    if (a === null || b === null || b <= a) continue;
    out.push({ start: a, end: b });
  }
  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

/** "12:00-13:00" (plain hyphen). */
export function formatBreak(s: Span): string {
  return `${fmtClock(s.start)}-${fmtClock(s.end)}`;
}

const itemKey = (i: GapItem): string => (i.taskId ? `id:${i.taskId}` : `q:${i.quest}\u0000${i.taskText}`);

/** done, then planned, then last; first occurrence wins; at most max. */
export function gapSuggestions(i: { done: GapItem[]; planned: GapItem[]; last?: GapItem }, max = 6): GapItem[] {
  const seen = new Set<string>();
  const out: GapItem[] = [];
  for (const it of [...i.done, ...i.planned, ...(i.last ? [i.last] : [])]) {
    const k = itemKey(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

/** For a day without coverage: true when the window minus breaks still has a free stretch of minLen. */
export function hasFreeStretch(o: { from: number; to: number; now?: number; breaks: Span[]; minLen?: number }): boolean {
  const w = dayWindow(o.from, o.to, o.now);
  if (!w) return false;
  const minLen = o.minLen ?? MIN_GAP;
  return subtract([w], mergeSpans(o.breaks)).some((g) => g.end - g.start >= minLen);
}
