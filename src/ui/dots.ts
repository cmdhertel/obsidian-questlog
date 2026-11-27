// Week dots on a quest card: one dot per week, up to 12 weeks. Full, half or empty; never a warning colour.
import { setTooltip } from "obsidian";
import { fmtDuration, fmtHours, isoWeek, parseDay } from "../data/dates";
import { minutesByWeekStart, weekDots, type Dot, type DotsSummary } from "../data/dots";
import type { Quest, Session } from "../data/model";
import { fmtDate, t } from "../i18n";
import { isOn } from "../settings";
import type { Ctx } from "./ctx";

function dotTip(d: Dot): string {
  const when = d.current ? t("dots.tipNow") : t("dots.tipWeek", { date: fmtDate(parseDay(d.weekStart), { day: "numeric", month: "short" }) });
  const time =
    d.minutes <= 0
      ? t("dots.tipNone")
      : d.targetMinutes > 0
        ? t("dots.tipTime", { have: fmtDuration(d.minutes), target: fmtHours(d.targetMinutes) })
        : fmtDuration(d.minutes);
  return `${when}: ${time}`;
}

function summaryText(s: DotsSummary): string {
  if (!s) return "";
  if (s.kind === "paused") return t("dots.paused");
  if (s.kind === "quiet") return t("dots.quiet", { n: s.weeks });
  return t("dots.count", { n: s.weeks, of: s.of });
}

/**
 * `sessions` are the sessions of this quest only. Renders nothing for done quests, quests without a start, and
 * quests without an hour target (or with hour targets switched off).
 */
export function weekDotsView(parent: HTMLElement, ctx: Ctx, q: Quest, sessions: Session[]): HTMLElement | null {
  if (!q.weeklyHours || !isOn(ctx.plugin.settings, "hours")) return null;
  let first: string | null = null;
  for (const s of sessions) if (!first || s.day < first) first = s.day;
  const { dots, summary } = weekDots({
    today: ctx.today,
    status: q.status,
    created: q.created,
    firstSession: first,
    minutes: minutesByWeekStart(sessions),
    // The week's planned hours (#21) over `weekly_hours`.
    targetHours: (w) => ctx.store.weekTarget(q, isoWeek(w)),
  });
  if (!dots.length) return null;
  const wrap = parent.createDiv({ cls: "ql-dots-row" + (q.status === "paused" ? " is-paused" : "") });
  const list = wrap.createDiv({ cls: "ql-dots", attr: { role: "list", "aria-label": t("dots.label") } });
  const base = summaryText(summary);
  const caption = wrap.createSpan({ cls: "ql-dots-text", text: base });
  let shown: Dot | null = null;
  for (const d of dots) {
    const tip = dotTip(d);
    const el = list.createSpan({
      cls: `ql-dot-week is-${d.level}` + (d.current ? " is-current" : ""),
      attr: { role: "listitem", "aria-label": tip },
    });
    setTooltip(el, tip);
    // On touch there is no hover: a tap puts the week into the caption, a second tap restores it.
    el.onclick = (e) => {
      e.stopPropagation();
      shown = shown === d ? null : d;
      caption.setText(shown ? tip : base);
    };
  }
  return wrap;
}
