// Stages on the quest page: a path of nodes, the current stage open with its tasks, the others folded. Plus the soft compass.
import { Menu, setIcon, setTooltip } from "obsidian";
import { fmtHours, parseDay } from "../data/dates";
import type { Quest, Session, Stage } from "../data/model";
import { compass } from "../data/compass";
import { currentStage } from "../data/stages";
import { nextOpenStage } from "../data/stageedit";
import { stageMinutes } from "../data/stagehours";
import { fmtDate, t } from "../i18n";
import type { Ctx } from "./ctx";
import { act, addTaskField, button, dayHint, empty, iconButton, sectionHead, taskRow } from "./components";
import { ConfirmModal, ReachStageModal, StageModal } from "./modals";

const FOCUS_KEY = "stage-focus";

function short(day: string): string {
  return fmtDate(parseDay(day), { day: "numeric", month: "short" });
}

/** A stage's name for display; a heading may be empty. */
export function stageLabel(s: Stage): string {
  return s.name || `${t("stage.title")} ${s.index + 1}`;
}

function stateOf(q: Quest, s: Stage): "reached" | "current" | "upcoming" {
  if (s.reached) return "reached";
  return currentStage(q.stages)?.index === s.index ? "current" : "upcoming";
}

/** Dates under a node: reached "Sep 1 – Sep 28", current "since … · due …", upcoming "due …". */
function stageDates(s: Stage, state: "reached" | "current" | "upcoming"): string {
  if (state === "reached") return s.started && s.reached ? `${short(s.started)} – ${short(s.reached)}` : short(s.reached!);
  const parts: string[] = [];
  if (state === "current" && s.started) parts.push(t("stage.since", { date: short(s.started) }));
  if (s.target) parts.push(t("stage.due", { date: short(s.target) }));
  return parts.join(" · ");
}

/** Remember which stage header should get focus back after the next render (dialogs, menus). */
function keepFocus(ctx: Ctx, q: Quest, index: number | "add"): void {
  ctx.state.drafts.set(FOCUS_KEY, `${q.path}:${index}`);
}

function dropFocus(ctx: Ctx): void {
  ctx.state.drafts.delete(FOCUS_KEY);
}

function restoreFocus(ctx: Ctx, root: HTMLElement): void {
  const key = ctx.state.drafts.get(FOCUS_KEY);
  if (!key) return;
  const el = Array.from(root.querySelectorAll<HTMLElement>("[data-stage-focus]")).find((e) => e.dataset.stageFocus === key);
  if (!el) return;
  ctx.state.drafts.delete(FOCUS_KEY);
  const active = root.doc.activeElement;
  // Never steal focus from a field or from another pane.
  if (active && active !== root.doc.body && !ctx.view.contentEl.contains(active)) return;
  if (active?.instanceOf(HTMLInputElement) || active?.instanceOf(HTMLTextAreaElement)) return;
  el.focus();
}

/** Ask for a new target date (or none). */
export function targetDialog(ctx: Ctx, q: Quest, s: Stage): void {
  keepFocus(ctx, q, s.index);
  new StageModal(ctx.plugin.app, {
    heading: t("stage.targetFor", { name: stageLabel(s) }),
    name: null,
    target: s.target,
    withTarget: true,
    onSubmit: (_n, target) => ctx.store.setStageTarget(q, s, target),
    onCancel: () => dropFocus(ctx),
  }).open();
}

/** Mark a stage as reached; asks where open tasks go first. */
export function reachDialog(ctx: Ctx, q: Quest, s: Stage): void {
  keepFocus(ctx, q, s.index);
  const open = q.tasks.filter((x) => !x.done && x.stageIndex === s.index).length;
  if (!open) return act(() => ctx.store.reachStage(q, s, "loose"))();
  const next = nextOpenStage(q.stages, s.index);
  new ReachStageModal(ctx.plugin.app, {
    name: stageLabel(s),
    open,
    next: next === null ? null : stageLabel(q.stages[next]!),
    onChoose: (to) => ctx.store.reachStage(q, s, to),
    onCancel: () => dropFocus(ctx),
  }).open();
}

export function addStageDialog(ctx: Ctx, q: Quest): void {
  keepFocus(ctx, q, "add");
  new StageModal(ctx.plugin.app, {
    heading: t("stage.add"),
    name: "",
    target: null,
    withTarget: true,
    onSubmit: (name, target) => ctx.store.addStage(q, name, target),
    onCancel: () => dropFocus(ctx),
  }).open();
}

