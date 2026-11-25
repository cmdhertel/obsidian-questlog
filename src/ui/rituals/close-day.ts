// Close the day (#20): gaps, what got done, one sentence, leftovers. Steps without content are left out;
// every step can be skipped. Works on today or yesterday.
import { addDays, fmtClock, fmtDuration, minutesOfDay, parseDay } from "../../data/dates";
import type { Gap } from "../../data/gaps";
import type { Task } from "../../data/model";
import { closeTime } from "../../data/rituals";
import { totalMinutes } from "../../data/stats";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, button, questIcon, questName, taskKey } from "../components";
import { SessionModal } from "../modals";
import { dayGaps, gapSuggestionsFor } from "../timeline";
import { actionRow, closeRitual, dismissCard, goStep, groupName, ritualCard, stepHead, stepIndex } from "./frame";

type Choice = "tomorrow" | "another" | "backlog" | "leave";
const CHOICES: Choice[] = ["tomorrow", "another", "backlog", "leave"];
const SENTENCE = "ritual:close:sentence";
const choiceKey = (task: Task) => `ritual:close:choice:${taskKey(task)}`;
const dateKey = (task: Task) => `ritual:close:date:${taskKey(task)}`;

type Step = "gaps" | "done" | "sentence" | "leftovers";

export function renderCloseDay(slot: HTMLElement, ctx: Ctx, day: string): void {
  const { store, today, state, plugin } = ctx;
  const isToday = day >= today;
  const card = ritualCard(
    slot,
    t(isToday ? "ritual.close.title" : "ritual.close.titleYesterday"),
    fmtDate(parseDay(day), { weekday: "long", day: "numeric", month: "long" }),
  );
  const gaps = dayGaps(plugin, day);
  const done = store.doneOn(day);
  const left = store.leftoversOf(day, today);
  const steps: Step[] = [];
  if (gaps.length) steps.push("gaps");
  if (done.length) steps.push("done");
  steps.push("sentence");
  if (left.length) steps.push("leftovers");
  const i = stepIndex(ctx, steps.length);
  const step = steps[i]!;
  const last = i === steps.length - 1;

  if (!state.drafts.has(SENTENCE)) state.drafts.set(SENTENCE, store.days.get(day)?.closingLine ?? "");

  if (step === "gaps") {
    stepHead(card, i, steps.length, t("ritual.close.gaps"));
    card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.close.gapsIntro") });
    const list = card.createDiv({ cls: "ql-ritual-list" });
    for (const g of gaps) gapRow(list, ctx, day, g);
  } else if (step === "done") {
    stepHead(card, i, steps.length, t("ritual.close.done"));
    card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.close.logged", { time: fmtDuration(totalMinutes(store.sessions([day]))) }) });
    const list = card.createDiv({ cls: "ql-ritual-list" });
    const byQuest = new Map<string, Task[]>();
    for (const x of done) {
      const l = byQuest.get(x.questPath);
      if (l) l.push(x);
      else byQuest.set(x.questPath, [x]);
    }
    for (const [path, tasks] of byQuest) {
      const q = store.quests.find((x) => x.path === path);
      const g = list.createDiv({ cls: "ql-ritual-done" });
      if (q) {
        g.style.setProperty("--ql-color", q.color);
        const h = g.createDiv({ cls: "ql-group-head" });
        questIcon(h, q, "is-small");
        h.createSpan({ text: questName(q) });
      }
      const ul = g.createEl("ul", { cls: "ql-ritual-done-list" });
      for (const x of tasks) ul.createEl("li", { text: x.text });
    }
  } else if (step === "sentence") {
    stepHead(card, i, steps.length, t("ritual.close.sentence"));
    const id = groupName("close-sentence");
    card.createEl("label", { cls: "ql-ritual-label", text: t("ritual.close.sentenceLabel"), attr: { for: id } });
    const area = card.createEl("textarea", { cls: "ql-ritual-textarea", attr: { id, rows: "2", maxlength: "1000" } });
    area.value = state.drafts.get(SENTENCE) ?? "";
    const count = card.createDiv({ cls: "ql-ritual-count", attr: { "aria-live": "polite" } });
    const update = () => {
      count.setText(t("ritual.close.count", { n: area.value.length }));
      count.toggleClass("is-over", area.value.length > 280);
    };
    update();
    area.oninput = () => {
      state.drafts.set(SENTENCE, area.value);
      update();
    };
    // Enter does not submit: it is a text field, and newlines become spaces when stored.
  } else {
    stepHead(card, i, steps.length, t("ritual.close.leftovers"));
    card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.close.leftoversIntro") });
    const list = card.createDiv({ cls: "ql-ritual-list" });
    for (const x of left) leftoverRow(list, ctx, day, x, isToday);
  }

  const acts = actionRow(card);
  if (i > 0) button(acts, t("ritual.back"), () => goStep(ctx, i - 1));
  if (!last) {
    button(acts, t("ritual.skip"), () => goStep(ctx, i + 1), { cls: "ql-btn-plain" });
    button(acts, t("ritual.next"), () => goStep(ctx, i + 1), { cta: true });
  } else {
    button(acts, t("ritual.close.finish"), act(() => finish(ctx, day, left)), { cta: true });
  }
  button(acts, t("ritual.notNow"), act(() => dismissCard(ctx, isToday ? "close-day" : "close-yesterday")), { cls: "ql-btn-plain" });
}

