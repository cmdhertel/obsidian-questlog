// The ritual line on Home (#18): gathers the inputs of `pickRitual`, renders the one quiet line or the
// open ritual card. Nothing here opens by itself; it runs on every Home render.
import { addDays, fmtDuration, isoDay, minutesOfDay, parseDay, weekDays, weekIdToDay } from "../data/dates";
import { pickCheckinQuest, quietWeeks } from "../data/checkin";
import { minutesByWeekStart } from "../data/dots";
import type { Quest } from "../data/model";
import { pickRitual, weekToPlan, type RitualId, type RitualInput } from "../data/rituals";
import { totalMinutes } from "../data/stats";
import type QuestlogPlugin from "../main";
import { fmtDate, t } from "../i18n";
import type { Ctx } from "./ctx";
import { act, button } from "./components";
import { dayGaps } from "./timeline";
import { dismiss } from "./rituals/frame";
import { renderStartDay } from "./rituals/start-day";
import { renderCloseDay } from "./rituals/close-day";
import { renderPlanWeek } from "./rituals/plan-week";
import { renderCheckin } from "./rituals/checkin";

/** The quest a check-in would ask about, with its quiet weeks; null when none qualifies. */
export function checkinQuestFor(plugin: QuestlogPlugin, today: string): { quest: Quest; weeks: number } | null {
  const { store } = plugin;
  const byQuest = new Map<string, { day: string; start: number; end: number }[]>();
  for (const s of store.allSessions()) {
    const l = byQuest.get(s.quest);
    if (l) l.push(s);
    else byQuest.set(s.quest, [s]);
  }
  const cands = store
    .activeQuests()
    .filter((q) => q.kind === "quest")
    .map((q) => {
      const sessions = byQuest.get(q.name) ?? [];
      let first: string | null = null;
      for (const s of sessions) if (!first || s.day < first) first = s.day;
      const weeks = quietWeeks({ today, created: q.created, firstSession: first, minutes: minutesByWeekStart(sessions) });
      return { quest: q, name: q.name, status: q.status, order: q.order, quietWeeks: weeks, checkedIn: q.checkedIn };
    });
  const pick = pickCheckinQuest(cands, today, plugin.settings.checkinWeeks);
  return pick ? { quest: pick.quest, weeks: pick.quietWeeks } : null;
}

function hasInteriorGaps(plugin: QuestlogPlugin, day: string): boolean {
  return dayGaps(plugin, day).some((g) => g.edge === "none");
}

/** Everything `pickRitual` needs, read from the store at `now`. */
export function buildRitualInput(plugin: QuestlogPlugin, now = new Date()): RitualInput {
  const { store } = plugin;
  const today = isoDay(now);
  const yesterday = addDays(today, -1);
  const td = store.days.get(today);
  const yd = store.days.get(yesterday);
  const yesterdayHasSessions = store.sessions([yesterday]).length > 0;
  return {
    today,
    nowMin: minutesOfDay(now),
    todayHasSessions: store.sessions([today]).length > 0,
    todayStarted: td?.dayStarted != null,
    todayClosed: td?.dayClosed != null,
    yesterdayHasSessions,
    yesterdayClosed: yd?.dayClosed != null,
    // Only computed when it can matter; finding gaps reads the day's sessions.
    yesterdayHasGaps: yesterdayHasSessions && yd?.dayClosed == null && hasInteriorGaps(plugin, yesterday),
    reviewAnswered: !store.reviewMissing(today),
    hasPlanHours: (w) => store.planHours(w) !== null,
    checkinQuest: checkinQuestFor(plugin, today)?.quest.name ?? null,
    dismissed: plugin.settings.rituals,
  };
}

/** The day `ritual-close-day` closes: yesterday when the line would offer that now, else today. */
export function closeDayTarget(plugin: QuestlogPlugin, now = new Date()): string {
  const input = buildRitualInput(plugin, now);
  const open = pickRitual({ ...input, dismissed: { start: null, close: null, week: null, checkin: null } });
  return open === "close-yesterday" ? addDays(input.today, -1) : input.today;
}

function lineText(ctx: Ctx, id: RitualId, input: RitualInput): string {
  const { store } = ctx;
  switch (id) {
    case "close-day": {
      const min = totalMinutes(store.sessions([input.today]));
      return min ? t("ritual.line.closeDay", { time: fmtDuration(min) }) : t("ritual.line.closeDayNone");
    }
    case "close-yesterday":
      return t("ritual.line.closeYesterday");
    case "start-day":
      return t("ritual.line.startDay");
    case "plan-week": {
      const week = weekToPlan(input.today, input.reviewAnswered);
      const monday = weekIdToDay(week) ?? input.today;
      const days = weekDays(monday);
      const span = `${fmtDate(parseDay(days[0]!), { day: "numeric", month: "short" })} – ${fmtDate(parseDay(days[6]!), { day: "numeric", month: "short" })}`;
      return t("ritual.line.planWeek", { week: span });
    }
    case "check-in": {
      const c = checkinQuestFor(ctx.plugin, input.today);
      return t("ritual.line.checkIn", { quest: c?.quest.name ?? input.checkinQuest ?? "", n: c?.weeks ?? ctx.plugin.settings.checkinWeeks });
    }
  }
}

const BUTTON: Record<RitualId, Parameters<typeof t>[0]> = {
  "close-day": "ritual.btn.closeDay",
  "close-yesterday": "ritual.btn.closeYesterday",
  "start-day": "ritual.btn.startDay",
  "plan-week": "ritual.btn.planWeek",
  "check-in": "ritual.btn.checkIn",
};

/** Open the card for a ritual id as the line (or a command) would. */
export function ritualTarget(plugin: QuestlogPlugin, id: RitualId, today: string): { id: RitualId; day: string; quest?: string } | null {
  switch (id) {
    case "close-yesterday":
      return { id, day: addDays(today, -1) };
    case "check-in": {
      const c = checkinQuestFor(plugin, today);
      return c ? { id, day: today, quest: c.quest.name } : null;
    }
    default:
      return { id, day: today };
  }
}

/** The slot on Home: the open ritual card, else the one line, else a quiet note, else nothing. */
export function renderRitualSlot(el: HTMLElement, ctx: Ctx): void {
  const slot = el.createDiv({ cls: "ql-ritual-slot" });
  const open = ctx.state.ritual;
  if (open) {
    if (open.id === "start-day") renderStartDay(slot, ctx);
    else if (open.id === "close-day" || open.id === "close-yesterday") renderCloseDay(slot, ctx, open.day);
    else if (open.id === "plan-week") renderPlanWeek(slot, ctx);
    else renderCheckin(slot, ctx, open.quest ?? "");
    return;
  }
  if (ctx.state.ritualNote) {
    slot.createDiv({ cls: "ql-ritual-note", text: ctx.state.ritualNote, attr: { role: "status" } });
    return;
  }
  const input = buildRitualInput(ctx.plugin);
  const id = pickRitual(input);
  if (!id) return;
  const line = slot.createDiv({ cls: "ql-ritual-line", attr: { role: "region", "aria-label": t("ritual.region") } });
  line.createDiv({ cls: "ql-ritual-text", text: lineText(ctx, id, input) });
  const acts = line.createDiv({ cls: "ql-ritual-actions" });
  button(
    acts,
    t(BUTTON[id]),
    () => {
      const target = ritualTarget(ctx.plugin, id, input.today);
      if (target) ctx.view.openRitual(target);
    },
    { cta: true },
  );
  button(acts, t("ritual.notNow"), act(() => dismiss(ctx.plugin, id)), { cls: "ql-btn-plain" });
}