function stageMenu(ctx: Ctx, q: Quest, s: Stage): Menu {
  const { store, plugin } = ctx;
  const m = new Menu();
  const last = q.stages.length - 1;
  m.addItem((i) =>
    i.setTitle(t("stage.rename")).setIcon("pencil").onClick(() => {
      keepFocus(ctx, q, s.index);
      new StageModal(plugin.app, {
        heading: t("stage.rename"),
        name: s.name,
        target: null,
        withTarget: false,
        onSubmit: (name) => store.renameStage(q, s, name),
        onCancel: () => dropFocus(ctx),
      }).open();
    }),
  );
  m.addItem((i) => i.setTitle(t("stage.setTarget")).setIcon("calendar").onClick(() => targetDialog(ctx, q, s)));
  if (s.target) {
    m.addItem((i) =>
      i.setTitle(t("stage.clearTarget")).setIcon("calendar-x").onClick(() => {
        keepFocus(ctx, q, s.index);
        act(() => store.setStageTarget(q, s, null))();
      }),
    );
  }
  if (s.index > 0 || s.index < last) m.addSeparator();
  if (s.index > 0) {
    m.addItem((i) =>
      i.setTitle(t("stage.moveUp")).setIcon("arrow-up").onClick(() => {
        keepFocus(ctx, q, s.index - 1);
        act(() => store.moveStage(q, s, -1))();
      }),
    );
  }
  if (s.index < last) {
    m.addItem((i) =>
      i.setTitle(t("stage.moveDown")).setIcon("arrow-down").onClick(() => {
        keepFocus(ctx, q, s.index + 1);
        act(() => store.moveStage(q, s, 1))();
      }),
    );
  }
  m.addSeparator();
  if (s.reached) {
    m.addItem((i) =>
      i.setTitle(t("stage.reopen")).setIcon("rotate-ccw").onClick(() => {
        keepFocus(ctx, q, s.index);
        act(() => store.reopenStage(q, s))();
      }),
    );
  } else {
    m.addItem((i) => i.setTitle(t("stage.reach")).setIcon("check-circle-2").onClick(() => reachDialog(ctx, q, s)));
  }
  m.addSeparator();
  m.addItem((i) =>
    i.setTitle(t("stage.delete")).setIcon("trash-2").onClick(() => {
      keepFocus(ctx, q, "add");
      new ConfirmModal(plugin.app, t("stage.deleteConfirm", { name: stageLabel(s) }), act(() => store.deleteStage(q, s))).open();
    }),
  );
  return m;
}

/**
 * The soft compass under the current stage: days left and, with enough done tasks, whether the pace fits.
 * Only for an active quest with a 📅 on its current stage. Muted, never a warning colour.
 */
export function compassLine(parent: HTMLElement, ctx: Ctx, q: Quest, s: Stage, opts: { actions?: boolean } = {}): HTMLElement | null {
  if (q.status !== "active" || s.reached || !s.target || currentStage(q.stages)?.index !== s.index) return null;
  const open = q.tasks.filter((x) => !x.done && x.stageIndex === s.index).length;
  const doneDates = q.tasks.filter((x) => x.done && x.doneDate && x.stageIndex === s.index).map((x) => x.doneDate!);
  const c = compass({ today: ctx.today, target: s.target, started: s.started, openTasks: open, doneDates });
  if (!c) return null;
  const el = parent.createDiv({ cls: "ql-compass" });
  setIcon(el.createSpan({ cls: "ql-compass-icon" }), "compass");
  if (c.kind === "passed") {
    el.createSpan({ cls: "ql-compass-text", text: t("compass.passed") });
    if (opts.actions !== false) {
      const acts = el.createDiv({ cls: "ql-compass-actions" });
      button(acts, t("compass.newDate"), () => targetDialog(ctx, q, s), { cls: "ql-btn-plain" });
      button(acts, t("compass.close"), () => reachDialog(ctx, q, s), { cls: "ql-btn-plain" });
    }
    return el;
  }
  const left = c.daysLeft === 0 ? t("compass.today") : c.daysLeft === 1 ? t("compass.leftOne") : t("compass.left", { n: c.daysLeft });
  const text = c.pace ? `${left} · ${t(c.pace === "fits" ? "compass.fits" : "compass.tight")}` : left;
  el.createSpan({ cls: "ql-compass-text", text });
  if (c.pace) {
    const tip = t("compass.tip", { done: c.done, days: c.winDays, open, left: left.charAt(0).toLocaleLowerCase() + left.slice(1) });
    el.setAttr("aria-label", tip);
    setTooltip(el, tip);
  }
  return el;
}

