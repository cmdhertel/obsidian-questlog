// The quest story: week chapters, newest first, read back from the notes. Writes nothing.
import { setIcon } from "obsidian";
import { addDays, fmtHours, isoWeek, parseDay } from "../data/dates";
import type { Quest, Session } from "../data/model";
import { periodRange } from "../data/periods";
import { buildStory, type MarkKind, type StoryMark } from "../data/story";
import { fmtDate, t } from "../i18n";
import type { Ctx } from "./ctx";
import { button, empty } from "./components";

const PAGE = 8;
const NOTES = 3;

const MARK_ICON: Record<MarkKind, string> = {
  created: "sparkles",
  "stage-started": "milestone",
  "stage-reached": "check-circle-2",
  paused: "pause",
  finished: "trophy",
};

function markText(m: StoryMark): string {
  switch (m.kind) {
    case "created":
      return t("story.created");
    case "stage-started":
      return t("story.started", { name: m.stage ?? "" });
    case "stage-reached":
      return t("story.reached", { name: m.stage ?? "" });
    case "paused":
      return t("story.paused");
    case "finished":
      return t("story.finished");
  }
}

function short(day: string): string {
  return fmtDate(parseDay(day), { day: "numeric", month: "short" });
}

function subHead(parent: HTMLElement, text: string): void {
  parent.createEl("h4", { cls: "ql-story-sub", text });
}

/** `sessions` are the sessions of this quest only. */
export function renderStory(parent: HTMLElement, ctx: Ctx, q: Quest, sessions: Session[]): void {
  const { store, state } = ctx;
  // Every review period counts, each on the last day of its range (#23).
  const reviews = [...store.reviews.values()].flatMap((r) => {
    const range = periodRange(r.id);
    return range ? [{ id: r.id, lastDay: range.end, answers: r.answers }] : [];
  });
  const weeks = buildStory({
    quest: q,
    sessions,
    closing: [...store.days.values()].filter((d) => d.closingLine).map((d) => ({ day: d.day, text: d.closingLine })),
    reviews,
  }).reverse();

  const wrap = parent.createDiv({ cls: "ql-story" });
  if (!weeks.length) {
    empty(wrap, t("story.empty"), "book-open");
    return;
  }
  const countKey = `story:${q.path}`;
  const shown = Math.max(PAGE, Number(state.drafts.get(countKey)) || PAGE);
  for (const w of weeks.slice(0, shown)) {
    const ch = wrap.createEl("section", { cls: "ql-card ql-story-week" });
    const head = ch.createDiv({ cls: "ql-story-head" });
    const n = Number(isoWeek(w.weekStart).slice(-2));
    head.createEl("h3", { cls: "ql-story-title", text: t("story.week", { n, range: `${short(w.weekStart)} – ${short(addDays(w.weekStart, 6))}` }) });
    if (w.minutes > 0) head.createSpan({ cls: "ql-story-hours ql-mono", text: fmtHours(w.minutes) });

    if (w.marks.length) {
      const ul = ch.createEl("ul", { cls: "ql-story-marks" });
      for (const m of w.marks) {
        const li = ul.createEl("li", { cls: `ql-story-mark is-${m.kind}` });
        setIcon(li.createSpan({ cls: "ql-story-icon", attr: { "aria-hidden": "true" } }), MARK_ICON[m.kind]);
        li.createSpan({ text: markText(m) });
        li.createSpan({ cls: "ql-story-day", text: short(m.day) });
      }
    }

    if (w.done.length) {
      const ul = ch.createEl("ul", { cls: "ql-story-done" });
      for (const d of w.done) {
        const li = ul.createEl("li");
        setIcon(li.createSpan({ cls: "ql-story-icon", attr: { "aria-hidden": "true" } }), "check");
        li.createSpan({ cls: "ql-story-text", text: d.text });
        if (d.stage) li.createSpan({ cls: "ql-story-stage", text: d.stage });
      }
    }

    if (w.notes.length) {
      subHead(ch, t("story.notes"));
      const key = `story-notes:${q.path}:${w.weekStart}`;
      const all = state.expanded.has(key);
      const ul = ch.createEl("ul", { cls: "ql-story-notes" });
      for (const note of all ? w.notes : w.notes.slice(0, NOTES)) {
        const li = ul.createEl("li");
        li.createSpan({ cls: "ql-story-day", text: short(note.day) });
        li.createSpan({ cls: "ql-story-text", text: note.text });
      }
      if (!all && w.notes.length > NOTES) {
        button(ch, t("story.more", { n: w.notes.length - NOTES }), () => {
          state.expanded.add(key);
          ctx.rerender();
        }, { cls: "ql-btn-plain ql-story-more" });
      }
    }

    if (w.closing.length) {
      subHead(ch, t("story.closing"));
      const ul = ch.createEl("ul", { cls: "ql-story-notes" });
      for (const c of w.closing) {
        const li = ul.createEl("li");
        li.createSpan({ cls: "ql-story-day", text: short(c.day) });
        li.createSpan({ cls: "ql-story-text", text: c.text });
      }
    }

    for (const r of w.reflections) {
      const b = ch.createEl("blockquote", { cls: "ql-story-reflection" });
      b.createDiv({ cls: "ql-story-sub", text: t("story.reflection", { question: r.question }) });
      b.createDiv({ cls: "ql-story-text", text: r.text });
    }
  }
  if (weeks.length > shown) {
    button(wrap, t("story.earlier"), () => {
      state.drafts.set(countKey, String(shown + PAGE));
      ctx.rerender();
    }, { icon: "chevrons-down", cls: "ql-story-earlier" });
  }
}
