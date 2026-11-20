// Review: the weekly ritual. Where did the time go (quest work vs. other, per quest vs. target, per day, 8-week trend),
// what got done, and the weekly questions — saved into a review note with a numeric summary in the frontmatter.
import { setIcon } from "obsidian";
import { addDays, fmtDuration, fmtHours, isoWeek, parseDay, weekDays } from "../../data/dates";
import { minutesByQuest, totalMinutes } from "../../data/stats";
import type { Quest, Session } from "../../data/model";
import { OTHER_COLOR } from "../../data/store";
import { weeklyQuestions, weeklyTargetHours } from "../../settings";
import { t, weekdayShort } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, bar, button, dot, empty, iconButton, pageHead, questName, sectionHead, statCard } from "../components";

export function renderReview(el: HTMLElement, ctx: Ctx): void {
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

  const range = `${parseDay(days[0]!).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${parseDay(days[6]!).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  const actions = pageHead(el, t("review.title"), `${t("common.week")} ${week.replace(/^\d{4}-W0?/, "")} · ${range}`);
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
  const split = grid.createDiv({ cls: "ql-card ql-section" });
  sectionHead(split, t("review.split"), "split", fmtHours(total));
  if (!total) empty(split, t("review.noTime"), "timer");
  else {
    const sb = split.createDiv({ cls: "ql-split" });
    const qPart = sb.createDiv({ cls: "ql-split-part is-quest" });
    qPart.style.flexGrow = String(questMin);
    const oPart = sb.createDiv({ cls: "ql-split-part is-other" });
    oPart.style.flexGrow = String(otherMin);
    const legend = split.createDiv({ cls: "ql-legend" });
    legendItem(legend, "var(--interactive-accent)", t("review.questWork"), fmtHours(questMin));
    legendItem(legend, OTHER_COLOR, t("other.name"), fmtHours(otherMin));
  }

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
    r.createSpan({ cls: "ql-small " + (pct === null ? "ql-muted" : pct >= 100 ? "ql-good" : pct < 50 ? "ql-warn" : "ql-muted"), text: pct === null ? "" : `${pct}%` });
  };
  for (const q of quests) row(q.name, q.color, byQuest.get(q.name) ?? 0, q.weeklyHours * 60);
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
  const dc = el.createDiv({ cls: "ql-card ql-section" });
  sectionHead(dc, t("review.doneList"), "check-circle-2", String(done.length));
  if (!done.length) empty(dc, t("review.doneEmpty"), "sunrise");
  const dl = dc.createDiv({ cls: "ql-donelog" });
  for (const day of [...days].reverse()) {
    const items = done.filter((x) => x.doneDate === day);
    if (!items.length) continue;
    dl.createDiv({ cls: "ql-donelog-day", text: parseDay(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) });
    for (const task of items) {
      const r = dl.createDiv({ cls: "ql-donelog-item" });
      const q = store.questOf(task);
      setIcon(r.createSpan({ cls: "ql-donelog-check" }), "check");
      r.createSpan({ cls: "ql-donelog-text", text: task.text });
      if (q) {
        const qs = r.createSpan({ cls: "ql-task-quest" });
        dot(qs, q.color);
        qs.createSpan({ text: questName(q) });
      }
    }
  }

  // Weekly questions
  const existing = store.reviews.get(week);
  questions(el, ctx, `week:${week}`, weeklyQuestions(plugin.settings), existing?.answers ?? {}, async (answers) => {
    const summary: Record<string, number | string> = {
      hours_total: round1(total / 60),
      hours_quests: round1(questMin / 60),
      hours_other: round1(otherMin / 60),
      tasks_done: done.length,
    };
    for (const [name, min] of byQuest) {
      if (!store.isQuestWork(name)) continue;
      summary[`hours_${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}`] = round1(min / 60);
    }
    return store.saveReview(week, answers, summary);
  }, existing?.path);
}

const round1 = (h: number) => Math.round(h * 10) / 10;

/** Minutes per quest of a day, in quest order with Other last (stable stacking). */
function sortedByQuest(ctx: Ctx, list: Session[]): [string, number][] {
  const order = (name: string) => {
    const q = ctx.store.quest(name);
    return q?.kind === "quest" ? ctx.store.quests.indexOf(q) : 1e6;
  };
  return [...minutesByQuest(list)].sort((a, b) => order(a[0]) - order(b[0]));
}

function legendItem(parent: HTMLElement, color: string, label: string, value: string): void {
  const i = parent.createDiv({ cls: "ql-legend-item" });
  dot(i, color);
  i.createSpan({ text: label });
  i.createSpan({ cls: "ql-mono ql-muted", text: value });
}

function questions(
  el: HTMLElement,
  ctx: Ctx,
  key: string,
  qs: string[],
  saved: Record<string, string>,
  save: (answers: [string, string][]) => Promise<unknown>,
  notePath?: string,
): void {
  const { state, plugin } = ctx;
  const card = el.createDiv({ cls: "ql-card ql-section" });
  const head = sectionHead(card, t("review.reflect"), "notebook-pen");
  if (notePath) iconButton(head, "file-text", t("task.openNote"), () => void plugin.app.workspace.openLinkText(notePath, "", false));
  const form = card.createDiv({ cls: "ql-questions" });
  const fields: [string, HTMLTextAreaElement][] = [];
  for (const q of qs) {
    const draftKey = `${key}|${q}`;
    const f = form.createDiv({ cls: "ql-question" });
    f.createEl("label", { text: q });
    const ta = f.createEl("textarea", { cls: "ql-answer", attr: { rows: "3" } });
    ta.value = state.drafts.get(draftKey) ?? saved[q] ?? "";
    ta.oninput = () => state.drafts.set(draftKey, ta.value);
    fields.push([q, ta]);
  }
  const actions = form.createDiv({ cls: "ql-question-actions" });
  if (fields.some(([q]) => state.drafts.has(`${key}|${q}`))) actions.createSpan({ cls: "ql-muted ql-small", text: t("review.unsaved") });
  button(actions, t("common.save"), act(async () => {
    await save(fields.map(([q, ta]) => [q, ta.value]));
    for (const [q] of fields) state.drafts.delete(`${key}|${q}`);
    ctx.rerender();
  }), { icon: "save", cta: true });
}
