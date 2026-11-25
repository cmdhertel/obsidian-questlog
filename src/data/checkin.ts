// Quest check-in: which quiet quest to ask about, and the `## Check-ins` lines. Pure.
import { addDays, weekStart } from "./dates";
import type { QuestStatus } from "./model";
import { bare, bodyStart, splitLines } from "./lines";

export const CHECKIN_HEADINGS = ["Check-ins", "Standortbestimmung"];
export const CHECKIN_ACTIONS = ["keep", "pause", "shrink", "finish"] as const;
export type CheckinAction = (typeof CHECKIN_ACTIONS)[number];

export interface CheckinCandidate {
  name: string;
  status: QuestStatus;
  order: number;
  quietWeeks: number;
  checkedIn: string | null;
}

/**
 * Full past weeks in a row without time, counted back from last week. A quest with time in the current
 * week is not quiet; weeks before the quest started (created, else first session) never count.
 */
export function quietWeeks(i: { today: string; created: string | null; firstSession: string | null; minutes: Map<string, number> }): number {
  const now = weekStart(i.today);
  if ((i.minutes.get(now) ?? 0) > 0) return 0;
  const start = i.created ?? i.firstSession;
  if (!start) return 0;
  const first = weekStart(start);
  let n = 0;
  for (let w = addDays(now, -7); w >= first && (i.minutes.get(w) ?? 0) <= 0; w = addDays(w, -7)) n++;
  return n;
}

/** The quest to ask about, or null: most quiet weeks first, ties to the lower order. */
export function pickCheckinQuest<T extends CheckinCandidate>(cands: T[], today: string, weeks: number): T | null {
  const since = addDays(weekStart(today), -7 * weeks);
  const ok = cands.filter((c) => c.status === "active" && c.quietWeeks >= weeks && !(c.checkedIn && c.checkedIn >= since));
  ok.sort((a, b) => b.quietWeeks - a.quietWeeks || a.order - b.order);
  return ok[0] ?? null;
}

/** `- YYYY-MM-DD action: text`, or without `: text` when empty. Newlines become spaces. */
export function checkinLine(date: string, action: CheckinAction, text: string): string {
  const one = text.replace(/\s*\r?\n\s*/g, " ").trim();
  return `- ${date} ${action}${one ? `: ${one}` : ""}`;
}

export interface Checkin {
  date: string;
  action: CheckinAction;
  text: string;
}

/** Lines of the check-in section (either language), in note order. Malformed lines and unknown actions are skipped. */
export function parseCheckins(content: string): Checkin[] {
  const ls = splitLines(content);
  const want = new Set(CHECKIN_HEADINGS.map((h) => `## ${h}`));
  const out: Checkin[] = [];
  let inside = false;
  for (let i = bodyStart(ls); i < ls.length; i++) {
    const l = bare(ls[i]!);
    if (/^#{1,2} /.test(l)) {
      inside = want.has(l.trim());
      continue;
    }
    if (!inside) continue;
    const m = /^- (\d{4}-\d{2}-\d{2}) (\w+)(?:: (.*))?$/.exec(l.trim());
    if (!m || !(CHECKIN_ACTIONS as readonly string[]).includes(m[2]!)) continue;
    out.push({ date: m[1]!, action: m[2] as CheckinAction, text: (m[3] ?? "").trim() });
  }
  return out;
}
