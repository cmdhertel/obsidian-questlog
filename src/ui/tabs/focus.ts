// Focus: one task on screen, a big clock with an optional time box, a session note, and what comes next.
import { setIcon } from "obsidian";
import { fmtDuration, fmtHours } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import type { Task } from "../../data/model";
import { TIME_BOXES } from "../../settings";
import { t } from "../../i18n";
import type { Ctx } from "../ctx";
import { TaskSuggestModal } from "../modals";
import { act, button, empty, iconButton, liveClock, questIcon, questName, taskKey, timeOf } from "../components";

export function renderFocus(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, state, today } = ctx;
  const running = plugin.settings.timer;
  const queue = store.dayTasks(today, today);
  const chosen = state.focusTask ? store.allTasks().find((x) => taskKey(x) === state.focusTask && !x.done) : undefined;
  const task: Task | undefined = running ? store.task(running.taskId) : chosen ?? queue[0];

  if (state.zen) {
    if (task || running) return renderZen(el, ctx, task);
    ctx.view.setZen(false);
    return;
  }

  const stage = el.createDiv({ cls: "ql-card ql-focus" + (running ? " is-running" : "") });

  if (!task && !running) {
    empty(stage, store.doneOn(today).length ? t("focus.allDone") : t("focus.nothing"), "target");
    const row = stage.createDiv({ cls: "ql-focus-actions" });
    button(row, t("focus.pick"), () => new TaskSuggestModal(plugin, (x) => pick(ctx, x)).open(), { icon: "search", cta: true });
    button(row, t("tab.plan"), () => ctx.view.showTab("plan"), { icon: "list-checks" });
    footer(el, ctx);
    return;
  }

  const quest = task ? store.questOf(task) : store.quest(running?.quest ?? "");
  stage.style.setProperty("--ql-color", quest?.color ?? "var(--interactive-accent)");

  iconButton(stage, "maximize-2", t("focus.zen"), () => ctx.view.setZen(true), "ql-focus-zen-btn");

  const qrow = stage.createDiv({ cls: "ql-focus-quest" });
  if (quest) questIcon(qrow, quest, "is-small");
  qrow.createSpan({ text: questName(quest, running?.quest ?? "") });
  if (quest?.why) stage.createDiv({ cls: "ql-focus-why", text: quest.why });
  stage.createDiv({ cls: "ql-focus-task", text: task?.text ?? running?.taskText ?? "" });

  // Clock: live while running (counts down within a box), otherwise the box length or 00:00.
  const box = running ? running.box ?? 0 : state.focusBox;
  if (running) liveClock(stage, running.start, box, "ql-focus-clock");
  else stage.createDiv({ cls: "ql-focus-clock ql-mono is-idle", text: box ? `${String(box).padStart(2, "0")}:00` : "00:00" });
  stage.createDiv({ cls: "ql-focus-state", text: running ? (box ? t("focus.boxRunning", { n: box }) : t("focus.running")) : t("focus.paused") });

  // Time box chips
  const chips = stage.createDiv({ cls: "ql-chips", attr: { role: "radiogroup", "aria-label": t("set.box") } });
  for (const b of TIME_BOXES) {
    const c = chips.createEl("button", {
      cls: "ql-chip-btn" + (b === box ? " is-active" : ""),
      text: b ? t("focus.boxMin", { n: b }) : t("focus.boxFree"),
      attr: { role: "radio", "aria-checked": String(b === box) },
    });
    c.onclick = act(async () => {
      state.focusBox = b;
      if (running) await plugin.timer.setBox(b);
      else ctx.rerender();
    });
  }

  if (task) {
    const invested = timeOf(ctx, task);
    if (invested > 0) stage.createDiv({ cls: "ql-focus-invested", text: t("focus.invested", { time: fmtDuration(invested) }) });
  }

  // Actions
  const actions = stage.createDiv({ cls: "ql-focus-actions" });
  if (running) button(actions, t("timer.pause"), act(() => plugin.timer.stop()), { icon: "pause" });
  else if (task) {
    button(actions, t("timer.start"), act(async () => {
      await plugin.timer.start(task, { box: state.focusBox, note: state.focusNote });
      state.focusNote = "";
    }), { icon: "play", cta: true });
  }
  if (task) {
    button(actions, t("task.complete"), act(async () => {
      state.focusTask = null;
      await plugin.complete(task);
    }), { icon: "check", cls: "ql-btn-done" });
  }
  const more = stage.createDiv({ cls: "ql-focus-more" });
  if (task && !running) {
    button(more, t("focus.skip"), act(async () => {
      state.focusTask = null;
      await store.moveToDay(task, today, "bottom");
    }), { icon: "skip-forward" });
  }
  button(more, t("focus.pick"), () => new TaskSuggestModal(plugin, (x) => pick(ctx, x)).open(), { icon: "search" });
  if (running) button(more, t("timer.discardShort"), act(() => plugin.timer.discard()), { icon: "trash-2" });

  // Session note
  const note = stage.createEl("textarea", {
    cls: "ql-focus-note",
    attr: { rows: "2", placeholder: t("focus.notePh"), "aria-label": t("focus.note") },
  });
  note.value = running ? running.note ?? "" : state.focusNote;
  let pending = 0;
  note.oninput = () => {
    if (!running) {
      state.focusNote = note.value;
      return;
    }
    window.clearTimeout(pending);
    pending = window.setTimeout(() => void plugin.timer.setNote(note.value), 400);
  };
  note.onblur = () => {
    if (running) {
      window.clearTimeout(pending);
      void plugin.timer.setNote(note.value);
    }
  };

  // Up next
  const rest = queue.filter((x) => x !== task);
  if (rest.length) {
    const next = el.createDiv({ cls: "ql-card ql-section ql-focus-next" });
    const h = next.createDiv({ cls: "ql-section-head" });
    setIcon(h.createSpan({ cls: "ql-section-icon" }), "layers");
    h.createSpan({ cls: "ql-section-title", text: t("focus.upNext") });
    h.createSpan({ cls: "ql-section-meta", text: t("focus.rest", { n: rest.length }) });
    for (const x of rest.slice(0, 3)) {
      const r = next.createDiv({ cls: "ql-next-row", attr: { role: "button", tabindex: "0" } });
      const q = store.questOf(x);
      if (q) r.style.setProperty("--ql-color", q.color);
      r.createSpan({ cls: "ql-dot" });
      r.createSpan({ cls: "ql-next-text", text: x.text });
      r.createSpan({ cls: "ql-muted ql-small", text: questName(q) });
      r.onclick = () => pick(ctx, x);
    }
  }

  footer(el, ctx);
}

