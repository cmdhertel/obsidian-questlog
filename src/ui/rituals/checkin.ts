// Quest check-in (#22): one calm question about a quiet quest — keep, pause, shrink or finish.
import { Notice, TFile } from "obsidian";
import { parseDay } from "../../data/dates";
import { CHECKIN_ACTIONS, parseCheckins, type CheckinAction } from "../../data/checkin";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { act, button, questIcon } from "../components";
import { checkinQuestFor } from "../ritual";
import { actionRow, closeRitual, dismissCard, groupName, ritualCard } from "./frame";

const ACTION = "ritual:checkin:action";
const HOURS = "ritual:checkin:hours";
const TEXT = "ritual:checkin:text";

function longDate(day: string): string {
  return fmtDate(parseDay(day), { day: "numeric", month: "long", year: "numeric" });
}

export function renderCheckin(slot: HTMLElement, ctx: Ctx, questName: string): void {
  const { store, state, today, plugin } = ctx;
  const q = store.quest(questName);
  if (!q || q.kind !== "quest") {
    // Renamed or deleted while the card was open: close quietly; the next render shows the line again.
    state.ritual = null;
    for (const k of [...state.drafts.keys()]) if (k.startsWith("ritual:")) state.drafts.delete(k);
    new Notice(t("ritual.checkin.gone"));
    return;
  }
  const pick = checkinQuestFor(plugin, today);
  const weeks = pick?.quest === q ? pick.weeks : null;
  const card = ritualCard(slot, weeks ? t("ritual.checkin.title", { quest: q.name, n: weeks }) : q.name);
  card.style.setProperty("--ql-color", q.color);
  const head = card.querySelector(".ql-ritual-head");
  if (head) questIcon(head as HTMLElement, q, "is-small");
  if (q.why) card.createDiv({ cls: "ql-ritual-why", text: `“${q.why}”` });

  let last: string | null = null;
  for (const s of store.allSessions()) if (s.quest === q.name && (!last || s.day > last)) last = s.day;
  card.createDiv({ cls: "ql-ritual-meta", text: last ? t("ritual.checkin.lastLogged", { date: longDate(last) }) : t("ritual.checkin.never") });
  // The previous check-in line, read from the note on demand.
  const prev = card.createDiv({ cls: "ql-ritual-meta" });
  const f = plugin.app.vault.getAbstractFileByPath(q.path);
  if (f instanceof TFile) {
    void plugin.app.vault.cachedRead(f).then((c) => {
      const all = parseCheckins(c);
      const p = all[all.length - 1];
      if (p) prev.setText(t("ritual.checkin.previous", { date: longDate(p.date), action: t(`ritual.checkin.${p.action}`) + (p.text ? ` — ${p.text}` : "") }));
    });
  }

  const value = (state.drafts.get(ACTION) as CheckinAction | undefined) ?? "keep";
  const name = groupName("checkin");
  const group = card.createDiv({ cls: "ql-radio-chips", attr: { role: "radiogroup", "aria-label": t("ritual.checkin.choice", { quest: q.name }) } });
  const hoursWrap = card.createDiv({ cls: "ql-ritual-field", attr: { "aria-live": "polite" } });
  const fillHours = (show: boolean) => {
    hoursWrap.empty();
    if (!show) return;
    const id = groupName("checkin-hours");
    hoursWrap.createEl("label", { cls: "ql-ritual-label", text: t("ritual.checkin.hours"), attr: { for: id } });
    const input = hoursWrap.createEl("input", { type: "number", attr: { id, min: "0", step: "0.5", inputmode: "decimal" } });
    input.value = state.drafts.get(HOURS) ?? String(q.weeklyHours);
    input.oninput = () => state.drafts.set(HOURS, input.value);
  };
  for (const a of CHECKIN_ACTIONS) {
    const chip = group.createEl("label", { cls: "ql-radio-chip" });
    const input = chip.createEl("input", { type: "radio", attr: { name, value: a } });
    input.checked = a === value;
    chip.createSpan({ text: t(`ritual.checkin.${a}`) });
    input.onchange = () => {
      if (!input.checked) return;
      state.drafts.set(ACTION, a);
      fillHours(a === "shrink");
    };
  }
  fillHours(value === "shrink");

  const tid = groupName("checkin-text");
  card.createEl("label", { cls: "ql-ritual-label", text: t("ritual.checkin.sentence"), attr: { for: tid } });
  const text = card.createEl("input", { type: "text", cls: "ql-ritual-input", attr: { id: tid, maxlength: "500" } });
  text.value = state.drafts.get(TEXT) ?? "";
  text.oninput = () => state.drafts.set(TEXT, text.value);

  const acts = actionRow(card);
  button(
    acts,
    t("ritual.checkin.save"),
    act(async () => {
      const a = (state.drafts.get(ACTION) as CheckinAction | undefined) ?? "keep";
      let hours: number | undefined;
      if (a === "shrink") {
        const n = Number((state.drafts.get(HOURS) ?? String(q.weeklyHours)).replace(",", "."));
        hours = Number.isFinite(n) && n > 0 ? n : 0;
      }
      await store.checkIn(q, a, state.drafts.get(TEXT) ?? "", hours);
      closeRitual(ctx, t("ritual.checkin.saved"));
    }),
    { cta: true },
  );
  button(acts, t("ritual.notNow"), act(() => dismissCard(ctx, "check-in")), { cls: "ql-btn-plain" });
}
