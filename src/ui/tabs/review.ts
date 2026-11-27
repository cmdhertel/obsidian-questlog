// Review: the weekly ritual. Where did the time go (quest work vs. other, per quest vs. target, per day, 8-week trend),
// what got done, and the weekly questions — saved into a review note with a numeric summary in the frontmatter.
// Month, quarter and year (#23) share the frame and live in review-periods.ts.
import { addDays, fmtDuration, fmtHours, isoWeek, parseDay, weekDays } from "../../data/dates";
import { minutesByQuest, totalMinutes } from "../../data/stats";
import type { Quest, Session } from "../../data/model";
import { OTHER_COLOR } from "../../data/store";
import { isOn, weeklyQuestions, weeklyTargetHours } from "../../settings";
import { fmtDate, t, weekdayShort } from "../../i18n";
import type { Ctx } from "../ctx";
import { bar, button, dot, empty, iconButton, pageHead, questName, sectionHead, statCard } from "../components";
import { doneList, questions, splitCard, summaryOf } from "./review-shared";
import { periodSwitch, renderPeriod } from "./review-periods";

export function renderReview(el: HTMLElement, ctx: Ctx): void {
  const p = ctx.state.reviewPeriod;
  if (p === "week") renderWeek(el, ctx);
  else renderPeriod(el, ctx, p);
}

