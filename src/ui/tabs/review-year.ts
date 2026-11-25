// Yearly review (#26): each quest's year in one line with a way into its story, the biggest shifts between
// quarters, and the year's weekly answers to one question in your own words.
import { fmtHours, parseDay } from "../../data/dates";
import { biggestShifts, quarterHours, questionsSeen, weeklyAnswersByMonth } from "../../data/review-year";
import { periodQuestions, weeklyQuestions } from "../../settings";
import { fmtDate, t } from "../../i18n";
import type { Quest } from "../../data/model";
import type { Ctx } from "../ctx";
import { bar, button, empty, questIcon, sectionHead } from "../components";
import type { PeriodConfig, PeriodInfo } from "./review-periods";

const CLAMP_LINES = 5;
let uid = 0;

export const YEAR: PeriodConfig = {
  questions: (s) => periodQuestions(s, "year"),
  extras(el, ctx, info) {
    stories(el, ctx, info);
    shifts(el, ctx, info);
    ownWords(el, ctx, info);
  },
};

const inYear = (day: string | null, info: PeriodInfo): boolean => !!day && day >= info.range.start && day <= info.range.end;
const short = (day: string) => fmtDate(parseDay(day), { day: "numeric", month: "short" });

/** "Created 3 Feb · 2 stages reached · finished 14 Oct", only what happened this year. */
function yearLine(q: Quest, info: PeriodInfo): string {
  const parts: string[] = [];
  if (inYear(q.created, info)) parts.push(t("review.yCreated", { date: short(q.created!) }));
  const reached = q.stages.filter((s) => inYear(s.reached, info)).length;
  if (reached) parts.push(t("review.yReached", { n: reached }));
  if (q.status === "paused" && inYear(q.paused, info)) parts.push(t("review.yPaused", { date: short(q.paused!) }));
  if (inYear(q.finished, info)) parts.push(t("review.yFinished", { date: short(q.finished!) }));
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function stories(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store, state } = ctx;
  const card = el.createDiv({ cls: "ql-card ql-section" });
  sectionHead(card, t("review.stories"), "book-open");
  const quests = store.quests.filter((q) => q.kind === "quest" && (info.byQuest.has(q.name) || inYear(q.finished, info)));
  const orphans = [...info.byQuest.keys()].filter((n) => store.isQuestWork(n) && !store.quest(n));
  if (!quests.length && !orphans.length) {
    empty(card, t("review.storiesNone"), "book-open");
    return;
  }
  const ul = card.createEl("ul", { cls: "ql-ystories" });
  for (const q of quests) {
    const li = ul.createEl("li", { cls: "ql-ystory" });
    li.style.setProperty("--ql-color", q.color);
    const head = li.createDiv({ cls: "ql-ystory-head" });
    const n = head.createDiv({ cls: "ql-prow-name" });
    questIcon(n, q, "is-small");
    n.createSpan({ cls: "ql-prow-label", text: q.name });
    if (q.status !== "active") n.createSpan({ cls: "ql-prow-status", text: t(q.status === "done" ? "review.status.done" : "review.status.paused") });
    head.createSpan({ cls: "ql-mono", text: fmtHours(info.byQuest.get(q.name) ?? 0) });
    const line = yearLine(q, info);
    if (line) li.createDiv({ cls: "ql-small ql-muted", text: line });
    button(li, t("review.openStory"), () => {
      state.questOpen = q.path;
      state.questView = "story";
      ctx.view.showTab("quests");
    }, { icon: "book-open", cls: "ql-ystory-open" }).setAttr("aria-label", `${t("review.openStory")}: ${q.name}`);
  }
  for (const name of orphans) {
    const li = ul.createEl("li", { cls: "ql-ystory" });
    const head = li.createDiv({ cls: "ql-ystory-head" });
    head.createSpan({ cls: "ql-prow-label", text: name });
    head.createSpan({ cls: "ql-mono", text: fmtHours(info.byQuest.get(name) ?? 0) });
  }
}

