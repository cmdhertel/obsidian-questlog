import { Menu, Notice, setIcon, setTooltip } from "obsidian";
import type { Quest, Task } from "../data/model";
import { addDays, fmtDuration, parseDay } from "../data/dates";
import type { ContinueTarget } from "../data/lastwork";
import type { Position } from "../data/plan";
import { t } from "../i18n";
import type { Ctx } from "./ctx";
import { workTitle } from "../data/timerlog";
import { ConfirmModal, TextModal } from "./modals";

const DRAG_TYPE = "application/x-questlog-task";

/** Run an async action and surface errors as a notice instead of failing silently. */
export function act(fn: () => Promise<unknown>): () => void {
  return () => {
    fn().catch((e: unknown) => {
      console.error("Questlog:", e);
      new Notice(e instanceof Error ? e.message : String(e));
    });
  };
}

export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `ql-icon-btn clickable-icon ${cls}`.trim(), attr: { "aria-label": label } });
  setIcon(b, icon);
  setTooltip(b, label);
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

export interface PlayOpts {
  /** Text button ("Start" / "Pause") instead of an icon button. */
  text?: boolean;
  /** Pause instead of play; defaults to "the timer runs exactly this target". */
  running?: boolean;
  cls?: string;
}

/** Name of the work a target stands for, used in the button's label. */
function targetName(target: ContinueTarget): string {
  return target.kind === "task" ? target.task.text : target.kind === "quest" ? questName(target.quest) : "";
}

/**
 * Play or pause for a piece of work, by the live timer state. Play starts the target, pause stops
 * and logs. Returns null for kind "none" (nothing to start). Views re-render on every timer change,
 * so the icon never goes stale.
 */
export function playButton(parent: HTMLElement, ctx: Ctx, target: ContinueTarget, opts: PlayOpts = {}): HTMLButtonElement | null {
  if (target.kind === "none") return null;
  const timer = ctx.plugin.timer;
  const running = opts.running ?? timer.isRunningTarget(target);
  const work = targetName(target);
  const label = t(running ? "timer.pauseWork" : "timer.startWork", { work });
  const run = act(() => (running ? timer.stop() : timer.startTarget(target)));
  const cls = `ql-play${running ? " is-live" : ""} ${opts.cls ?? ""}`.trim();
  let b: HTMLButtonElement;
  if (opts.text) {
    b = button(parent, t(running ? "timer.pause" : "timer.start"), run, { icon: running ? "pause" : "play", cls });
    setTooltip(b, label);
  } else {
    b = iconButton(parent, running ? "pause" : "play", label, run, cls);
  }
  b.setAttr("aria-label", label);
  // Enter/Space on the button must not reach a parent that is itself a keyboard button (quest card).
  b.onkeydown = (e) => e.stopPropagation();
  return b;
}

export function button(parent: HTMLElement, text: string, onClick: () => void, opts: { icon?: string; cta?: boolean; cls?: string } = {}): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `ql-btn ${opts.cta ? "mod-cta" : ""} ${opts.cls ?? ""}`.trim() });
  if (opts.icon) setIcon(b.createSpan({ cls: "ql-btn-icon" }), opts.icon);
  if (text) b.createSpan({ text });
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

export function pill(parent: HTMLElement, text: string, opts: { icon?: string; cls?: string; title?: string; color?: string } = {}): HTMLElement {
  const p = parent.createDiv({ cls: `ql-pill ${opts.cls ?? ""}`.trim() });
  if (opts.color) p.style.setProperty("--ql-color", opts.color);
  if (opts.icon) setIcon(p.createSpan({ cls: "ql-pill-icon" }), opts.icon);
  p.createSpan({ text });
  if (opts.title) setTooltip(p, opts.title);
  return p;
}

/** Display name of a quest; the Other inbox is translated. */
export function questName(q: Quest | undefined, fallback = ""): string {
  if (!q) return fallback;
  return q.kind === "other" ? t("other.name") : q.name;
}

