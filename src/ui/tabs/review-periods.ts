// Review for month, quarter and year (#23): the weekly frame over a longer range, plus each period's extras and
// questions. Saved as Reviews/2026-11.md, 2026-Q4.md or 2026.md with `period` and the numeric summary.
import { fmtHours, parseDay } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import type { Quest, Session, Task } from "../../data/model";
import { OTHER_COLOR } from "../../data/store";
import { daysOf, monthsIn, parsePeriodId, periodId, periodRange, scaleTarget, shiftPeriod, weeksInRange, type Period, type Range } from "../../data/periods";
import { monthTargets, previousMonthHours } from "../../data/review-month";
import { weeklyTargetHours, type QuestlogSettings } from "../../settings";
import { fmtDate, t, type Key } from "../../i18n";
import type { Ctx } from "../ctx";
import { bar, button, empty, iconButton, pageHead, questIcon, sectionHead, segmented, statCard } from "../components";
import { doneList, questions, splitCard, summaryOf } from "./review-shared";
import { MONTH } from "./review-month";
import { QUARTER } from "./review-quarter";
import { YEAR } from "./review-year";

export type LongPeriod = Exclude<Period, "week">;

/** What a period knows about itself, handed to its extras and summary. */
export interface PeriodInfo {
  id: string;
  period: LongPeriod;
  range: Range;
  days: string[];
  /** Sessions inside the range. */
  sessions: Session[];
  /** Minutes per quest name inside the range. */
  byQuest: Map<string, number>;
}

