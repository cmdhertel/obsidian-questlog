// Quarterly review (#25): a vision check and a decision per quest (keep, pause or resume, finish, weekly hours).
// Decisions are applied with their own button, separate from saving the reflection, and written to the quest notes.
import { Notice } from "obsidian";
import { fmtHours, parseDay } from "../../data/dates";
import { currentStage } from "../../data/stages";
import { diffDecisions, quarterRows, type Decision, type DecisionInput, type QuarterRow } from "../../data/review-quarter";
import { monthsIn } from "../../data/periods";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, button, empty, questIcon, sectionHead } from "../components";
import { VisionModal } from "../modals";
import { isOn, periodQuestions } from "../../settings";
import { stageLabel } from "../stagepath";
import type { PeriodConfig, PeriodInfo } from "./review-periods";

let uid = 0;
const nextId = (p: string) => `ql-${p}-${++uid}`;

export const QUARTER: PeriodConfig = {
  questions: (s) => periodQuestions(s, "quarter"),
  extras(el, ctx, info) {
    if (isOn(ctx.plugin.settings, "vision")) visionCard(el, ctx, info);
    questDecisions(el, ctx, info);
  },
};

/** Radio chips in a fieldset-free group; the caller supplies the group label. */
function radios<T extends string>(parent: HTMLElement, label: string, options: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const name = nextId("radio");
  const group = parent.createDiv({ cls: "ql-radio-chips", attr: { role: "radiogroup", "aria-label": label } });
  for (const o of options) {
    const chip = group.createEl("label", { cls: "ql-radio-chip" });
    const input = chip.createEl("input", { type: "radio", attr: { name, value: o.id } });
    input.checked = o.id === value;
    chip.createSpan({ text: o.label });
    input.onchange = () => {
      if (input.checked) onChange(o.id);
    };
  }
  return group;
}

function visionCard(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store, state, plugin } = ctx;
  const card = el.createDiv({ cls: "ql-card ql-section ql-vcheck" });
  const updated = store.vision?.updated;
  sectionHead(card, t("review.visionCheck"), "compass", updated ? t("review.visionChanged", { date: fmtDate(parseDay(updated), { day: "numeric", month: "short", year: "numeric" }) }) : undefined);
  const text = store.visionText();
  if (!text) {
    const e = empty(card, t("review.visionNone"), "compass");
    button(e, t("vision.edit"), () => new VisionModal(plugin).open(), { icon: "pencil" });
    return;
  }
  card.createEl("blockquote", { cls: "ql-vcheck-text", text });
  const key = `quarter:${info.id}:vision`;
  const value = state.drafts.get(key) === "update" ? "update" : "right";
  const row = card.createDiv({ cls: "ql-vcheck-row" });
  const edit = row.createDiv({ cls: "ql-vcheck-edit", attr: { "aria-live": "polite" } });
  const fill = (v: string) => {
    edit.empty();
    if (v === "update") button(edit, t("vision.edit"), () => new VisionModal(plugin).open(), { icon: "pencil" });
  };
  radios(
    row,
    t("review.visionCheck"),
    [
      { id: "right", label: t("review.visionRight") },
      { id: "update", label: t("review.visionUpdate") },
    ],
    value,
    (v) => {
      state.drafts.set(key, v);
      fill(v);
    },
  );
  row.appendChild(edit);
  fill(value);
}

