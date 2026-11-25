// Start the day (#19): today's tasks and one suggestion per quest; pick the one thing, tick a few more.
import { minutesOfDay, parseDay } from "../../data/dates";
import type { Task } from "../../data/model";
import { startCandidates } from "../../data/rituals";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, button, questName, taskKey } from "../components";
import { QuestModal } from "../modals";
import { actionRow, closeRitual, dismissCard, groupName, ritualCard } from "./frame";

const ONE = "ritual:start:one";
const ALSO = "ritual:start:also";

function alsoSet(ctx: Ctx): Set<string> {
  return new Set((ctx.state.drafts.get(ALSO) ?? "").split("\n").filter(Boolean));
}

export function renderStartDay(slot: HTMLElement, ctx: Ctx): void {
  const { store, today, state, plugin } = ctx;
  const card = ritualCard(slot, t("ritual.start.title"), fmtDate(parseDay(today), { weekday: "long", day: "numeric", month: "long" }));
  const own = new Set(store.days.get(today)?.plan ?? []);
  const { planned, suggested } = startCandidates(store.dayTasks(today, today), store.quests, [...own]);
  const all = [...planned, ...suggested];
  const keys = new Set(all.map(taskKey));

  // Drop drafts of tasks that are gone (done or deleted in another view).
  let oneKey = state.drafts.get(ONE) ?? "";
  if (oneKey && !keys.has(oneKey)) {
    oneKey = "";
    state.drafts.delete(ONE);
  }
  const also = alsoSet(ctx);

  if (!all.length) {
    card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.start.nothing") });
    const acts = actionRow(card);
    if (!store.activeQuests().length) button(acts, t("ritual.start.addQuest"), () => new QuestModal(plugin).open(), { icon: "plus" });
    button(acts, t("ritual.start.done"), act(() => finish(ctx, null, [], false)), { cta: true });
    button(acts, t("ritual.notNow"), act(() => dismissCard(ctx, "start-day")), { cls: "ql-btn-plain" });
    return;
  }

  card.createDiv({ cls: "ql-ritual-intro", text: t("ritual.start.intro") });
  const group = groupName("start");
  let startBtn: HTMLButtonElement | null = null;
  const findOne = () => all.find((x) => taskKey(x) === (state.drafts.get(ONE) ?? ""));
  const updateStart = () => {
    const one = findOne();
    if (!startBtn) return;
    startBtn.toggleClass("is-hidden", !one);
    startBtn.disabled = !one;
    if (one) {
      const label = t("ritual.start.go", { task: one.text });
      startBtn.querySelector(".ql-btn-text")?.setText(label);
      startBtn.setAttr("aria-label", label);
    }
  };

  const list = card.createDiv({ cls: "ql-ritual-list", attr: { role: "radiogroup", "aria-label": t("ritual.start.intro") } });
  const row = (x: Task, carried: boolean) => {
    const key = taskKey(x);
    const q = store.questOf(x);
    const r = list.createDiv({ cls: "ql-ritual-row" });
    if (q) r.style.setProperty("--ql-color", q.color);
    const main = r.createEl("label", { cls: "ql-ritual-pick" });
    const radio = main.createEl("input", { type: "radio", attr: { name: group, "aria-label": t("ritual.start.one", { task: x.text }) } });
    radio.checked = key === oneKey;
    radio.onchange = () => {
      if (!radio.checked) return;
      state.drafts.set(ONE, key);
      updateStart();
    };
    const text = main.createDiv({ cls: "ql-ritual-pick-text" });
    text.createSpan({ cls: "ql-ritual-task", text: x.text });
    const meta = text.createSpan({ cls: "ql-ritual-meta" });
    if (q) {
      meta.createSpan({ cls: "ql-dot", attr: { "aria-hidden": "true" } });
      meta.createSpan({ text: questName(q) });
    }
    if (carried) meta.createSpan({ cls: "ql-ritual-hint", text: t("plan.carried") });
    const side = r.createEl("label", { cls: "ql-ritual-also" });
    const box = side.createEl("input", { type: "checkbox", attr: { "aria-label": t("ritual.start.alsoLabel", { task: x.text }) } });
    box.checked = also.has(key);
    box.onchange = () => {
      const s = alsoSet(ctx);
      if (box.checked) s.add(key);
      else s.delete(key);
      state.drafts.set(ALSO, [...s].join("\n"));
    };
    side.createSpan({ text: t("ritual.start.also"), attr: { "aria-hidden": "true" } });
  };
  for (const x of planned) row(x, !x.id || !own.has(x.id));
  if (suggested.length) {
    list.createDiv({ cls: "ql-ritual-sub-head", text: t("ritual.start.fromQuests") });
    for (const x of suggested) row(x, false);
  }

  const acts = actionRow(card);
  startBtn = button(
    acts,
    "",
    act(async () => {
      const one = findOne();
      if (one) await finish(ctx, one, [...alsoSet(ctx)].map((k) => all.find((x) => taskKey(x) === k)).filter((x): x is Task => !!x), true);
    }),
    { cta: true, icon: "play", cls: "ql-ritual-go" },
  );
  // The label follows the radio in place, without a re-render.
  startBtn.createSpan({ cls: "ql-btn-text" });
  updateStart();
  button(
    acts,
    t("ritual.start.done"),
    act(() => finish(ctx, findOne() ?? null, [...alsoSet(ctx)].map((k) => all.find((x) => taskKey(x) === k)).filter((x): x is Task => !!x), false)),
  );
  button(acts, t("ritual.notNow"), act(() => dismissCard(ctx, "start-day")), { cls: "ql-btn-plain" });
}

/**
 * Write the start: ticked tasks join today's plan at the bottom, `day_started` (kept if set) and the one
 * thing at the top. Then, for "Start", the timer and Focus.
 */
async function finish(ctx: Ctx, one: Task | null, also: Task[], start: boolean): Promise<void> {
  const { store, today, plugin } = ctx;
  const own = new Set(store.days.get(today)?.plan ?? []);
  for (const x of also) {
    if (x === one || (x.id && own.has(x.id))) continue;
    await store.moveToDay(x, today, "bottom");
  }
  let oneId: string | undefined;
  if (one) {
    oneId = await store.ensureId(one);
    await store.moveToDay(one, today, "top");
  }
  await store.updateDay(today, { dayStarted: minutesOfDay(new Date()), ...(oneId ? { oneThing: oneId } : {}) }, true);
  closeRitual(ctx);
  if (start && one) {
    await plugin.timer.start(one);
    ctx.view.showTab("focus");
  }
}