export interface PeriodConfig {
  questions(settings: QuestlogSettings): string[];
  /** Cards between the frame and the questions. */
  extras?(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void;
  /** Keys added to the numeric summary of the note. */
  summary?(ctx: Ctx, info: PeriodInfo): Record<string, number | string>;
  /** Hours by quest also shows the previous period (month only). */
  compare?: boolean;
  /** Done tasks are listed (else only counted). */
  doneList?: boolean;
}

export const PERIOD_CONFIG: Partial<Record<LongPeriod, PeriodConfig>> = { month: MONTH, quarter: QUARTER, year: YEAR };

const LABEL: Record<Period, Key> = { week: "review.week", month: "review.month", quarter: "review.quarter", year: "review.year" };

/** Week plus every registered period, as a tablist in the page head; hidden while only the week exists. */
export function periodSwitch(parent: HTMLElement, ctx: Ctx): void {
  const periods: Period[] = ["week", ...(["month", "quarter", "year"] as const).filter((p) => PERIOD_CONFIG[p])];
  if (periods.length < 2) return;
  const s = segmented(
    parent,
    periods.map((id) => ({ id, label: t(LABEL[id]) })),
    ctx.state.reviewPeriod,
    (v) => {
      ctx.state.reviewPeriod = v;
      ctx.rerender();
    },
  );
  s.addClass("ql-period-switch");
  s.setAttr("aria-label", t("review.period"));
}

/** "November 2026", "Q4 2026", "2026". */
export function periodLabel(id: string): string {
  const p = parsePeriodId(id);
  if (!p) return id;
  if (p.period === "month") return fmtDate(parseDay(`${id}-01`), { month: "long", year: "numeric" });
  if (p.period === "quarter") return `Q${p.n} ${p.year}`;
  return String(p.year);
}

function rangeText(r: Range): string {
  const f = (d: string) => fmtDate(parseDay(d), { day: "numeric", month: "short" });
  return `${f(r.start)} – ${f(r.end)}`;
}

export function renderPeriod(el: HTMLElement, ctx: Ctx, period: LongPeriod): void {
  const config = PERIOD_CONFIG[period];
  const { store, plugin, state, today } = ctx;
  if (!config) {
    state.reviewPeriod = "week";
    return ctx.rerender();
  }
  const id = periodId(period, state.reviewDay);
  const range = periodRange(id)!;
  const days = daysOf(range);
  const sessions = store.sessions(days);
  const total = totalMinutes(sessions);
  const questMin = totalMinutes(sessions.filter((s) => store.isQuestWork(s.quest)));
  const otherMin = total - questMin;
  const done: Task[] = store.allTasks().filter((x) => x.done && x.doneDate !== null && x.doneDate >= range.start && x.doneDate <= range.end);
  const target = scaleTarget(weeklyTargetHours(plugin.settings, store.quests), days.length);
  const withTime = new Set(sessions.map((s) => s.day));
  const activeDays = days.filter((d) => d <= today && withTime.has(d)).length;
  const byQuest = new Map<string, number>();
  for (const s of sessions) byQuest.set(s.quest, (byQuest.get(s.quest) ?? 0) + (s.end - s.start));
  const info: PeriodInfo = { id, period, range, days, sessions, byQuest };

  // Head: switch and navigation
  const actions = pageHead(el, t(`review.title.${period}` as Key), period === "year" ? periodLabel(id) : `${periodLabel(id)} · ${rangeText(range)}`);
  periodSwitch(actions, ctx);
  const nav = actions.createDiv({ cls: "ql-navgroup" });
  const go = (n: number) => {
    const next = periodRange(shiftPeriod(id, n));
    if (!next) return;
    state.reviewDay = today >= next.start && today <= next.end ? today : next.start;
    ctx.rerender();
  };
  const cap = period[0]!.toUpperCase() + period.slice(1);
  iconButton(nav, "chevron-left", t(`nav.prev${cap}` as Key), () => go(-1));
  button(nav, t(`review.this${cap}` as Key), () => {
    state.reviewDay = today;
    ctx.rerender();
  }, { cls: today >= range.start && today <= range.end ? "is-current" : "" });
  iconButton(nav, "chevron-right", t(`nav.next${cap}` as Key), () => go(1));

  // Stat cards
  const stats = el.createDiv({ cls: "ql-stats" });
  statCard(stats, t("review.questHours"), fmtHours(questMin), {
    icon: "target",
    sub: target ? `/ ${target}h` : undefined,
    progress: target ? [questMin, target * 60] : undefined,
  });
  statCard(stats, t("review.dailyAvg"), fmtHours(activeDays ? Math.round(total / activeDays) : 0), {
    icon: "calendar-days",
    sub: t("review.activeDays", { n: activeDays }),
  });
  statCard(stats, t("review.questShare"), total ? `${Math.round((questMin / total) * 100)}%` : "–", {
    icon: "pie-chart",
    sub: total ? t("review.otherShare", { h: fmtHours(otherMin) }) : undefined,
  });
  statCard(stats, t("review.tasksDone"), String(done.length), { icon: "check-circle-2" });

  const grid = el.createDiv({ cls: "ql-review" });
  splitCard(grid, total, questMin, otherMin);
  hoursByQuest(grid, ctx, info, config);
  trendCard(grid, ctx, info);

  if (config.doneList) doneList(el, ctx, days, done, t("review.doneEmptyPeriod"));

  config.extras?.(el, ctx, info);

  const existing = store.reviews.get(id);
  questions(el, ctx, `${period}:${id}`, config.questions(plugin.settings), existing?.answers ?? {}, async (answers) => {
    const summary = { ...summaryOf(store, sessions, { total, questMin, otherMin }, done.length), ...(config.summary?.(ctx, info) ?? {}) };
    return store.savePeriodReview(id, period, answers, summary);
  }, existing?.path);
}

/**
 * Hours per quest in the range against the planned hours (each week's target, clipped by days and by the quest's
 * `created` day), and on a month also last month's hours. Neutral bars, no colour for being over or under.
 */
function hoursByQuest(parent: HTMLElement, ctx: Ctx, info: PeriodInfo, config: PeriodConfig): void {
  const { store } = ctx;
  const card = parent.createDiv({ cls: "ql-card ql-section" });
  sectionHead(card, t("review.input"), "gauge");
  const quests: Quest[] = store.quests.filter((q) => q.status === "active" || info.byQuest.has(q.name));
  const orphan = [...info.byQuest.keys()].filter((name) => store.isQuestWork(name) && !store.quest(name));
  const otherMin = [...info.byQuest].filter(([n]) => !store.isQuestWork(n)).reduce((a, [, m]) => a + m, 0);
  if (!quests.length && !orphan.length && !otherMin) {
    empty(card, t("review.noTime"), "timer");
    return;
  }
  const targets = monthTargets(quests, weeksInRange(info.range), (q, w) => store.weekTarget(q, w));
  const prev = config.compare ? previousMonthHours(store.allSessions(), info.id) : null;
  const maxMin = Math.max(60, ...info.byQuest.values(), ...[...targets.values()].map((h) => h * 60));
  const list = card.createEl("ul", { cls: "ql-prows", attr: { "aria-label": t("review.input") } });

  const row = (name: string, color: string, min: number, targetH: number, opts: { quest?: Quest; status?: string } = {}) => {
    const li = list.createEl("li", { cls: "ql-prow" });
    const n = li.createDiv({ cls: "ql-prow-name" });
    if (opts.quest) questIcon(n, opts.quest, "is-small");
    n.createSpan({ cls: "ql-prow-label", text: name });
    if (opts.status) n.createSpan({ cls: "ql-prow-status", text: opts.status });
    const b = bar(li, min, targetH ? targetH * 60 : maxMin, color);
    b.setAttr("role", "img");
    b.setAttr("aria-label", targetH ? t("review.hoursOf", { name, h: fmtHours(min), target: `${targetH}h` }) : `${name}: ${fmtHours(min)}`);
    const nums = li.createDiv({ cls: "ql-prow-nums" });
    nums.createSpan({ cls: "ql-mono", text: targetH ? `${fmtHours(min)} / ${targetH}h` : fmtHours(min) });
    if (prev) {
      const p = prev.get(name) ?? 0;
      nums.createSpan({ cls: "ql-small ql-muted", text: t("review.lastMonth", { h: fmtHours(p) }) });
    }
  };
  for (const q of quests) {
    const status = q.status === "paused" ? t("review.status.paused") : q.status === "done" ? t("review.status.done") : undefined;
    row(q.name, q.color, info.byQuest.get(q.name) ?? 0, targets.get(q.name) ?? 0, { quest: q, status });
  }
  for (const name of orphan) row(name, OTHER_COLOR, info.byQuest.get(name) ?? 0, 0);
  if (otherMin) row(t("other.name"), OTHER_COLOR, otherMin, 0);
}

/** Quest hours per ISO week (clipped to the range) for month and quarter, per month for a year. */
function trendCard(parent: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store, today, plugin } = ctx;
  const card = parent.createDiv({ cls: "ql-card ql-section" });
  const quest = info.sessions.filter((s) => store.isQuestWork(s.quest));
  const sum = (from: string, to: string) => totalMinutes(quest.filter((s) => s.day >= from && s.day <= to));
  let cols: { label: string; aria: string; value: number; current: boolean }[];
  let target = 0;
  if (info.period === "year") {
    sectionHead(card, t("review.trendMonths"), "trending-up");
    cols = monthsIn(info.id).map((m) => {
      const r = periodRange(m)!;
      const d = parseDay(r.start);
      const long = fmtDate(d, { month: "long" });
      const short = fmtDate(d, { month: "short" });
      return {
        label: ctx.width === "narrow" ? short.slice(0, 1).toUpperCase() : short,
        aria: long,
        value: sum(r.start, r.end),
        current: today >= r.start && today <= r.end,
      };
    });
  } else {
    sectionHead(card, t("review.trendWeeks"), "trending-up");
    target = weeklyTargetHours(plugin.settings, store.quests);
    cols = weeksInRange(info.range).map((w) => ({
      label: w.week.replace(/^\d{4}-W/, "W"),
      aria: `${t("common.week")} ${Number(w.week.slice(-2))}`,
      value: sum(w.start, w.end),
      current: today >= w.start && today <= w.end,
    }));
  }
  const tmax = Math.max(60, target * 60, ...cols.map((c) => c.value)) * 1.1;
  const trend = card.createDiv({ cls: "ql-trend" + (cols.length > 8 ? " is-dense" : "") });
  trend.style.setProperty("--ql-cols", String(cols.length));
  const plot = trend.createDiv({ cls: "ql-trend-plot" });
  const labels = trend.createDiv({ cls: "ql-trend-labels" });
  for (const c of cols) {
    const col = plot.createDiv({ cls: "ql-trend-col" + (c.current ? " is-current" : "") });
    const b = col.createDiv({ cls: "ql-trend-bar" });
    b.style.height = `${(c.value / tmax) * 100}%`;
    b.setAttr("aria-label", `${c.aria}: ${fmtHours(c.value)}`);
    const l = labels.createDiv({ cls: "ql-trend-label" + (c.current ? " is-current" : "") });
    l.createDiv({ cls: "ql-day-val ql-mono", text: c.value ? fmtHours(c.value) : "–" });
    l.createDiv({ cls: "ql-day-label", text: c.label });
  }
  if (target) {
    const line = plot.createDiv({ cls: "ql-trend-target", attr: { "aria-label": `${t("review.target")}: ${target}h` } });
    line.style.bottom = `${((target * 60) / tmax) * 100}%`;
    line.createSpan({ cls: "ql-trend-target-label ql-mono", text: `${target}h` });
  }
}
