// Shared pieces of the ritual cards: header, step heading, button row, closing and dismissing.
import { isoDay } from "../../data/dates";
import { dismissRitual, type RitualId } from "../../data/rituals";
import type QuestlogPlugin from "../../main";
import { t } from "../../i18n";
import type { Ctx } from "../ctx";

let seq = 0;
/** A name for a radio group that is unique across views sharing one document (main tab and sidebar). */
export function groupName(prefix: string): string {
  seq += 1;
  return `ql-${prefix}-${seq}`;
}

/** The inline card a ritual renders into. A region with a heading, focusable for the command's focus move. */
export function ritualCard(slot: HTMLElement, title: string, sub?: string): HTMLElement {
  const card = slot.createDiv({ cls: "ql-card ql-ritual-card", attr: { role: "region", "aria-label": title, tabindex: "-1" } });
  const head = card.createDiv({ cls: "ql-ritual-head" });
  head.createEl("h3", { cls: "ql-ritual-title", text: title });
  if (sub) head.createSpan({ cls: "ql-ritual-sub", text: sub });
  return card;
}

export function stepHead(card: HTMLElement, i: number, n: number, title: string): void {
  const h = card.createEl("h4", { cls: "ql-ritual-step" });
  if (n > 1) h.createSpan({ cls: "ql-ritual-step-n", text: t("ritual.step", { i: i + 1, n }) });
  h.createSpan({ text: title });
}

export function actionRow(card: HTMLElement): HTMLElement {
  return card.createDiv({ cls: "ql-ritual-actions" });
}

function clearDrafts(ctx: Ctx): void {
  for (const k of [...ctx.state.drafts.keys()]) if (k.startsWith("ritual:")) ctx.state.drafts.delete(k);
}

/** Close the card; `note` shows as a quiet line on Home until the tab changes. */
export function closeRitual(ctx: Ctx, note: string | null = null): void {
  ctx.state.ritual = null;
  ctx.state.ritualNote = note;
  clearDrafts(ctx);
  ctx.rerender();
}

/** "Not now": store the dismissal (data.json) and update every view. */
export async function dismiss(plugin: QuestlogPlugin, id: RitualId): Promise<void> {
  plugin.settings.rituals = dismissRitual(plugin.settings.rituals, id, isoDay(new Date()));
  await plugin.saveSettings();
  plugin.refreshViews();
}

/** "Not now" inside an open card: dismiss and close. Writes nothing else. */
export async function dismissCard(ctx: Ctx, id: RitualId): Promise<void> {
  closeRitual(ctx);
  await dismiss(ctx.plugin, id);
}

/** The step to show, kept within the steps that currently exist. */
export function stepIndex(ctx: Ctx, n: number): number {
  const s = ctx.state.ritual?.step ?? 0;
  return Math.max(0, Math.min(n - 1, s));
}

export function goStep(ctx: Ctx, step: number): void {
  if (ctx.state.ritual) ctx.state.ritual.step = step;
  ctx.rerender();
}
