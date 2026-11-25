import { Notice, Plugin, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import type { Task } from "./data/model";
import type { StartOpts } from "./timer";
import { QuestStore } from "./data/store";
import { fmtElapsed, isoDay } from "./data/dates";
import { DEFAULT_SETTINGS, QuestlogSettingTab, mergeSettings, type QuestlogSettings, type TabId } from "./settings";
import { Timer } from "./timer";
import { workTitle } from "./data/timerlog";
import { act, questName } from "./ui/components";
import { QuestlogView, VIEW_TYPE } from "./ui/view";
import { StartBox, continueTitle } from "./ui/startbox";
import { t } from "./i18n";

export default class QuestlogPlugin extends Plugin {
  settings: QuestlogSettings = { ...DEFAULT_SETTINGS };
  store!: QuestStore;
  timer!: Timer;
  private statusEl: HTMLElement | null = null;
  /** What the status bar item currently shows, so tick() only touches the DOM when that changes. */
  private statusKey = "";

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new QuestStore(this.app, () => this.settings, () => this.saveSettings());
    this.timer = new Timer(this);

    this.registerView(VIEW_TYPE, (leaf) => new QuestlogView(leaf, this));
    this.addSettingTab(new QuestlogSettingTab(this.app, this));
    this.addRibbonIcon("target", "Questlog", () => void this.openView());
    this.addRibbonIcon("play", t("cmd.continueLast"), act(() => this.continueLast()));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ql-statusbar");
    this.registerDomEvent(this.statusEl, "click", () => this.onStatusActivate());
    this.registerDomEvent(this.statusEl, "keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && this.statusEl?.getAttr("role") === "button") {
        e.preventDefault();
        this.onStatusActivate();
      }
    });
    this.registerInterval(window.setInterval(() => this.tick(), 1000));

    this.registerCommands();

    this.app.workspace.onLayoutReady(async () => {
      for (const ref of this.store.watch()) this.registerEvent(ref);
      this.registerEvent(this.store.on("changed", () => this.refreshViews()));
      await this.store.reload();
    });
  }

  onunload(): void {
    // Leaves are detached by Obsidian; a running timer stays in data.json and resumes on next load.
  }

  private registerCommands(): void {
    const tabs: TabId[] = ["home", "plan", "calendar", "focus", "quests", "review"];
    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => void this.openView() });
    for (const tab of tabs) {
      this.addCommand({
        id: `open-${tab}`,
        name: t("cmd.openTab", { tab: t(`tab.${tab}` as "tab.home") }),
        callback: () => void this.openView(tab),
      });
    }
    this.addCommand({
      id: "toggle-timer",
      name: t("cmd.toggleTimer"),
      callback: act(async () => {
        if (this.timer.current) await this.timer.stop();
        else {
          const next = this.store.dayTasks(this.today())[0];
          if (next) await this.timer.start(next);
          else await this.continueLast();
        }
      }),
    });
    this.addCommand({ id: "quick-start", name: t("cmd.quickStart"), callback: () => new StartBox(this, "start").open() });
    this.addCommand({ id: "start-task", name: t("cmd.startTask"), callback: () => new StartBox(this, "start").open() });
    this.addCommand({ id: "continue-last", name: t("cmd.continueLast"), callback: act(() => this.continueLast()) });
    this.addCommand({
      id: "complete-current",
      name: t("cmd.completeCurrent"),
      checkCallback: (checking) => {
        const c = this.settings.timer;
        if (!c?.taskId) return false;
        if (!checking) void this.completeCurrent();
        return true;
      },
    });
    this.addCommand({
      id: "add-task",
      name: t("cmd.addTask"),
      callback: () => new StartBox(this, "add").open(),
    });
    this.addCommand({
      id: "zen-mode",
      name: t("cmd.zen"),
      callback: async () => {
        const open = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
        const on = !(open instanceof QuestlogView && open.state.zen);
        await this.openView("focus");
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
        if (view instanceof QuestlogView) view.setZen(on);
      },
    });
  }

  /** Resume the last work; opens the Start box when there is nothing to resume. */
  async continueLast(opts: StartOpts = {}): Promise<void> {
    const target = this.timer.continueTarget();
    if (this.timer.isRunningTarget(target)) new Notice(t("notice.alreadyRunning"));
    else if (target.kind === "none") new StartBox(this, "start").open();
    else await this.timer.startTarget(target, opts);
  }

  today(): string {
    return isoDay(new Date());
  }

  /** Stop the timer, mark the running task done, and announce the next one. */
  async completeCurrent(): Promise<void> {
    const c = this.settings.timer;
    if (!c) return;
    const task = this.store.task(c.taskId);
    await this.timer.stop();
    if (task) await this.complete(task);
  }

  /** Mark a task done and point to what comes next in today's plan. */
  async complete(task: Task): Promise<void> {
    if (this.timer.isRunningFor(task)) await this.timer.stop();
    await this.store.setDone(task, true);
    const next = this.store.dayTasks(this.today()).find((x) => x !== task);
    new Notice(next ? t("notice.doneNext", { task: task.text, next: next.text }) : t("notice.done", { task: task.text }));
  }

  async openView(tab?: TabId): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof QuestlogView) leaf.view.showTab(tab);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof QuestlogView) leaf.view.refresh();
    }
    this.tick();
  }

  private tick(): void {
    this.updateStatus();
    // Live clocks: elapsed time, or the remaining time of a time box (data-box, minutes).
    // Looked up per view, so clocks in pop-out windows keep running too.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      for (const el of Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(".ql-elapsed[data-start]"))) {
        const box = Number(el.dataset.box) || 0;
        el.setText(clockText(Number(el.dataset.start), box));
        el.toggleClass("is-over", box > 0 && Date.now() - Number(el.dataset.start) > box * 60_000);
      }
    }
    this.timer.checkBox();
  }

  private onStatusActivate(): void {
    if (this.settings.timer) void this.openView("focus");
    else if (this.statusEl?.getAttr("role") === "button") act(() => this.continueLast())();
  }

  /** Running: clock and title. Idle with something to continue: a play icon. Otherwise empty. */
  private updateStatus(): void {
    const el = this.statusEl;
    if (!el) return;
    const c = this.settings.timer;
    const target = c ? null : this.timer.continueTarget();
    const title = target ? continueTitle(target) : "";
    const text = c ? `⏱ ${clockText(c.start, c.box ?? 0)} · ${workTitle(c.taskText, questName(this.store.quest(c.quest), c.quest))}` : "";
    const key = c ? `run|${text}` : title ? `idle|${title}` : "";
    if (key === this.statusKey) return;
    this.statusKey = key;
    if (!c && !title) {
      el.empty();
      el.removeClass("is-running", "is-continue");
      for (const a of ["role", "tabindex", "aria-label", "data-tooltip-position"]) el.removeAttribute(a);
      return;
    }
    if (c) {
      el.addClass("is-running");
      el.removeAttribute("data-tooltip-position");
      el.removeClass("is-continue");
      el.setText(text);
      el.setAttr("aria-label", t("status.open"));
    } else {
      const label = t("status.continue", { title });
      el.empty();
      el.removeClass("is-running");
      el.addClass("is-continue");
      setIcon(el.createSpan({ cls: "ql-status-icon" }), "play");
      el.setAttr("aria-label", label);
      setTooltip(el, label, { placement: "top" });
    }
    el.setAttr("role", "button");
    el.setAttr("tabindex", "0");
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<QuestlogSettings> & { dailyQuestions?: unknown };
    delete data.dailyQuestions; // removed in 0.2
    this.settings = mergeSettings(DEFAULT_SETTINGS, data);
  }

  /** data.json was changed by sync: take over the new settings and timer instead of overwriting them. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    await this.store.reload();
    this.refreshViews();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** Elapsed time, or with a time box the remaining time ("+" once it is over). */
function clockText(start: number, boxMin: number): string {
  const elapsed = Date.now() - start;
  if (!boxMin) return fmtElapsed(elapsed);
  const left = boxMin * 60_000 - elapsed;
  return left >= 0 ? fmtElapsed(left + 999) : `+${fmtElapsed(-left)}`;
}