/** Name pill of a quest, in its color. */
export function questPill(parent: HTMLElement, q: Quest, cls = ""): HTMLElement {
  return pill(parent, questName(q), { icon: q.icon, color: q.color, cls: `ql-quest-pill ${cls}`.trim() });
}

/** Round icon badge of a quest. */
export function questIcon(parent: HTMLElement, q: Quest, cls = ""): HTMLElement {
  const i = parent.createSpan({ cls: `ql-quest-icon ${cls}`.trim() });
  i.style.setProperty("--ql-color", q.color);
  setIcon(i, q.icon);
  return i;
}

export function dot(parent: HTMLElement, color: string): HTMLElement {
  const d = parent.createSpan({ cls: "ql-dot" });
  d.style.setProperty("--ql-color", color);
  return d;
}

export function bar(parent: HTMLElement, value: number, max: number, color: string): HTMLElement {
  const b = parent.createDiv({ cls: "ql-bar" });
  const f = b.createDiv({ cls: "ql-bar-fill" });
  f.style.setProperty("--ql-color", color);
  f.style.width = `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`;
  if (max > 0 && value >= max) b.addClass("is-full");
  return b;
}

export function sectionHead(parent: HTMLElement, title: string, icon?: string, meta?: string): HTMLElement {
  const h = parent.createDiv({ cls: "ql-section-head" });
  if (icon) setIcon(h.createSpan({ cls: "ql-section-icon" }), icon);
  h.createSpan({ cls: "ql-section-title", text: title });
  if (meta) h.createSpan({ cls: "ql-section-meta", text: meta });
  return h.createDiv({ cls: "ql-section-actions" });
}

export function empty(parent: HTMLElement, text: string, icon = "sparkles"): HTMLElement {
  const e = parent.createDiv({ cls: "ql-empty" });
  setIcon(e.createSpan({ cls: "ql-empty-icon" }), icon);
  e.createSpan({ text });
  return e;
}

/** Big page title with an optional line of stats on the right. */
export function pageHead(parent: HTMLElement, title: string, sub?: string): HTMLElement {
  const h = parent.createDiv({ cls: "ql-page-head" });
  const titles = h.createDiv({ cls: "ql-page-titles" });
  titles.createEl("h2", { cls: "ql-page-title", text: title });
  if (sub) titles.createDiv({ cls: "ql-page-sub", text: sub });
  return h.createDiv({ cls: "ql-page-actions" });
}

/** A stat card: label, big value, optional small text and progress bar. */
export function statCard(
  parent: HTMLElement,
  label: string,
  value: string,
  opts: { sub?: string; icon?: string; progress?: [number, number]; color?: string } = {},
): HTMLElement {
  const c = parent.createDiv({ cls: "ql-stat" });
  const head = c.createDiv({ cls: "ql-stat-label" });
  if (opts.icon) setIcon(head.createSpan({ cls: "ql-stat-icon" }), opts.icon);
  head.createSpan({ text: label });
  const v = c.createDiv({ cls: "ql-stat-value ql-mono" });
  v.createSpan({ text: value });
  if (opts.sub) v.createSpan({ cls: "ql-stat-sub", text: opts.sub });
  if (opts.progress) bar(c, opts.progress[0], opts.progress[1], opts.color ?? "var(--interactive-accent)");
  return c;
}

/** Segmented control (two or three options). */
export function segmented<T extends string>(
  parent: HTMLElement,
  options: { id: T; label: string; count?: number }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const s = parent.createDiv({ cls: "ql-seg", attr: { role: "tablist" } });
  for (const o of options) {
    const b = s.createEl("button", { cls: "ql-seg-btn" + (o.id === value ? " is-active" : ""), attr: { role: "tab", "aria-selected": String(o.id === value) } });
    b.createSpan({ text: o.label });
    if (o.count !== undefined) b.createSpan({ cls: "ql-seg-count", text: String(o.count) });
    b.onclick = () => onChange(o.id);
  }
  return s;
}

