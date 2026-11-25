// The quest story: a quest's history week by week, read back from existing notes. Pure, no Obsidian imports. Stores nothing.
import { weekStart } from "./dates";
import { dur } from "./stats";

export type MarkKind = "created" | "stage-started" | "stage-reached" | "paused" | "finished";
export interface StoryMark {
  day: string;
  kind: MarkKind;
  stage?: string;
}
export interface StoryWeek {
  weekStart: string;
  minutes: number;
  sessionCount: number;
  marks: StoryMark[];
  done: { day: string; text: string; stage: string | null }[];
  notes: { day: string; text: string }[];
  closing: { day: string; text: string }[];
  reflections: { question: string; text: string }[];
}

export interface StoryInput {
  quest: {
    name: string;
    created: string | null;
    paused: string | null;
    finished: string | null;
    stages: { name: string; started: string | null; reached: string | null }[];
    tasks: { text: string; done: boolean; doneDate: string | null; stage: string | null; line: number }[];
  };
  /** Sessions of this quest only. */
  sessions: { day: string; start: number; end: number; note: string }[];
  /** Closing line per day; empty texts are skipped. */
  closing: { day: string; text: string }[];
  /** Reviews with the last day of their period. */
  reviews: { id: string; lastDay: string; answers: Record<string, string> }[];
}

const MARK_ORDER: MarkKind[] = ["stage-reached", "stage-started", "created", "paused", "finished"];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` names the quest: `[[Name]]` (also with `|alias` or `#heading`) or the name as a whole word, any case. */
export function mentionsQuest(text: string, name: string): boolean {
  const n = name.trim();
  if (!n || !text) return false;
  // Whole word: no letter or digit right before or after. Links are covered too: `[`, `|`, `#` and `]` are no letters.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function buildStory(i: StoryInput, range?: { from?: string; to?: string }): StoryWeek[] {
  const weeks = new Map<string, StoryWeek>();
  const week = (day: string): StoryWeek => {
    const ws = weekStart(day);
    let w = weeks.get(ws);
    if (!w) {
      w = { weekStart: ws, minutes: 0, sessionCount: 0, marks: [], done: [], notes: [], closing: [], reflections: [] };
      weeks.set(ws, w);
    }
    return w;
  };
  const q = i.quest;

  const marks: StoryMark[] = [];
  if (q.created) marks.push({ day: q.created, kind: "created" });
  for (const s of q.stages) {
    if (s.started) marks.push({ day: s.started, kind: "stage-started", stage: s.name });
    if (s.reached) marks.push({ day: s.reached, kind: "stage-reached", stage: s.name });
  }
  if (q.paused) marks.push({ day: q.paused, kind: "paused" });
  if (q.finished) marks.push({ day: q.finished, kind: "finished" });
  marks
    .map((m, k) => ({ m, k }))
    .sort((a, b) => a.m.day.localeCompare(b.m.day) || MARK_ORDER.indexOf(a.m.kind) - MARK_ORDER.indexOf(b.m.kind) || a.k - b.k)
    .forEach(({ m }) => week(m.day).marks.push(m));

  const hasStages = q.stages.length > 0;
  [...q.tasks]
    .filter((t) => t.done && t.doneDate)
    .sort((a, b) => a.doneDate!.localeCompare(b.doneDate!) || a.line - b.line)
    .forEach((t) => week(t.doneDate!).done.push({ day: t.doneDate!, text: t.text, stage: hasStages ? t.stage : null }));

  const workDays = new Set<string>();
  [...i.sessions]
    .sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)
    .forEach((s) => {
      const w = week(s.day);
      const min = dur(s);
      w.minutes += min;
      w.sessionCount++;
      if (min > 0) workDays.add(s.day);
      if (s.note.trim()) w.notes.push({ day: s.day, text: s.note.trim() });
    });

  [...i.closing]
    .filter((c) => c.text.trim() && workDays.has(c.day))
    .sort((a, b) => a.day.localeCompare(b.day))
    .forEach((c) => week(c.day).closing.push({ day: c.day, text: c.text.trim() }));

  [...i.reviews]
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay) || a.id.localeCompare(b.id))
    .forEach((r) => {
      for (const [question, text] of Object.entries(r.answers)) {
        if (mentionsQuest(text, q.name)) week(r.lastDay).reflections.push({ question, text: text.trim() });
      }
    });

  return [...weeks.values()]
    .filter((w) => (!range?.from || w.weekStart >= range.from) && (!range?.to || w.weekStart <= range.to))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
