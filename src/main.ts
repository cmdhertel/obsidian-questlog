import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import type { Task } from "./data/model";
import { QuestStore } from "./data/store";
import { fmtElapsed, isoDay } from "./data/dates";
import { DEFAULT_SETTINGS, QuestlogSettingTab, type QuestlogSettings, type TabId } from "./settings";
import { Timer } from "./timer";
import { QuestlogView, VIEW_TYPE } from "./ui/view";
import { AddTaskModal, TaskSuggestModal } from "./ui/modals";
import { t } from "./i18n";

export default class QuestlogPlugin extends Plugin {
  settings: QuestlogSettings = { ...DEFAULT_SETTINGS };
  store!: QuestStore;
  timer!: Timer;
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new QuestStore(this.app, () => this.settings);
    this.timer = new Timer(this);

    this.registerView(VIEW_TYPE, (leaf) => new QuestlogView(leaf, this));
    this.addSettingTab(new QuestlogSettingTab(this.app, this));
    this.addRibbonIcon("target", "Questlog", () => void this.openView());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ql-statusbar");
    this.registerDomEvent(this.statusEl, "click", () => void this.openView("focus"));
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
      callback: async () => {
        if (this.timer.current) await this.timer.stop();
        else {
          const next = this.store.dayTasks(this.today())[0];
          if (next) await this.timer.start(next);
          else new TaskSuggestModal(this, (task) => void this.timer.start(task)).open();
        }
      },
    });
    this.addCommand({
      id: "start-task",
      name: t("cmd.startTask"),
      callback: () => new TaskSuggestModal(this, (task) => void this.timer.start(task)).open(),
    });
    this.addCommand({
      id: "complete-current",
      name: t("cmd.completeCurrent"),
      checkCallback: (checking) => {
        const c = this.settings.timer;
        if (!c) return false;
        if (!checking) void this.completeCurrent();
        return true;
      },
    });
    this.addCommand({
      id: "add-task",
      name: t("cmd.addTask"),
      callback: () => new AddTaskModal(this).open(),
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
    const c = this.settings.timer;
    if (this.statusEl) {
      this.statusEl.toggleClass("is-running", !!c);
      this.statusEl.setText(c ? `⏱ ${clockText(c.start, c.box ?? 0)} · ${c.taskText}` : "");
      this.statusEl.setAttr("aria-label", c ? t("status.open") : "");
    }
    // Live clocks: elapsed time, or the remaining time of a time box (data-box, minutes).
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".ql-elapsed[data-start]"))) {
      const box = Number(el.dataset.box) || 0;
      el.setText(clockText(Number(el.dataset.start), box));
      el.toggleClass("is-over", box > 0 && Date.now() - Number(el.dataset.start) > box * 60_000);
    }
    this.timer.checkBox();
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<QuestlogSettings> & { dailyQuestions?: unknown };
    delete data.dailyQuestions; // removed in 0.2
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