export function timeOf(ctx: Ctx, task: Task): number {
  const q = ctx.store.questOf(task);
  return (task.id ? ctx.taskMinutes.get(task.id) : undefined) ?? ctx.taskMinutes.get(`${q?.name}::${task.text}`) ?? 0;
}

/** A live clock element, updated every second by the plugin. */
export function liveClock(parent: HTMLElement, start: number, box = 0, cls = ""): HTMLElement {
  return parent.createSpan({ cls: `ql-elapsed ql-mono ${cls}`.trim(), attr: { "data-start": String(start), "data-box": String(box) } });
}

/** Live timer strip shown on every tab except Focus. */
export function timerBar(parent: HTMLElement, ctx: Ctx): void {
  const c = ctx.plugin.settings.timer;
  if (!c) return;
  const q = ctx.store.quest(c.quest);
  const el = parent.createDiv({ cls: "ql-timerbar" });
  el.style.setProperty("--ql-color", q?.color ?? "var(--interactive-accent)");
  el.createSpan({ cls: "ql-live-dot" });
  liveClock(el, c.start, c.box ?? 0);
  const txt = el.createDiv({ cls: "ql-timerbar-text" });
  const qname = questName(q, c.quest);
  const title = workTitle(c.taskText, qname);
  txt.createSpan({ cls: "ql-timerbar-task", text: title });
  // A quest-only run already shows the quest as its title.
  if (title !== qname) txt.createSpan({ cls: "ql-muted", text: ` · ${qname}` });
  el.onclick = () => ctx.view.showTab("focus");
  iconButton(el, "pause", t("timer.pause"), act(() => ctx.plugin.timer.stop()));
  if (c.taskId) iconButton(el, "check", t("task.complete"), act(() => ctx.plugin.completeCurrent()));
}

// ---------------------------------------------------------------- tasks

export interface TaskRowOpts {
  showQuest?: boolean;
  /** The day list this row lives in (null = backlog); enables dragging. */
  day?: string | null;
  compact?: boolean;
  /** Extra note shown after the text (e.g. "carried over"). */
  hint?: string;
}

/** Key that finds a task even before it has an id. */
export function taskKey(task: Task): string {
  return task.id || `${task.questPath}#${task.line}`;
}

function findTask(ctx: Ctx, key: string): Task | undefined {
  return ctx.store.allTasks().find((x) => taskKey(x) === key);
}