function shifts(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store } = ctx;
  const card = el.createDiv({ cls: "ql-card ql-section" });
  sectionHead(card, t("review.shifts"), "arrow-left-right");
  const year = Number(info.id);
  const hours = quarterHours(
    store.allSessions().filter((s) => store.isQuestWork(s.quest)),
    year,
  );
  const order = store.quests.map((q) => q.name);
  const list = biggestShifts(hours, 3, order);
  if (!list.length) {
    empty(card, t("review.notEnough"), "arrow-left-right");
    return;
  }
  const sentences = card.createEl("ul", { cls: "ql-shift-lines" });
  for (const s of list) {
    sentences.createEl("li", {
      text: t("review.shiftLine", { quest: s.quest, a: fmtHours(s.before), qa: `Q${s.from + 1}`, b: fmtHours(s.after), qb: `Q${s.from + 2}` }),
    });
  }
  const rows = [...hours.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a[0].localeCompare(b[0]);
  });
  const max = Math.max(60, ...rows.flatMap(([, r]) => r));
  const scroll = card.createDiv({ cls: "ql-ytable-wrap" });
  const table = scroll.createEl("table", { cls: "ql-ytable" });
  table.createEl("caption", { cls: "ql-sr-only", text: t("review.shiftsTable", { year }) });
  const hr = table.createEl("thead").createEl("tr");
  hr.createEl("th", { text: t("session.quest"), attr: { scope: "col" } });
  for (let i = 1; i <= 4; i++) hr.createEl("th", { text: `Q${i}`, attr: { scope: "col" } });
  const body = table.createEl("tbody");
  for (const [name, r] of rows) {
    const q = store.quest(name);
    const tr = body.createEl("tr");
    const th = tr.createEl("th", { attr: { scope: "row" } });
    const n = th.createDiv({ cls: "ql-prow-name" });
    if (q) questIcon(n, q, "is-small");
    n.createSpan({ cls: "ql-prow-label", text: name });
    r.forEach((min, i) => {
      const td = tr.createEl("td");
      const b = bar(td, min, max, q?.color ?? "var(--text-faint)");
      b.setAttr("role", "img");
      b.setAttr("aria-label", `${name} Q${i + 1}: ${fmtHours(min)}`);
      td.createDiv({ cls: "ql-mono ql-small", text: min ? fmtHours(min) : "–", attr: { "aria-hidden": "true" } });
    });
  }
}

function ownWords(el: HTMLElement, ctx: Ctx, info: PeriodInfo): void {
  const { store, state, plugin } = ctx;
  const card = el.createDiv({ cls: "ql-card ql-section ql-ownwords" });
  sectionHead(card, t("review.ownWords"), "quote");
  const year = Number(info.id);
  const reviews = [...store.reviews.values()];
  const seen = questionsSeen(reviews, year);
  if (!seen.length) {
    empty(card, t("review.ownWordsNone"), "quote");
    return;
  }
  const key = `year:${info.id}:question`;
  const current = weeklyQuestions(plugin.settings);
  const fallback = seen.find((s) => current.includes(s.question)) ?? seen[0]!;
  const chosen = seen.find((s) => s.question === state.drafts.get(key)) ?? fallback;

  const sid = `ql-ownwords-${++uid}`;
  const pick = card.createDiv({ cls: "ql-ownwords-pick" });
  pick.createEl("label", { cls: "ql-small", text: t("review.ownWordsPick"), attr: { for: sid } });
  const sel = pick.createEl("select", { cls: "dropdown", attr: { id: sid } });
  for (const s of seen) {
    const o = sel.createEl("option", { text: `${s.question} (${s.count})`, attr: { value: s.question } });
    o.selected = s.question === chosen.question;
  }
  sel.onchange = () => {
    state.drafts.set(key, sel.value);
    ctx.rerender();
  };

  const groups = weeklyAnswersByMonth(reviews, year, chosen.question);
  const openKey = `year:${info.id}:month`;
  const openMonth = state.drafts.get(openKey) ?? groups[0]?.month ?? "";
  const list = card.createDiv({ cls: "ql-ownwords-months" });
  for (const g of groups) {
    const isOpen = g.month === openMonth;
    const sec = list.createDiv({ cls: "ql-ownwords-month" + (isOpen ? " is-open" : "") });
    const pid = `ql-ownwords-m-${++uid}`;
    const head = sec.createEl("button", {
      cls: "ql-ownwords-toggle",
      attr: { "aria-expanded": String(isOpen), "aria-controls": pid },
    });
    head.createSpan({ text: fmtDate(parseDay(`${g.month}-01`), { month: "long" }) });
    head.createSpan({ cls: "ql-small ql-muted", text: String(g.answers.length) });
    head.onclick = () => {
      state.drafts.set(openKey, isOpen ? "-" : g.month);
      ctx.rerender();
    };
    const panel = sec.createDiv({ cls: "ql-ownwords-panel", attr: { id: pid } });
    if (!isOpen) {
      panel.hidden = true;
      continue;
    }
    for (const a of g.answers) {
      const quote = panel.createEl("figure", { cls: "ql-ownwords-quote" });
      quote.createEl("figcaption", { cls: "ql-small ql-muted", text: `${t("common.week")} ${Number(a.week.slice(-2))}` });
      const bq = quote.createEl("blockquote", { cls: "ql-clamp", text: a.text });
      bq.style.setProperty("--ql-clamp", String(CLAMP_LINES));
      const more = quote.createEl("button", { cls: "ql-linkbtn ql-small", text: t("review.showMore"), attr: { "aria-expanded": "false" } });
      more.hidden = true;
      more.onclick = () => {
        const open = bq.hasClass("is-open");
        bq.toggleClass("is-open", !open);
        more.setAttr("aria-expanded", String(!open));
        more.setText(t(open ? "review.showMore" : "review.showLess"));
      };
      // Show the button only when the text is actually cut off.
      bq.win.requestAnimationFrame(() => {
        if (bq.scrollHeight > bq.clientHeight + 1) more.hidden = false;
      });
    }
  }
}
