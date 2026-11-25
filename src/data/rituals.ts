// The ritual frame: which one quiet line Home offers, dismissals, and the pure parts of the four flows.
// No Obsidian imports. Nothing here opens anything; Home asks on every render.
import { addDays, isoWeek, parseClock, weekIdToDay } from "./dates";
import * as plan from "./plan";
import type { Quest, Session, Task } from "./model";
import { currentStage } from "./stages";

export type RitualId = "close-day" | "close-yesterday" | "start-day" | "plan-week" | "check-in";

/** Stored in data.json under `rituals`: the day (or ISO week for `week`) a line was last dismissed. */
export interface Dismissed {
  start: string | null;
  close: string | null;
  week: string | null;
  checkin: string | null;
}

/** "Close the day" is offered from 16:00. */
export const CLOSE_FROM = 16 * 60;
/** Morning rituals are offered until 13:59. */
export const MORNING_UNTIL = 14 * 60;

export interface RitualInput {
  today: string;
  /** Minutes since midnight. */
  nowMin: number;
  todayHasSessions: boolean;
  todayStarted: boolean;
  todayClosed: boolean;
  yesterdayHasSessions: boolean;
  yesterdayClosed: boolean;
  yesterdayHasGaps: boolean;
  /** This week's review has answers. */
  reviewAnswered: boolean;
  /** True when that ISO week's note has `plan_hours`. */
  hasPlanHours: (week: string) => boolean;
  /** Name of the quest a check-in would ask about, or null. */
  checkinQuest: string | null;
  dismissed: Dismissed;
}

/** The week the planning ritual plans: the coming one once this week's review is answered, else this one. */
export function weekToPlan(today: string, reviewAnswered: boolean): string {
  return isoWeek(reviewAnswered ? addDays(today, 7) : today);
}

/** True when the plan-week line is due (before dismissal). */
function planDue(i: RitualInput): boolean {
  const isMonday = new Date(`${i.today}T12:00:00`).getDay() === 1;
  if (i.reviewAnswered) return !i.hasPlanHours(weekToPlan(i.today, true));
  if (!isMonday) return false;
  return !i.hasPlanHours(isoWeek(i.today)) && !i.hasPlanHours(isoWeek(addDays(i.today, 7)));
}

/** At most one ritual, by the decision table of #18; a dismissed row is skipped. */
export function pickRitual(i: RitualInput): RitualId | null {
  const yesterday = addDays(i.today, -1);
  const d = i.dismissed;
  const morning = i.nowMin < MORNING_UNTIL;
  if (i.nowMin >= CLOSE_FROM && i.todayHasSessions && !i.todayClosed && d.close !== i.today) return "close-day";
  if (morning && i.yesterdayHasSessions && !i.yesterdayClosed && i.yesterdayHasGaps && d.close !== yesterday) return "close-yesterday";
  if (morning && !i.todayStarted && d.start !== i.today) return "start-day";
  if (planDue(i) && d.week !== isoWeek(i.today)) return "plan-week";
  if (i.checkinQuest && d.checkin !== i.today) return "check-in";
  return null;
}

/** Dismissals after "Not now" on a line. Close-yesterday stores yesterday, so the evening line still shows. */
export function dismissRitual(d: Dismissed, id: RitualId, today: string): Dismissed {
  switch (id) {
    case "close-day":
      return { ...d, close: today };
    case "close-yesterday":
      return { ...d, close: addDays(today, -1) };
    case "start-day":
      return { ...d, start: today };
    case "plan-week":
      return { ...d, week: isoWeek(today) };
    case "check-in":
      return { ...d, checkin: today };
  }
}

/** A clock field of a day note ("8:12" or "08:12"); other types and texts are ignored. */
export function fmClock(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,2}:\d{2}$/.test(v.trim())) return null;
  return parseClock(v.trim());
}

// ---------------------------------------------------------------- start the day

/** Open tasks a quest would suggest: the current stage's, or the loose ones when no stage is current. */
export function questFocusTasks(q: Pick<Quest, "tasks" | "stages">): Task[] {
  const cur = currentStage(q.stages);
  const open = q.tasks.filter((x) => !x.done);
  return cur ? open.filter((x) => x.stageIndex === cur.index) : open.filter((x) => x.stageIndex === null);
}

/**
 * Rows of the start card: today's tasks (carried ones first, then the own plan's order) and one
 * suggestion per active quest that has nothing planned today.
 */
export function startCandidates(todayTasks: Task[], quests: Pick<Quest, "path" | "kind" | "status" | "tasks" | "stages">[], ownPlan: string[]): { planned: Task[]; suggested: Task[] } {
  const open = todayTasks.filter((x) => !x.done);
  const own = new Map(ownPlan.map((id, i) => [id, i]));
  const carried = open.filter((x) => !x.id || !own.has(x.id));
  const mine = open.filter((x) => x.id && own.has(x.id)).sort((a, b) => own.get(a.id)! - own.get(b.id)!);
  const planned = [...carried, ...mine];
  const busy = new Set(planned.map((x) => x.questPath));
  const suggested: Task[] = [];
  for (const q of quests) {
    if (q.kind !== "quest" || q.status !== "active" || busy.has(q.path)) continue;
    const first = questFocusTasks(q)[0];
    if (first) suggested.push(first);
  }
  return { planned, suggested };
}

// ---------------------------------------------------------------- close the day

/**
 * Ids of the open tasks to ask about when closing `day`: today's list (carried included) for today,
 * else the tasks whose latest planned day is `day`, in plan order.
 */
export function leftovers(days: plan.PlanDay[], isOpen: (id: string) => boolean, day: string, today: string): string[] {
  if (day >= today) return plan.dayIds(days, day, today, isOpen);
  return [...plan.latestPlanned(days)]
    .filter(([id, p]) => p.day === day && isOpen(id))
    .sort((a, b) => a[1].index - b[1].index)
    .map(([id]) => id);
}

/** Minutes to store as `day_closed`: now for today, the end of the last session for an earlier day. */
export function closeTime(day: string, today: string, nowMin: number, sessions: Pick<Session, "day" | "end">[]): number | null {
  if (day >= today) return nowMin;
  const ends = sessions.filter((s) => s.day === day).map((s) => s.end);
  return ends.length ? Math.max(...ends) : null;
}

// ---------------------------------------------------------------- plan the week

/** Hours to prefill for a quest: the week's `plan_hours`, else the previous week's, else `weekly_hours`. */
export function planPrefill(
  quest: Pick<Quest, "name" | "weeklyHours">,
  week: string,
  planHours: (week: string) => Record<string, number> | null,
): number {
  const own = planHours(week)?.[quest.name];
  if (typeof own === "number" && Number.isFinite(own)) return own;
  const monday = weekIdToDay(week);
  const prev = monday ? planHours(isoWeek(addDays(monday, -7)))?.[quest.name] : undefined;
  if (typeof prev === "number" && Number.isFinite(prev)) return prev;
  return quest.weeklyHours;
}