/** Zen mode: only the task and the clock, plus a quiet row of controls. */
function renderZen(el: HTMLElement, ctx: Ctx, task: Task | undefined): void {
  const { store, plugin, state } = ctx;
  const running = plugin.settings.timer;
  const quest = task ? store.questOf(task) : store.quest(running?.quest ?? "");
  const zen = el.createDiv({ cls: "ql-zen" + (running ? " is-running" : "") });
  zen.style.setProperty("--ql-color", quest?.color ?? "var(--interactive-accent)");

  zen.createDiv({ cls: "ql-zen-task", text: task?.text ?? running?.taskText ?? "" });
  const box = running ? running.box ?? 0 : state.focusBox;
  if (running) liveClock(zen, running.start, box, "ql-focus-clock ql-zen-clock");
  else zen.createDiv({ cls: "ql-focus-clock ql-zen-clock ql-mono is-idle", text: box ? `${String(box).padStart(2, "0")}:00` : "00:00" });

  const row = zen.createDiv({ cls: "ql-zen-controls" });
  if (running) iconButton(row, "pause", t("timer.pause"), act(() => plugin.timer.stop()));
  else if (task) {
    iconButton(row, "play", t("timer.start"), act(async () => {
      await plugin.timer.start(task, { box: state.focusBox, note: state.focusNote });
      state.focusNote = "";
    }));
  }
  if (task) {
    iconButton(row, "check", t("task.complete"), act(async () => {
      state.focusTask = null;
      await plugin.complete(task);
    }));
  }
  iconButton(row, "minimize-2", t("focus.zenExit"), () => ctx.view.setZen(false));
}

/** Choose a task for Focus. While a timer runs, switch the timer to it. */
function pick(ctx: Ctx, task: Task): void {
  ctx.state.focusTask = taskKey(task);
  if (ctx.plugin.settings.timer) act(() => ctx.plugin.timer.start(task, { box: ctx.state.focusBox }))();
  else ctx.rerender();
}

function footer(el: HTMLElement, ctx: Ctx): void {
  const { store, today } = ctx;
  const f = el.createDiv({ cls: "ql-focus-footer" });
  f.createSpan({ text: t("focus.today", { time: fmtHours(totalMinutes(store.sessions([today]))) }) });
  f.createSpan({ text: " · " });
  f.createSpan({ text: t("home.doneCount", { n: store.doneOn(today).length }) });
}
