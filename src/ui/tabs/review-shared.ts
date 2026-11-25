// Pieces shared by the weekly review and the longer periods (#23): the summary, the split card, the done list and
// the questions form.
import { setIcon } from "obsidian";
import { parseDay } from "../../data/dates";
import { minutesByQuest } from "../../data/stats";
import type { Session, Task } from "../../data/model";
import { OTHER_COLOR } from "../../data/store";
import type { QuestStore } from "../../data/store";
import { fmtDate, t } from "../../i18n";
import { fmtHours } from "../../data/dates";
import type { Ctx } from "../ctx";
import { act, button, dot, empty, iconButton, questName, sectionHead } from "../components";

export const round1 = (h: number): number => Math.round(h * 10) / 10;

/** Frontmatter key of a quest's hours: `hours_travel_book`. */
export const hoursKey = (name: string): string => `hours_${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}`;

/** The numeric summary of a review note: totals, tasks done, then hours per quest (Other left out). */
export function summaryOf(store: QuestStore, sessions: Session[], totals: { total: number; questMin: number; otherMin: number }, tasksDone: number): Record<string, number | string> {
  const summary: Record<string, number | string> = {
    hours_total: round1(totals.total / 60),
    hours_quests: round1(totals.questMin / 60),
    hours_other: round1(totals.otherMin / 60),
    tasks_done: tasksDone,
  };
  for (const [name, min] of minutesByQuest(sessions)) {
    if (!store.isQuestWork(name)) continue;
    summary[hoursKey(name)] = round1(min / 60);
  }
  return summary;
}

export function legendItem(parent: HTMLElement, color: string, label: string, value: string): void {
  const i = parent.createDiv({ cls: "ql-legend-item" });
  dot(i, color);
  i.createSpan({ text: label });
  i.createSpan({ cls: "ql-mono ql-muted", text: value });
}

/** Quest work vs. other as one split bar with a legend. */
export function splitCard(parent: HTMLElement, total: number, questMin: number, otherMin: number): void {
  const split = parent.createDiv({ cls: "ql-card ql-section" });
  sectionHead(split, t("review.split"), "split", fmtHours(total));
  if (!total) {
    empty(split, t("review.noTime"), "timer");
    return;
  }
  const sb = split.createDiv({ cls: "ql-split" });
  const qPart = sb.createDiv({ cls: "ql-split-part is-quest" });
  qPart.style.flexGrow = String(questMin);
  const oPart = sb.createDiv({ cls: "ql-split-part is-other" });
  oPart.style.flexGrow = String(otherMin);
  const legend = split.createDiv({ cls: "ql-legend" });
  legendItem(legend, "var(--interactive-accent)", t("review.questWork"), fmtHours(questMin));
  legendItem(legend, OTHER_COLOR, t("other.name"), fmtHours(otherMin));
}

/** Done tasks grouped by day, newest day first. */
export function doneList(parent: HTMLElement, ctx: Ctx, days: string[], done: Task[], emptyText: string): void {
  const { store } = ctx;
  const dc = parent.createDiv({ cls: "ql-card ql-section" });
  sectionHead(dc, t("review.doneList"), "check-circle-2", String(done.length));
  if (!done.length) empty(dc, emptyText, "sunrise");
  const dl = dc.createDiv({ cls: "ql-donelog" });
  for (const day of [...days].reverse()) {
    const items = done.filter((x) => x.doneDate === day);
    if (!items.length) continue;
    dl.createDiv({ cls: "ql-donelog-day", text: fmtDate(parseDay(day), { weekday: "long", day: "numeric", month: "short" }) });
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
}

let answerIds = 0;

/** The reflection questions with textareas; drafts live in `state.drafts` under `<key>|<question>`. */
export function questions(
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
    const id = `ql-answer-${++answerIds}`;
    f.createEl("label", { text: q, attr: { for: id } });
    const ta = f.createEl("textarea", { cls: "ql-answer", attr: { rows: "3", id } });
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