/** The stage section of a quest page. Call only when the quest has stages. */
export function renderStagePath(parent: HTMLElement, ctx: Ctx, q: Quest, sessions: Session[]): void {
  const { state, store, today } = ctx;
  const hours = stageMinutes(q.stages, q.tasks, sessions);
  const cur = currentStage(q.stages);
  const card = parent.createDiv({ cls: "ql-card ql-section ql-stages" });
  const reachedN = q.stages.filter((s) => s.reached).length;
  sectionHead(card, t("stage.title"), "milestone", `${reachedN}/${q.stages.length}`);

  // The path: one node per stage, in note order.
  const path = card.createEl("ol", { cls: "ql-path", attr: { "aria-label": t("stage.title"), "data-scroll-key": `path:${q.path}` } });
  for (const s of q.stages) {
    const st = stateOf(q, s);
    const node = path.createEl("li", { cls: `ql-stage-node is-${st}` });
    const mark = node.createSpan({ cls: "ql-stage-dot", attr: { "aria-hidden": "true" } });
    if (st === "reached") setIcon(mark, "check");
    node.createSpan({ cls: "ql-sr-only", text: `${t(`stage.${st}`)}: ` });
    node.createSpan({ cls: "ql-stage-node-name", text: stageLabel(s) });
    const dates = stageDates(s, st);
    if (dates) node.createSpan({ cls: "ql-stage-node-date", text: dates });
  }
  if (!cur) card.createDiv({ cls: "ql-stage-all", text: t("stage.allReached") });

  // Stage blocks: the current one open, the others folded.
  const blocks = card.createDiv({ cls: "ql-stage-list" });
  for (const s of q.stages) {
    const st = stateOf(q, s);
    const key = `stage:${q.path}:${s.index}`;
    const isOpen = st === "current" || state.expanded.has(key);
    const tasks = q.tasks.filter((x) => x.stageIndex === s.index);
    const open = tasks.filter((x) => !x.done);
    const done = tasks.filter((x) => x.done);
    const min = hours.byStage.get(s.index) ?? 0;

    const block = blocks.createDiv({ cls: `ql-stage is-${st}` + (isOpen ? " is-open" : "") });
    const head = block.createDiv({ cls: "ql-stage-head" });
    const toggle = head.createEl(st === "current" ? "div" : "button", {
      cls: "ql-stage-toggle",
      attr: { "data-stage-focus": `${q.path}:${s.index}` },
    });
    if (st === "current") toggle.setAttr("tabindex", "-1");
    else toggle.setAttr("aria-expanded", String(isOpen));
    setIcon(toggle.createSpan({ cls: "ql-stage-icon" }), st === "reached" ? "check-circle-2" : st === "current" ? "milestone" : isOpen ? "chevron-down" : "chevron-right");
    const titles = toggle.createDiv({ cls: "ql-stage-titles" });
    const name = titles.createDiv({ cls: "ql-stage-name" });
    name.createSpan({ text: stageLabel(s) });
    if (st === "current") name.createSpan({ cls: "ql-stage-tag", text: t("stage.current") });
    const meta: string[] = [];
    const dates = stageDates(s, st);
    if (dates) meta.push(dates);
    if (st === "reached") meta.push(t("stage.doneCount", { done: done.length, all: tasks.length }));
    else if (open.length) meta.push(t("stage.openCount", { n: open.length }));
    if (min > 0) meta.push(fmtHours(min));
    if (meta.length) titles.createDiv({ cls: "ql-stage-meta", text: meta.join(" · ") });
    if (st !== "current") {
      toggle.onclick = () => {
        if (isOpen) state.expanded.delete(key);
        else state.expanded.add(key);
        keepFocus(ctx, q, s.index);
        ctx.rerender();
      };
    }
    const more = iconButton(head, "more-horizontal", t("stage.menu", { name: stageLabel(s) }), () => undefined, "ql-stage-more");
    more.onclick = (e) => {
      e.stopPropagation();
      const menu = stageMenu(ctx, q, s);
      // Keyboard clicks have no position: open the menu under the button.
      if (e.detail === 0) {
        const r = more.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.bottom }, more.doc);
      } else menu.showAtMouseEvent(e);
    };

    if (!isOpen) continue;
    const body = block.createDiv({ cls: "ql-stage-body" });
    if (st === "current") {
      compassLine(body, ctx, q, s);
      const list = body.createDiv({ cls: "ql-list" });
      for (const x of open) {
        const day = store.scheduledDay(x, today);
        taskRow(list, ctx, x, { hint: day ? dayHint(day, today) : undefined });
      }
      if (!open.length) empty(list, t("stage.noTasks"), "list-checks");
      if (q.status !== "done") addTaskField(body, ctx, { quest: q, day: null, stateKey: `stage-${q.path}-${s.index}`, placeholder: t("stage.addTask") });
      if (done.length) body.createDiv({ cls: "ql-stage-foot", text: t("stage.doneCount", { done: done.length, all: tasks.length }) });
    } else {
      const list = body.createDiv({ cls: "ql-list" });
      for (const x of open) taskRow(list, ctx, x, { compact: st === "reached" });
      for (const x of done) taskRow(list, ctx, x, { compact: true });
      if (!tasks.length) empty(list, t("stage.noTasks"), "list-checks");
    }
  }

  if (hours.outside > 0) {
    const o = card.createDiv({ cls: "ql-stage-outside" });
    o.createSpan({ text: t("stage.outside") });
    o.createSpan({ cls: "ql-mono", text: fmtHours(hours.outside) });
  }
  const add = button(card, t("stage.add"), () => addStageDialog(ctx, q), { icon: "plus", cls: "ql-btn-plain ql-stage-add" });
  add.dataset.stageFocus = `${q.path}:add`;
  restoreFocus(ctx, card);
}