function questDecisions(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store, state, plugin } = ctx;
  const on = { vision: isOn(plugin.settings, "vision"), stages: isOn(plugin.settings, "stages"), hours: isOn(plugin.settings, "hours") };
  const card = el.createDiv({ cls: "ql-card ql-section ql-decide" });
  sectionHead(card, t("review.quarterQuests"), "flag");
  const rows = quarterRows(
    store.quests.map((q) => ({ name: q.name, status: q.status, weeklyHours: q.weeklyHours })),
    info.sessions,
    info.range,
    monthsIn(info.id),
  );
  if (!rows.length) {
    empty(card, t("review.quarterNone"), "flag");
    return;
  }
  const prefix = `quarter:${info.id}:q:`;
  const status = card.createDiv({ cls: "ql-decide-status ql-small ql-muted", attr: { "aria-live": "polite" } });
  status.setText(state.drafts.get(`${prefix}applied`) ?? "");
  const clearApplied = () => {
    state.drafts.delete(`${prefix}applied`);
    status.setText("");
  };

  const inputs = new Map<string, DecisionInput>();
  const list = card.createDiv({ cls: "ql-decide-list" });
  for (const row of rows) {
    const q = store.quest(row.name);
    if (!q) continue;
    const dk = `${prefix}${q.name}:decision`;
    const hk = `${prefix}${q.name}:hours`;
    const bk = `${prefix}${q.name}:base`;
    const paused = row.status === "paused";
    const input: DecisionInput = {
      decision: (state.drafts.get(dk) as Decision | undefined) ?? "keep",
      hours: state.drafts.get(hk) ?? String(row.weeklyHours),
    };
    inputs.set(row.name, input);

    const fs = list.createEl("fieldset", { cls: "ql-decide-row" });
    fs.style.setProperty("--ql-color", q.color);
    const legend = fs.createEl("legend", { cls: "ql-decide-legend" });
    questIcon(legend, q, "is-small");
    legend.createSpan({ text: q.name });
    if (paused) legend.createSpan({ cls: "ql-prow-status", text: t("review.status.paused") });
    if (q.why && on.vision) fs.createDiv({ cls: "ql-decide-why ql-small ql-muted", text: q.why });

    const facts = fs.createDiv({ cls: "ql-decide-facts" });
    facts.createSpan({ cls: "ql-mono", text: fmtHours(row.minutes) });
    facts.createSpan({ cls: "ql-small ql-muted", text: monthsLine(row, ctx.today) });
    if (on.stages) {
      const cur = q.stages.length ? currentStage(q.stages) : null;
      facts.createSpan({
        cls: "ql-small ql-muted",
        text: `${t("review.stage")}: ${q.stages.length ? (cur ? stageLabel(cur) : t("stage.allReached")) : "–"}`,
      });
    }

    const controls = fs.createDiv({ cls: "ql-decide-controls" });
    // With hour targets off the field is hidden and the hours stay as they are.
    if (on.hours) {
      const hid = nextId("hours");
      const hw = controls.createDiv({ cls: "ql-decide-hours" });
      hw.createEl("label", { cls: "ql-small", text: t("review.weeklyHoursFor", { quest: q.name }), attr: { for: hid } });
      const num = hw.createEl("input", { type: "number", attr: { id: hid, min: "0", step: "0.5", inputmode: "decimal" } });
      num.value = input.hours;
      num.oninput = () => {
        if (!state.drafts.has(bk)) state.drafts.set(bk, String(row.weeklyHours));
        state.drafts.set(hk, num.value);
        input.hours = num.value;
        clearApplied();
      };
      const base = state.drafts.get(bk);
      if (base !== undefined && Number(base) !== row.weeklyHours) {
        hw.createDiv({ cls: "ql-small ql-muted", text: t("review.changedElsewhere", { h: row.weeklyHours }) });
      }
    }
    radios<Decision>(
      controls,
      t("review.decisionFor", { quest: q.name }),
      [
        { id: "keep", label: t("review.keep") },
        paused ? { id: "resume", label: t("review.resume") } : { id: "pause", label: t("review.pause") },
        { id: "finish", label: t("review.finish") },
      ],
      input.decision === "pause" && paused ? "keep" : input.decision,
      (v) => {
        state.drafts.set(dk, v);
        input.decision = v;
        clearApplied();
      },
    );
  }

  const acts = card.createDiv({ cls: "ql-question-actions" });
  button(
    acts,
    t("review.apply"),
    act(async () => {
      const patches = diffDecisions(rows, inputs);
      for (const { name, patch } of patches) {
        const q = store.quest(name);
        if (q) await store.updateQuest(q, patch);
      }
      for (const k of [...state.drafts.keys()]) if (k.startsWith(prefix)) state.drafts.delete(k);
      const msg = patches.length ? t("review.applied", { n: patches.length }) : t("review.appliedNone");
      state.drafts.set(`${prefix}applied`, msg);
      new Notice(msg);
      ctx.rerender();
    }),
    { icon: "check" },
  );
}

/** "Oct 12h · Nov 9h · Dec 3h"; months that have not begun yet are left out. */
function monthsLine(row: QuarterRow, today: string): string {
  return row.byMonth.filter(([m]) => `${m}-01` <= today).map(([m, min]) => `${fmtDate(parseDay(`${m}-01`), { month: "short" })} ${fmtHours(min)}`).join(" · ");
}
