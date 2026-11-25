// Plan: the week board. Backlog on the left, one column per day. Drag tasks between columns or use the task menu.
// Unfinished tasks of past days roll over to today by themselves.
// #27: the week fits at about 1100 px; narrower wide panes fold the backlog into a rail that opens as an overlay;
// mid panes scroll and start at today; the backlog has a search field and quest chips that only hide rows.
import { setIcon } from "obsidian";
import { addDays, fmtHours, isoWeek, parseDay, weekDays } from "../../data/dates";
import { filterBacklog, isFiltering, validChip, type BacklogItem } from "../../data/backlog";
import { totalMinutes } from "../../data/stats";
import type { Task } from "../../data/model";
import { weeklyTargetHours } from "../../settings";
import { fmtDate, t, weekdayShort } from "../../i18n";
import type { Ctx } from "../ctx";
import { addTaskField, button, dot, dropTarget, empty, iconButton, pageHead, questIcon, questName, revealClampButtons, taskRow } from "../components";

/** Narrow panes fold a long backlog so the days stay close. */
const FOLD_OVER = 8;
let uid = 0;

export function renderPlan(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const days = weekDays(state.planDay);
  const sessions = store.sessions(days);
  const questMin = totalMinutes(sessions.filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  const actions = pageHead(
    el,
    t("plan.title"),
    `${t("common.week")} ${isoWeek(days[0]!).replace(/^\d{4}-W0?/, "")} · ${target ? t("cal.ofTarget", { h: fmtHours(questMin), target: `${target}h` }) : fmtHours(questMin)}`,
  );
  const nav = actions.createDiv({ cls: "ql-navgroup" });
  iconButton(nav, "chevron-left", t("nav.prevWeek"), () => {
    state.planDay = addDays(state.planDay, -7);
    ctx.rerender();
  });
  button(nav, t("nav.today"), () => {
    state.planDay = today;
    ctx.rerender();
  }, { cls: days.includes(today) ? "is-current" : "" });
  iconButton(nav, "chevron-right", t("nav.nextWeek"), () => {
    state.planDay = addDays(state.planDay, 7);
    ctx.rerender();
  });

  // The scroll key carries the week, so a new week starts at today again (see QuestlogView.render).
  const board = el.createDiv({ cls: "ql-board", attr: { "data-scroll-key": `plan-board:${days[0]}` } });
  if (ctx.width === "mid") {
    const sat = days.find((d) => parseDay(d).getDay() === 6);
    if (sat) {
      button(actions, t("plan.weekend"), () => {
        const col = board.querySelector<HTMLElement>(`[data-day="${sat}"]`);
        col?.scrollIntoView({ inline: "start", block: "nearest", behavior: "smooth" });
      }, { icon: "sofa", cls: "ql-plan-weekend" });
    }
  }

  backlogColumn(board, ctx);

  // Day columns
  for (const day of days) {
    const past = day < today;
    const col = board.createDiv({
      cls: "ql-col" + (day === today ? " is-today is-scroll-start" : "") + (past ? " is-past" : ""),
      attr: { "data-day": day },
    });
    const h = col.createDiv({ cls: "ql-col-head" });
    const d = parseDay(day);
    h.createSpan({ cls: "ql-col-title", text: day === today ? t("nav.today") : weekdayShort(d) });
    h.createSpan({ cls: "ql-col-date", text: fmtDate(d, { day: "numeric", month: "short" }) });
    const min = totalMinutes(sessions.filter((s) => s.day === day));
    if (min) h.createSpan({ cls: "ql-col-meta ql-mono", text: fmtHours(min) });

    const list = col.createDiv({ cls: "ql-list" });
    const open = store.dayTasks(day, today);
    const done = store.doneOn(day);
    if (!past) {
      dropTarget(list, ctx, day);
      for (const x of open) taskRow(list, ctx, x, { showQuest: true, day, compact: true, expandable: true });
    }
    for (const x of done) taskRow(list, ctx, x, { showQuest: true, compact: true, expandable: true });
    if (!open.length && !done.length) empty(list, past ? t("plan.pastEmpty") : t("plan.dayEmpty"), past ? "moon" : "sun");
    if (!past) addTaskField(col, ctx, { quests: store.workable(), defaultQuest: store.other, day, stateKey: `plan-${day}` });
  }
}

interface Row extends BacklogItem {
  el: HTMLElement;
  group: HTMLElement;
}

/** The backlog: a rail button (only shown on wide panes under about 1100 px), then the panel with search, chips and list. */
function backlogColumn(board: HTMLElement, ctx: Ctx): void {
  const { store, state } = ctx;
  const workable = store.workable();
  const backlog = store.backlog();
  const total = backlog.length;
  const groups: { name: string; color: string; tasks: Task[]; quest: (typeof workable)[number] }[] = [];
  for (const q of workable) {
    const tasks = backlog.filter((x) => x.questPath === q.path);
    if (tasks.length) groups.push({ name: questName(q), color: q.color, tasks, quest: q });
  }
  // A chip whose quest has no backlog task any more falls back to "All".
  state.backlogQuest = validChip(state.backlogQuest, groups.map((g) => g.name));

  const foldable = ctx.width === "narrow" && total > FOLD_OVER;
  const folded = foldable && !state.expanded.has("plan-backlog");
  const col = board.createDiv({ cls: "ql-col ql-col-backlog" + (state.backlogOpen ? " is-open" : "") + (folded ? " is-folded" : "") });
  const panelId = `ql-backlog-${++uid}`;

  // Rail: a 44 px strip with the count; opens the panel as an overlay.
  const rail = col.createEl("button", {
    cls: "ql-backlog-rail",
    attr: { "aria-controls": panelId, "aria-expanded": String(state.backlogOpen), "aria-label": t("plan.backlogRail", { n: total }) },
  });
  setIcon(rail.createSpan({ cls: "ql-backlog-rail-icon" }), "inbox");
  rail.createSpan({ cls: "ql-backlog-rail-count ql-mono", text: String(total) });
  rail.createSpan({ cls: "ql-backlog-rail-label", text: t("plan.backlog") });

  const panel = col.createDiv({ cls: "ql-backlog-panel", attr: { id: panelId } });
  const setOpen = (open: boolean) => {
    state.backlogOpen = open;
    col.toggleClass("is-open", open);
    rail.setAttr("aria-expanded", String(open));
    if (open) {
      search.focus();
      revealClampButtons(panel);
    } else rail.focus();
  };
  rail.onclick = () => setOpen(!state.backlogOpen);

  const bh = panel.createDiv({ cls: "ql-col-head" });
  if (foldable) {
    const toggle = bh.createEl("button", {
      cls: "ql-backlog-fold",
      attr: { "aria-expanded": String(!folded), "aria-controls": `${panelId}-body` },
    });
    setIcon(toggle.createSpan({ cls: "ql-backlog-fold-icon" }), folded ? "chevron-right" : "chevron-down");
    toggle.createSpan({ cls: "ql-col-title", text: t("plan.backlog") });
    toggle.onclick = () => {
      if (folded) state.expanded.add("plan-backlog");
      else state.expanded.delete("plan-backlog");
      ctx.rerender();
    };
  } else {
    bh.createSpan({ cls: "ql-col-title", text: t("plan.backlog") });
  }
  const count = bh.createSpan({ cls: "ql-col-meta", attr: { "aria-live": "polite" } });
  iconButton(bh, "x", t("plan.backlogClose"), () => setOpen(false), "ql-backlog-close");

  const body = panel.createDiv({ cls: "ql-backlog-body", attr: { id: `${panelId}-body` } });
  if (folded) body.hidden = true;

  // Search field and quest chips (only when there is something to find).
  const tools = body.createDiv({ cls: "ql-backlog-tools" });
  const sw = tools.createDiv({ cls: "ql-search" });
  setIcon(sw.createSpan({ cls: "ql-search-icon", attr: { "aria-hidden": "true" } }), "search");
  const search = sw.createEl("input", {
    type: "text",
    cls: "ql-search-input",
    attr: { placeholder: t("plan.search"), "aria-label": t("plan.searchLabel"), enterkeyhint: "search", autocomplete: "off", spellcheck: "false" },
  });
  search.value = state.backlogQuery;
  const clear = iconButton(sw, "x", t("plan.searchClear"), () => {
    search.value = "";
    state.backlogQuery = "";
    apply();
    search.focus();
  }, "ql-search-clear");

  const chips = tools.createDiv({ cls: "ql-backlog-chips", attr: { role: "group", "aria-label": t("plan.filterQuest") } });
  const chipEls: [string | null, HTMLButtonElement][] = [];
  const chip = (id: string | null, label: string, color?: string) => {
    const b = chips.createEl("button", { cls: "ql-chip-btn ql-backlog-chip" });
    if (color) b.style.setProperty("--ql-color", color);
    setIcon(b.createSpan({ cls: "ql-chip-check", attr: { "aria-hidden": "true" } }), "check");
    if (color) dot(b, color);
    b.createSpan({ text: label });
    b.onclick = () => {
      state.backlogQuest = id;
      apply();
    };
    chipEls.push([id, b]);
  };
  chip(null, t("plan.allQuests"));
  for (const g of groups) chip(g.name, g.name, g.color);
  if (!total) tools.hidden = true;

  // The list
  const blist = body.createDiv({ cls: "ql-list" });
  dropTarget(blist, ctx, null);
  const rows: Row[] = [];
  for (const g of groups) {
    const head = blist.createDiv({ cls: "ql-group-head" });
    questIcon(head, g.quest, "is-small");
    head.createSpan({ text: g.name });
    for (const x of g.tasks) {
      const el = taskRow(blist, ctx, x, { day: null, compact: true, expandable: true });
      rows.push({ el, group: head, text: x.text, quest: g.name });
    }
  }
  if (!total) empty(blist, t("plan.backlogEmpty"), "archive");
  const none = blist.createDiv({ cls: "ql-backlog-none ql-small ql-muted", text: t("plan.searchNone") });
  addTaskField(body, ctx, { quests: workable, defaultQuest: store.other, day: null, stateKey: "plan-backlog" });

  /** Hide what the filter leaves out; never re-render, so the search field keeps its focus. */
  function apply(): void {
    const filter = { quest: state.backlogQuest, query: state.backlogQuery };
    const shown = new Set(filterBacklog(rows, filter));
    for (const r of rows) r.el.hidden = !shown.has(r);
    for (const g of new Set(rows.map((r) => r.group))) g.hidden = !rows.some((r) => r.group === g && shown.has(r));
    const filtering = isFiltering(filter);
    count.setText(filtering ? t("plan.nOfM", { n: shown.size, m: total }) : String(total));
    none.hidden = !total || shown.size > 0;
    clear.hidden = !search.value;
    for (const [id, b] of chipEls) {
      const on = id === state.backlogQuest;
      b.toggleClass("is-active", on);
      b.setAttr("aria-pressed", String(on));
    }
    if (filtering) revealClampButtons(blist);
  }
  search.oninput = () => {
    state.backlogQuery = search.value;
    apply();
  };
  search.onkeydown = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (search.value) {
      search.value = "";
      state.backlogQuery = "";
      apply();
    } else if (state.backlogOpen) setOpen(false);
  };
  panel.onkeydown = (e) => {
    if (e.key === "Escape" && state.backlogOpen && e.target !== search) {
      e.preventDefault();
      setOpen(false);
    }
  };
  apply();
}