/** One task line: checkbox, text, quest, invested time, start/stop and a menu. */
export function taskRow(parent: HTMLElement, ctx: Ctx, task: Task, opts: TaskRowOpts = {}): HTMLElement {
  const { store, plugin } = ctx;
  const quest = store.questOf(task);
  const running = plugin.timer.isRunningFor(task);
  const row = parent.createDiv({
    cls: "ql-task" + (task.done ? " is-done" : "") + (running ? " is-running" : "") + (opts.compact ? " is-compact" : ""),
    attr: { "data-key": taskKey(task) },
  });
  if (quest) row.style.setProperty("--ql-color", quest.color);

  const cb = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox ql-check" });
  cb.checked = task.done;
  cb.setAttr("aria-label", task.done ? t("task.reopen") : t("task.complete"));
  cb.onclick = (e) => e.stopPropagation();
  cb.onchange = act(async () => {
    if (cb.checked) await plugin.complete(task);
    else await store.setDone(task, false);
  });

  const main = row.createDiv({ cls: "ql-task-main" });
  main.createSpan({ cls: "ql-task-text", text: task.text });
  if ((opts.showQuest && quest) || opts.hint) {
    const meta = main.createDiv({ cls: "ql-task-meta" });
    if (opts.showQuest && quest) {
      const qs = meta.createSpan({ cls: "ql-task-quest" });
      dot(qs, quest.color);
      qs.createSpan({ text: questName(quest) });
    }
    if (opts.hint) meta.createSpan({ cls: "ql-task-hint", text: opts.hint });
  }

  const min = timeOf(ctx, task);
  if (running) {
    const c = plugin.settings.timer!;
    liveClock(row, c.start, c.box ?? 0, "ql-chip ql-chip-live");
  } else if (min > 0) {
    row.createSpan({ cls: "ql-chip ql-mono", text: fmtDuration(min) });
  }

  const actions = row.createDiv({ cls: "ql-task-actions" });
  if (!task.done && quest && (running || store.isWorkable(quest))) {
    playButton(actions, ctx, { kind: "task", task, quest }, { cls: "ql-task-play" });
  }
  iconButton(actions, "more-horizontal", t("task.more"), () => {}).onclick = (e) => {
    e.stopPropagation();
    taskMenu(ctx, task, quest).showAtMouseEvent(e);
  };
  row.oncontextmenu = (e) => {
    e.preventDefault();
    taskMenu(ctx, task, quest).showAtMouseEvent(e);
  };

  if (opts.day !== undefined && !task.done) {
    row.draggable = true;
    row.addClass("is-draggable");
    row.ondragstart = (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, taskKey(task));
      e.dataTransfer?.setData("text/plain", task.text);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      window.setTimeout(() => row.addClass("is-dragging"), 0);
    };
    row.ondragend = () => row.removeClass("is-dragging");
  }
  return row;
}

/** Days offered in the "Move to" menu: today and the next six days. */
function moveTargets(today: string): { day: string; label: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    const label = i === 0 ? t("nav.today") : i === 1 ? t("nav.tomorrow") : t(`wd.long.${parseDay(day).getDay()}` as "wd.long.0");
    return { day, label };
  });
}

function taskMenu(ctx: Ctx, task: Task, quest: Quest | undefined): Menu {
  const { store, plugin } = ctx;
  const m = new Menu();
  const today = ctx.today;
  if (!task.done) {
    if (quest && store.isWorkable(quest)) m.addItem((i) =>
      i.setTitle(t("focus.now")).setIcon("crosshair").onClick(act(async () => {
        await store.moveToDay(task, today, "top");
        await plugin.timer.start(task);
        ctx.view.showTab("focus");
      })),
    );
    if (quest && store.isWorkable(quest)) m.addSeparator();
    const current = store.scheduledDay(task, today);
    for (const { day, label } of moveTargets(today)) {
      m.addItem((i) =>
        i.setTitle(label).setIcon(day === today ? "sun" : "calendar").setChecked(current === day).onClick(act(() => store.moveToDay(task, day))),
      );
    }
    m.addItem((i) => i.setTitle(t("plan.toBacklog")).setIcon("archive").setChecked(current === null).onClick(act(() => store.moveToDay(task, null))));
    m.addSeparator();
  }
  m.addItem((i) =>
    i.setTitle(t("task.rename")).setIcon("pencil").onClick(() =>
      new TextModal(plugin.app, t("task.rename"), task.text, (v) => act(() => store.renameTask(task, v))()).open(),
    ),
  );
  if (quest) {
    m.addItem((i) =>
      i.setTitle(t("task.openNote")).setIcon("file-text").onClick(() => {
        void plugin.app.workspace.openLinkText(quest.path, "", false, { eState: { line: task.line } });
      }),
    );
  }
  m.addSeparator();
  m.addItem((i) =>
    i.setTitle(t("task.delete")).setIcon("trash-2").setWarning(true).onClick(() =>
      new ConfirmModal(plugin.app, t("task.deleteConfirm", { task: task.text }), act(() => store.deleteTask(task))).open(),
    ),
  );
  return m;
}

/**
 * Make a list a drop target for task rows. `day` null = backlog.
 * Dropping on a row places the task before it; elsewhere it goes to the bottom.
 */