function gapRow(parent: HTMLElement, ctx: Ctx, day: string, g: Gap): void {
  const { plugin, store } = ctx;
  const r = parent.createDiv({ cls: "ql-ritual-gap" + (g.edge === "none" ? "" : " is-edge") });
  const text = r.createDiv({ cls: "ql-ritual-pick-text" });
  text.createSpan({ cls: "ql-mono", text: `${fmtClock(g.start)}–${fmtClock(g.end)}` });
  text.createSpan({ cls: "ql-ritual-meta", text: `${fmtDuration(g.end - g.start)} · ${t("gap.unlogged")}` });
  const acts = r.createDiv({ cls: "ql-ritual-row-actions" });
  button(acts, t("gap.add"), () => new SessionModal(plugin, { day, start: g.start, end: g.end, suggestions: gapSuggestionsFor(ctx, day), breakSpan: g }).open(), {
    icon: "plus",
  });
  button(
    acts,
    t("gap.notWork"),
    act(async () => {
      await store.addBreak(day, { start: g.start, end: g.end });
      ctx.rerender();
    }),
    { cls: "ql-btn-plain" },
  );
}

function leftoverRow(parent: HTMLElement, ctx: Ctx, day: string, x: Task, isToday: boolean): void {
  const { state, store } = ctx;
  const q = store.questOf(x);
  const r = parent.createDiv({ cls: "ql-ritual-left" });
  if (q) r.style.setProperty("--ql-color", q.color);
  const text = r.createDiv({ cls: "ql-ritual-pick-text" });
  text.createSpan({ cls: "ql-ritual-task", text: x.text });
  if (q) {
    const meta = text.createSpan({ cls: "ql-ritual-meta" });
    meta.createSpan({ cls: "ql-dot", attr: { "aria-hidden": "true" } });
    meta.createSpan({ text: questName(q) });
  }
  const value = (state.drafts.get(choiceKey(x)) as Choice | undefined) ?? "leave";
  const name = groupName("close-left");
  const group = r.createDiv({ cls: "ql-radio-chips", attr: { role: "radiogroup", "aria-label": x.text } });
  const label: Record<Choice, string> = {
    tomorrow: t(isToday ? "ritual.close.tomorrow" : "ritual.close.today"),
    another: t("ritual.close.another"),
    backlog: t("ritual.close.backlog"),
    leave: t("ritual.close.leave"),
  };
  let dateWrap: HTMLElement | null = null;
  for (const c of CHOICES) {
    const chip = group.createEl("label", { cls: "ql-radio-chip" });
    const input = chip.createEl("input", { type: "radio", attr: { name, value: c } });
    input.checked = c === value;
    chip.createSpan({ text: label[c] });
    input.onchange = () => {
      if (!input.checked) return;
      state.drafts.set(choiceKey(x), c);
      dateWrap?.toggleClass("is-hidden", c !== "another");
    };
  }
  dateWrap = r.createDiv({ cls: "ql-ritual-date" + (value === "another" ? "" : " is-hidden") });
  const date = dateWrap.createEl("input", { type: "date", attr: { min: addDays(day, 1), "aria-label": t("ritual.close.anotherDate", { task: x.text }) } });
  date.value = state.drafts.get(dateKey(x)) ?? addDays(day, 2);
  const msg = dateWrap.createDiv({ cls: "ql-ritual-hint", attr: { "aria-live": "polite" } });
  const check = () => {
    const ok = !!date.value && date.value > day;
    msg.setText(ok ? "" : t("ritual.close.anotherTooEarly", { date: fmtDate(parseDay(day), { day: "numeric", month: "long" }) }));
    return ok;
  };
  date.onchange = () => {
    state.drafts.set(dateKey(x), date.value);
    check();
  };
  if (value === "another") check();
}

async function finish(ctx: Ctx, day: string, left: Task[]): Promise<void> {
  const { store, state, today } = ctx;
  for (const x of left) {
    const c = (state.drafts.get(choiceKey(x)) as Choice | undefined) ?? "leave";
    if (c === "tomorrow") await store.moveToDay(x, addDays(day, 1), "bottom");
    else if (c === "backlog") await store.moveToDay(x, null);
    else if (c === "another") {
      const d = state.drafts.get(dateKey(x)) ?? addDays(day, 2);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > day) await store.moveToDay(x, d, "bottom");
    }
  }
  const sentence = state.drafts.get(SENTENCE);
  if (sentence !== undefined) await store.setClosingLine(day, sentence);
  const closed = closeTime(day, today, minutesOfDay(new Date()), store.sessions([day]));
  if (closed !== null) await store.updateDay(day, { dayClosed: closed });
  closeRitual(ctx, t("ritual.close.closed"));
}
