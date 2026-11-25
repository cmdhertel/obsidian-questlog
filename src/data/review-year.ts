// Yearly review: hours per quarter, the biggest shifts between quarters, and this year's weekly answers.
// Pure, no Obsidian imports.
import { monthOfWeek, parsePeriodId } from "./periods";
import { dur } from "./stats";

export type Quarters = [number, number, number, number];

/** Minutes per quest and calendar quarter of `year`, by the session's own date. */
export function quarterHours(sessions: { day: string; start: number; end: number; quest: string }[], year: number): Map<string, Quarters> {
  const out = new Map<string, Quarters>();
  const y = String(year);
  for (const s of sessions) {
    if (s.day.slice(0, 4) !== y) continue;
    const qi = Math.floor((Number(s.day.slice(5, 7)) - 1) / 3);
    let row = out.get(s.quest);
    if (!row) {
      row = [0, 0, 0, 0];
      out.set(s.quest, row);
    }
    row[qi] = row[qi]! + dur(s);
  }
  return out;
}

export interface Shift {
  quest: string;
  /** Quarter index (0-3) before the change; the change is to `from + 1`. */
  from: number;
  before: number;
  after: number;
  delta: number;
}

/**
 * The largest absolute changes between consecutive quarters, one per quest, at most `limit`. Ties go by `order`
 * (quest order), then name. Empty when fewer than two quarters have time overall.
 */
export function biggestShifts(hours: Map<string, Quarters>, limit = 3, order: string[] = []): Shift[] {
  const withTime = [0, 1, 2, 3].filter((i) => [...hours.values()].some((r) => r[i]! > 0)).length;
  if (withTime < 2) return [];
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i < 0 ? 1e6 : i;
  };
  const best: Shift[] = [];
  for (const [quest, r] of hours) {
    let top: Shift | null = null;
    for (let i = 0; i < 3; i++) {
      const before = r[i]!;
      const after = r[i + 1]!;
      const delta = after - before;
      if (delta !== 0 && (!top || Math.abs(delta) > Math.abs(top.delta))) top = { quest, from: i, before, after, delta };
    }
    if (top) best.push(top);
  }
  best.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || rank(a.quest) - rank(b.quest) || a.quest.localeCompare(b.quest));
  return best.slice(0, Math.max(0, limit));
}

interface WeeklyReview {
  id: string;
  period: string;
  answers: Record<string, string>;
}

/**
 * Non-empty answers to `question` in the weekly reviews of `year`, grouped by month, newest month first, weeks in
 * order inside a month. A week belongs to the month of its Thursday and to the ISO year of its id, so `2026-W01`
 * (from 2025-12-29) counts as January 2026.
 */
export function weeklyAnswersByMonth(reviews: Iterable<WeeklyReview>, year: number, question: string): { month: string; answers: { week: string; text: string }[] }[] {
  const by = new Map<string, { week: string; text: string }[]>();
  for (const r of reviews) {
    if (r.period !== "week") continue;
    const p = parsePeriodId(r.id);
    if (!p || p.period !== "week" || p.year !== year) continue;
    const text = (r.answers[question] ?? "").trim();
    if (!text) continue;
    // The Thursday of an ISO week always lies in the ISO year of its id.
    const month = monthOfWeek(r.id);
    if (!month) continue;
    const list = by.get(month) ?? [];
    list.push({ week: r.id, text });
    by.set(month, list);
  }
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, answers]) => ({ month, answers: answers.sort((a, b) => a.week.localeCompare(b.week)) }));
}

/** Each question answered (non-empty) in this year's weekly reviews, once, with its count; most answered first, then by text. */
export function questionsSeen(reviews: Iterable<WeeklyReview>, year: number): { question: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    if (r.period !== "week") continue;
    const p = parsePeriodId(r.id);
    if (!p || p.period !== "week" || p.year !== year) continue;
    for (const [q, a] of Object.entries(r.answers)) if (a.trim()) counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return [...counts.entries()].map(([question, count]) => ({ question, count })).sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));
}