export function dropTarget(list: HTMLElement, ctx: Ctx, day: string | null): void {
  const clear = () => {
    list.removeClass("is-drop");
    list.querySelectorAll(".is-drop-before").forEach((el) => el.removeClass("is-drop-before"));
  };
  const rowAt = (e: DragEvent): HTMLElement | null => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".ql-task[data-key]:not(.is-done):not(.is-dragging)"));
    return rows.find((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    }) ?? null;
  };
  list.ondragover = (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clear();
    list.addClass("is-drop");
    rowAt(e)?.addClass("is-drop-before");
  };
  list.ondragleave = (e) => {
    if (!list.contains(e.relatedTarget as Node | null)) clear();
  };
  list.ondrop = (e) => {
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    const before = rowAt(e)?.dataset.key;
    clear();
    if (!key) return;
    e.preventDefault();
    const task = findTask(ctx, key);
    if (!task) return;
    let pos: Position = "bottom";
    if (day !== null && before && before !== key) {
      const ids = ctx.store.dayTasks(day, ctx.today).filter((x) => x !== task).map(taskKey);
      const i = ids.indexOf(before);
      if (i >= 0) pos = i;
    }
    act(() => ctx.store.moveToDay(task, day, pos))();
  };
}

export interface AddFieldOpts {
  /** Fixed quest; otherwise a selector over `quests`. */
  quest?: Quest;
  quests?: Quest[];
  /** Preselected quest in the selector. */
  defaultQuest?: Quest;
  /** Schedule the new task on this day (null = backlog). */
  day: string | null;
  /** Show "add to top / bottom" buttons. */
  positions?: boolean;
  placeholder?: string;
  /** Remember the selected quest across renders under this key. */
  stateKey?: string;
}

/** Inline "add task" field. */
export function addTaskField(parent: HTMLElement, ctx: Ctx, opts: AddFieldOpts): HTMLElement {
  const wrap = parent.createDiv({ cls: "ql-add" });
  let select: HTMLSelectElement | null = null;
  const quests = opts.quests ?? [];
  if (!opts.quest && quests.length > 1) {
    select = wrap.createEl("select", { cls: "dropdown ql-add-quest", attr: { "aria-label": t("session.quest") } });
    for (const q of quests) select.createEl("option", { value: q.path, text: questName(q) });
    const remembered = opts.stateKey ? ctx.state.drafts.get(`quest|${opts.stateKey}`) : undefined;
    select.value = remembered && quests.some((q) => q.path === remembered) ? remembered : (opts.defaultQuest ?? quests[0]!).path;
    select.onchange = () => {
      if (opts.stateKey && select) ctx.state.drafts.set(`quest|${opts.stateKey}`, select.value);
    };
  }
  const input = wrap.createEl("input", {
    type: "text",
    cls: "ql-add-input",
    attr: {
      placeholder: opts.placeholder ?? t("task.addPlaceholder"),
      enterkeyhint: "done",
      // lets the view keep focus and typed text in this field across re-renders
      "data-add-key": opts.stateKey ?? `${opts.day ?? "backlog"}|${opts.quest?.path ?? ""}`,
    },
  });
  const submit = (pos: Position) =>
    act(async () => {
      const text = input.value.trim();
      const q = opts.quest ?? quests.find((x) => x.path === select?.value) ?? opts.defaultQuest ?? quests[0];
      if (!text || !q) return;
      input.value = "";
      await ctx.store.addTaskTo(q, text, opts.day, pos);
      ctx.rerender();
    });
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit(e.shiftKey ? "top" : "bottom")();
    }
  };
  if (opts.positions) {
    iconButton(wrap, "arrow-up-to-line", t("task.addTop"), () => submit("top")());
    iconButton(wrap, "arrow-down-to-line", t("task.addBottom"), () => submit("bottom")());
  } else {
    iconButton(wrap, "plus", t("task.add"), () => submit("bottom")());
  }
  return wrap;
}
