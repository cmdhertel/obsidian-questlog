// Plan the week (#21): hours per quest, the next stage, tasks onto days. Only Finish writes `plan_hours`;
// day chips move tasks at once.
import { addDays, fmtHours, isoWeek, parseDay, weekDays, weekIdToDay } from "../../data/dates";
import type { Quest, Task } from "../../data/model";
import { planPrefill, questFocusTasks, weekToPlan } from "../../data/rituals";
import { currentStage } from "../../data/stages";
import { totalMinutes } from "../../data/stats";
import { weeklyTargetHours } from "../../settings";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, button, questIcon, questName, segmented, taskKey } from "../components";
import { stageLabel } from "../stagepath";
import { actionRow, closeRitual, dismissCard, goStep, groupName, ritualCard, stepHead, stepIndex } from "./frame";

const WEEK = "ritual:plan:week";
const hoursKey = (week: string, q: Quest) => `ritual:plan:h:${week}:${q.name}`;
const shownKey = (week: string) => `ritual:plan:shown:${week}`;

type Step = "hours" | "stages" | "days";

function short(day: string): string {
  return fmtDate(parseDay(day), { day: "numeric", month: "short" });
}

/** Hours typed for a quest (draft), else the prefill. Empty or invalid counts as 0. */
function hoursOf(ctx: Ctx, week: string, q: Quest): number {
  const d = ctx.state.drafts.get(hoursKey(week, q));
  if (d === undefined) return planPrefill(q, week, (w) => ctx.store.planHours(w));
  const n = Number(d.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function renderPlanWeek(slot: HTMLElement, ctx: Ctx): void {
  const { store, state, today, plugin } = ctx;
  const thisWeek = isoWeek(today);
  const nextWeek = isoWeek(addDays(today, 7));
  const week = state.drafts.get(WEEK) ?? weekToPlan(today, !store.reviewMissing(today));
  const monday = weekIdToDay(week) ?? today;
  const days = weekDays(monday);
  const quests = store.activeQuests().filter((q) => q.kind === "quest");

  const card = ritualCard(slot, t("ritual.plan.title"), `${short(days[0]!)} – ${short(days[6]!)}`);
  segmented(
    card,
    [
      { id: thisWeek, label: t("ritual.plan.thisWeek") },
      { id: nextWeek, label: t("ritual.plan.nextWeek") },
    ],
    week === thisWeek ? thisWeek : nextWeek,
    (w) => {
      state.drafts.set(WEEK, w);
      ctx.rerender();
    },
  );

  const steps: Step[] = ["hours"];
  if (quests.some((q) => q.stages.length)) steps.push("stages");
  steps.push("days");
  const i = stepIndex(ctx, steps.length);
  const step = steps[i]!;

  if (step === "hours") renderHours(card, ctx, week, quests, i, steps.length);
  else if (step === "stages") renderStages(card, ctx, quests, i, steps.length);
  else renderDays(card, ctx, week, days, quests, i, steps.length);

  const acts = actionRow(card);
  if (i > 0) button(acts, t("ritual.back"), () => goStep(ctx, i - 1));
  if (i < steps.length - 1) {
    button(acts, t("ritual.skip"), () => goStep(ctx, i + 1), { cls: "ql-btn-plain" });
    button(acts, t("ritual.next"), () => goStep(ctx, i + 1));
  }
  button(
    acts,
    t("ritual.plan.finish"),
    act(async () => {
      const map: Record<string, number> = {};
      for (const q of quests) map[q.name] = hoursOf(ctx, week, q);
      await store.savePlanHours(week, map);
      closeRitual(ctx, t("ritual.plan.saved"));
      plugin.refreshViews();
    }),
    { cta: true },
  );
  button(acts, t("ritual.notNow"), act(() => dismissCard(ctx, "plan-week")), { cls: "ql-btn-plain" });
}

function renderHours(card: HTMLElement, ctx: Ctx, week: string, quests: Quest[], i: number, n: number): void {
  const { store, state, plugin } = ctx;
  stepHead(card, i, n, t("ritual.plan.hours"));
  if (!quests.length) {
    card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.plan.noQuests") });
    return;
  }
  const monday = weekIdToDay(week)!;
  const prevDays = weekDays(addDays(monday, -7));
  const list = card.createDiv({ cls: "ql-ritual-list" });
  const sumEl = card.createDiv({ cls: "ql-ritual-sum", attr: { "aria-live": "polite" } });
  const target = weeklyTargetHours(plugin.settings, store.quests);
  const updateSum = () => {
    const sum = Math.round(quests.reduce((a, q) => a + hoursOf(ctx, week, q), 0) * 10) / 10;
    sumEl.setText(target ? t("ritual.plan.sum", { sum, target }) : t("ritual.plan.sumNoTarget", { sum }));
  };
  for (const q of quests) {
    const r = list.createDiv({ cls: "ql-ritual-hours" });
    r.style.setProperty("--ql-color", q.color);
    const id = groupName("plan-hours");
    const l = r.createEl("label", { cls: "ql-ritual-pick-text", attr: { for: id } });
    questIcon(l, q, "is-small");
    l.createSpan({ cls: "ql-ritual-task", text: questName(q) });
    const field = r.createDiv({ cls: "ql-ritual-hours-field" });
    const input = field.createEl("input", {
      type: "number",
      attr: { id, min: "0", step: "0.5", inputmode: "decimal", "aria-label": t("ritual.plan.hoursLabel", { quest: q.name }) },
    });
    input.value = state.drafts.get(hoursKey(week, q)) ?? String(hoursOf(ctx, week, q));
    field.createSpan({ text: "h", attr: { "aria-hidden": "true" } });
    input.oninput = () => {
      state.drafts.set(hoursKey(week, q), input.value);
      updateSum();
    };
    const last = totalMinutes(store.sessions(prevDays).filter((s) => s.quest === q.name));
    r.createSpan({ cls: "ql-ritual-meta ql-mono", text: `${fmtHours(last)} ${t("ritual.plan.lastWeek")}` });
  }
  updateSum();
}

function renderStages(card: HTMLElement, ctx: Ctx, quests: Quest[], i: number, n: number): void {
  const { store } = ctx;
  stepHead(card, i, n, t("ritual.plan.stages"));
  const list = card.createDiv({ cls: "ql-ritual-list" });
  for (const q of quests) {
    const r = list.createDiv({ cls: "ql-ritual-stage" });
    r.style.setProperty("--ql-color", q.color);
    const text = r.createDiv({ cls: "ql-ritual-pick-text" });
    const head = text.createDiv({ cls: "ql-ritual-task" });
    questIcon(head, q, "is-small");
    head.createSpan({ text: ` ${questName(q)}` });
    const meta = text.createDiv({ cls: "ql-ritual-meta" });
    if (!q.stages.length) {
      meta.setText(t("ritual.plan.noStages"));
      continue;
    }
    const cur = currentStage(q.stages);
    if (!cur) {
      meta.setText(t("stage.allReached"));
      continue;
    }
    const open = q.tasks.filter((x) => !x.done && x.stageIndex === cur.index).length;
    const bits = [stageLabel(cur), t("ritual.plan.openTasks", { n: open })];
    if (cur.target) bits.push(`📅 ${short(cur.target)}`);
    if (cur.index === q.stages.length - 1) bits.push(t("ritual.plan.lastStage"));
    meta.setText(bits.join(" · "));
    if (!open) button(r.createDiv({ cls: "ql-ritual-row-actions" }), t("ritual.plan.reached"), act(() => store.reachStage(q, cur, "next")), { icon: "flag" });
  }
}

function renderDays(card: HTMLElement, ctx: Ctx, week: string, days: string[], quests: Quest[], i: number, n: number): void {
  const { store, state, today, view } = ctx;
  stepHead(card, i, n, t("ritual.plan.days"));
  const inWeek = (x: Task) => {
    const d = store.scheduledDay(x, today);
    return d !== null && days.includes(d) ? d : null;
  };
  // Tasks stay in the list after a chip moved them, for this run of the card.
  const shown = new Set((state.drafts.get(shownKey(week)) ?? "").split("\n").filter(Boolean));
  const tasks: Task[] = [];
  for (const q of quests) for (const x of questFocusTasks(q)) if (shown.has(taskKey(x)) || !inWeek(x)) tasks.push(x);
  for (const x of tasks) shown.add(taskKey(x));
  state.drafts.set(shownKey(week), [...shown].join("\n"));

  if (!tasks.length) card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.plan.daysEmpty") });
  else card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.plan.daysIntro") });
  const list = card.createDiv({ cls: "ql-ritual-list" });
  for (const x of tasks) {
    const q = store.questOf(x);
    const r = list.createDiv({ cls: "ql-ritual-left" });
    if (q) r.style.setProperty("--ql-color", q.color);
    const text = r.createDiv({ cls: "ql-ritual-pick-text" });
    text.createSpan({ cls: "ql-ritual-task", text: x.text });
    if (q) {
      const meta = text.createSpan({ cls: "ql-ritual-meta" });
      meta.createSpan({ cls: "ql-dot", attr: { "aria-hidden": "true" } });
      meta.createSpan({ text: questName(q) });
    }
    const cur = inWeek(x);
    const name = groupName("plan-day");
    const group = r.createDiv({ cls: "ql-radio-chips is-days", attr: { role: "radiogroup", "aria-label": t("ritual.plan.dayGroup", { task: x.text }) } });
    const chip = (value: string | null, label: string, full: string) => {
      const c = group.createEl("label", { cls: "ql-radio-chip" });
      const input = c.createEl("input", { type: "radio", attr: { name, "aria-label": full } });
      input.checked = value === cur;
      input.disabled = value !== null && value < today;
      c.toggleClass("is-disabled", input.disabled);
      c.createSpan({ text: label, attr: { "aria-hidden": "true" } });
      input.onchange = act(async () => {
        if (!input.checked) return;
        // "Later" only undoes a day picked in this card; a task never planned stays untouched.
        if (value === null && cur === null) return;
        await store.moveToDay(x, value, "bottom");
        ctx.rerender();
      });
    };
    for (const d of days) chip(d, t(`wd.short.${parseDay(d).getDay()}` as "wd.short.0"), fmtDate(parseDay(d), { weekday: "long", day: "numeric", month: "long" }));
    chip(null, t("ritual.plan.later"), t("ritual.plan.later"));
  }
  const link = card.createDiv({ cls: "ql-ritual-link" });
  button(
    link,
    t("ritual.plan.board"),
    () => {
      state.planDay = days[0]!;
      view.showTab("plan");
    },
    { icon: "list-checks", cls: "ql-btn-plain" },
  );
}
