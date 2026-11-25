// Quarterly review: the quest rows and the decisions taken on them. Pure, no Obsidian imports.
import type { QuestStatus } from "./model";
import type { Range } from "./periods";
import { dur } from "./stats";

export interface QuarterRow {
  name: string;
  status: QuestStatus;
  weeklyHours: number;
  /** Minutes in the quarter. */
  minutes: number;
  /** Minutes per month id ("2026-10" …), in month order. */
  byMonth: [string, number][];
}

/** Active quests, plus paused quests with time in the range; done quests are left out. Quest order is kept. */
export function quarterRows(
  quests: { name: string; status: QuestStatus; weeklyHours: number }[],
  sessions: { day: string; start: number; end: number; quest: string }[],
  r: Range,
  months: string[],
): QuarterRow[] {
  const rows: QuarterRow[] = [];
  for (const q of quests) {
    if (q.status === "done") continue;
    const per = new Map<string, number>(months.map((m) => [m, 0]));
    let minutes = 0;
    for (const s of sessions) {
      if (s.quest !== q.name || s.day < r.start || s.day > r.end) continue;
      const m = s.day.slice(0, 7);
      per.set(m, (per.get(m) ?? 0) + dur(s));
      minutes += dur(s);
    }
    if (q.status === "paused" && minutes === 0) continue;
    rows.push({ name: q.name, status: q.status, weeklyHours: q.weeklyHours, minutes, byMonth: [...per] });
  }
  return rows;
}

export type Decision = "keep" | "pause" | "resume" | "finish";

export interface DecisionInput {
  decision: Decision;
  /** Weekly hours as typed; empty, invalid or negative input leaves the hours unchanged. */
  hours: string;
}

export interface DecisionPatch {
  name: string;
  patch: { status?: QuestStatus; weeklyHours?: number };
}

/** Parse a weekly hours field: a finite number >= 0 ("," as decimal mark is fine), else null. */
export function parseHours(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** The patches to apply: only rows whose decision or hours differ from the quest as it is. */
export function diffDecisions(rows: Pick<QuarterRow, "name" | "status" | "weeklyHours">[], inputs: Map<string, DecisionInput>): DecisionPatch[] {
  const out: DecisionPatch[] = [];
  for (const row of rows) {
    const input = inputs.get(row.name);
    if (!input) continue;
    const patch: DecisionPatch["patch"] = {};
    const to: QuestStatus | null =
      input.decision === "pause" ? "paused" : input.decision === "resume" ? "active" : input.decision === "finish" ? "done" : null;
    if (to && to !== row.status) patch.status = to;
    const h = parseHours(input.hours);
    if (h !== null && h !== row.weeklyHours) patch.weeklyHours = h;
    if (Object.keys(patch).length) out.push({ name: row.name, patch });
  }
  return out;
}