export function renderWeek(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const days = weekDays(state.reviewDay);
  const week = isoWeek(days[0]!);
  const sessions = store.sessions(days);
  const total = totalMinutes(sessions);
  const questMin = totalMinutes(sessions.filter((s) => store.isQuestWork(s.quest)));
  const otherMin = total - questMin;
  const done = days.flatMap((d) => store.doneOn(d));
  const target = weeklyTargetHours(plugin.settings, store.quests);
  const activeDays = days.filter((d) => d <= today && sessions.some((s) => s.day === d)).length;

  const range = `${fmtDate(parseDay(days[0]!), { day: "numeric", month: "short" })} – ${fmtDate(parseDay(days[6]!), { day: "numeric", month: "short" })}`;
  const actions = pageHead(el, t("review.title"), `${t("common.week")} ${week.replace(/^\d{4}-W0?/, "")} · ${range}`);
  periodSwitch(actions, ctx);
  const nav = actions.createDiv({ cls: "ql-navgroup" });
  iconButton(nav, "chevron-left", t("nav.prevWeek"), () => {
    state.reviewDay = addDays(state.reviewDay, -7);
    ctx.rerender();
  });
  button(nav, t("review.thisWeek"), () => {
    state.reviewDay = today;
    ctx.rerender();
  }, { cls: days.includes(today) ? "is-current" : "" });
  iconButton(nav, "chevron-right", t("nav.nextWeek"), () => {
    state.reviewDay = addDays(state.reviewDay, 7);
    ctx.rerender();
  });

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

  // Quest work vs. other
  splitCard(grid, total, questMin, otherMin);

  // Hours by quest vs. targets
  const byQuest = minutesByQuest(sessions);
  const ic = grid.createDiv({ cls: "ql-card ql-section" });
  sectionHead(ic, t("review.input"), "gauge");
  const quests: Quest[] = store.quests.filter((q) => q.status === "active" || byQuest.has(q.name));
  const orphan = [...byQuest.keys()].filter((name) => !store.quest(name));
  if (!quests.length && !orphan.length && !otherMin) empty(ic, t("review.noTime"), "timer");
  const rows = ic.createDiv({ cls: "ql-input-grid" });
  const maxMin = Math.max(60, ...byQuest.values());
  const row = (name: string, color: string, min: number, targetMin: number) => {
    const r = rows.createDiv({ cls: "ql-input-row" });
    const n = r.createDiv({ cls: "ql-input-name" });
    dot(n, color);
    n.createSpan({ text: name });
    bar(r, min, targetMin || maxMin, color);
    r.createSpan({ cls: "ql-mono ql-small", text: targetMin ? `${fmtHours(min)} / ${targetMin / 60}h` : fmtHours(min) });
    const pct = targetMin ? Math.round((min / targetMin) * 100) : null;
    r.createSpan({ cls: "ql-small " + (pct === null ? "ql-muted" : pct >= 100 ? "ql-good" : "ql-muted"), text: pct === null ? "" : `${pct}%` });
  };
  const hours = isOn(ctx.plugin.settings, "hours");
  for (const q of quests) row(q.name, q.color, byQuest.get(q.name) ?? 0, hours ? q.weeklyHours * 60 : 0);
  for (const name of orphan) row(name, OTHER_COLOR, byQuest.get(name) ?? 0, 0);
  if (otherMin) row(t("other.name"), OTHER_COLOR, otherMin, 0);

  // Per day, stacked by quest
  const pd = grid.createDiv({ cls: "ql-card ql-section" });
  sectionHead(pd, t("review.perDay"), "bar-chart-3");
  const perDay = days.map((d) => sessions.filter((s) => s.day === d));
  const max = Math.max(60, ...perDay.map(totalMinutes));
  const chart = pd.createDiv({ cls: "ql-days" });
  days.forEach((day, i) => {
    const list = perDay[i] ?? [];
    const sum = totalMinutes(list);
    const col = chart.createDiv({ cls: "ql-day-col" + (day === today ? " is-today" : "") });
    const stack = col.createDiv({ cls: "ql-day-stack", attr: { "aria-label": `${weekdayShort(parseDay(day))}: ${fmtDuration(sum)}` } });
    for (const [name, min] of sortedByQuest(ctx, list)) {
      const seg = stack.createDiv({ cls: "ql-day-seg" });
      seg.style.setProperty("--ql-color", store.quest(name)?.color ?? OTHER_COLOR);
      seg.style.height = `${(min / max) * 100}%`;
      seg.setAttr("aria-label", `${questName(store.quest(name), name)}: ${fmtDuration(min)}`);
    }
    col.createDiv({ cls: "ql-day-val ql-mono", text: sum ? fmtHours(sum) : "–" });
    col.createDiv({ cls: "ql-day-label", text: weekdayShort(parseDay(day)) });
  });

  // 8-week trend of quest hours, with the target as a line
  const tr = grid.createDiv({ cls: "ql-card ql-section" });
  sectionHead(tr, t("review.trend"), "trending-up");
  const weeks = Array.from({ length: 8 }, (_, i) => weekDays(addDays(days[0]!, -7 * (7 - i))));
  const values = weeks.map((w) => totalMinutes(store.sessions(w).filter((s) => store.isQuestWork(s.quest))));
  const tmax = Math.max(60, target * 60, ...values) * 1.1;
  const trend = tr.createDiv({ cls: "ql-trend" });
  const plot = trend.createDiv({ cls: "ql-trend-plot" });
  const labels = trend.createDiv({ cls: "ql-trend-labels" });
  weeks.forEach((w, i) => {
    const v = values[i] ?? 0;
    const current = w.includes(days[0]!);
    const col = plot.createDiv({ cls: "ql-trend-col" + (current ? " is-current" : "") });
    const b = col.createDiv({ cls: "ql-trend-bar" + (target && v >= target * 60 ? " is-met" : "") });
    b.style.height = `${(v / tmax) * 100}%`;
    b.setAttr("aria-label", `${t("common.week")} ${isoWeek(w[0]!).replace(/^\d{4}-W0?/, "")}: ${fmtHours(v)}`);
    const l = labels.createDiv({ cls: "ql-trend-label" + (current ? " is-current" : "") });
    l.createDiv({ cls: "ql-day-val ql-mono", text: v ? fmtHours(v) : "–" });
    l.createDiv({ cls: "ql-day-label", text: isoWeek(w[0]!).replace(/^\d{4}-W/, "W") });
  });
  if (target) {
    const line = plot.createDiv({ cls: "ql-trend-target", attr: { "aria-label": `${t("review.target")}: ${target}h` } });
    line.style.bottom = `${((target * 60) / tmax) * 100}%`;
    line.createSpan({ cls: "ql-trend-target-label ql-mono", text: `${target}h` });
  }

  // Done list
  doneList(el, ctx, days, done, t("review.doneEmpty"));

  // Weekly questions
  const existing = store.reviews.get(week);
  questions(el, ctx, `week:${week}`, weeklyQuestions(plugin.settings), existing?.answers ?? {}, async (answers) => {
    return store.saveReview(week, answers, summaryOf(store, sessions, { total, questMin, otherMin }, done.length));
  }, existing?.path);
}

/** Minutes per quest of a day, in quest order with Other last (stable stacking). */
function sortedByQuest(ctx: Ctx, list: Session[]): [string, number][] {
  const order = (name: string) => {
    const q = ctx.store.quest(name);
    return q?.kind === "quest" ? ctx.store.quests.indexOf(q) : 1e6;
  };
  return [...minutesByQuest(list)].sort((a, b) => order(a[0]) - order(b[0]));
}
