import { Notice } from "obsidian";
import type QuestlogPlugin from "./main";
import { fmtDuration, splitByDay } from "./data/dates";
import type { Task } from "./data/model";
import { t } from "./i18n";

/** The focus timer. Its state lives in plugin data so a running timer survives restarts. */
export class Timer {
  /** Start time of the run whose time box already announced its end. */
  private boxAnnounced = 0;

  constructor(private plugin: QuestlogPlugin) {}

  get current() {
    return this.plugin.settings.timer;
  }

  isRunningFor(task: Task): boolean {
    const c = this.current;
    return !!c && !!task.id && c.taskId === task.id;
  }

  elapsedMs(): number {
    return this.current ? Date.now() - this.current.start : 0;
  }

  async start(task: Task, opts: { box?: number; note?: string } = {}): Promise<void> {
    const store = this.plugin.store;
    const quest = store.questOf(task);
    if (!quest) return;
    if (this.current) await this.stop();
    const id = await store.ensureId(task);
    this.plugin.settings.timer = {
      taskId: id,
      taskText: task.text,
      quest: quest.name,
      start: Date.now(),
      box: opts.box ?? this.plugin.settings.pomodoroMinutes,
      note: opts.note ?? "",
    };
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  async setBox(min: number): Promise<void> {
    if (!this.current) return;
    this.current.box = min;
    this.boxAnnounced = 0;
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  async setNote(note: string): Promise<void> {
    if (!this.current) return;
    this.current.note = note;
    await this.plugin.saveSettings();
  }

  /** Called every second: announce once when the time box is over. */
  checkBox(): void {
    const c = this.current;
    if (!c?.box || this.boxAnnounced === c.start) return;
    if (Date.now() - c.start >= c.box * 60_000) {
      this.boxAnnounced = c.start;
      new Notice(t("focus.boxOver", { n: c.box, task: c.taskText }), 0);
    }
  }

  /** Stop and log the session. Returns the logged minutes. */
  async stop(): Promise<number> {
    const c = this.current;
    if (!c) return 0;
    this.plugin.settings.timer = null;
    await this.plugin.saveSettings();
    const end = Date.now();
    const minMs = this.plugin.settings.minSessionMinutes * 60_000;
    let logged = 0;
    if (end - c.start >= Math.max(minMs, 60_000)) {
      // Use the current task text/quest in case the task was renamed while running.
      const task = this.plugin.store.task(c.taskId);
      const quest = task ? (this.plugin.store.questOf(task)?.name ?? c.quest) : c.quest;
      for (const piece of splitByDay(c.start, end)) {
        if (piece.end <= piece.start) continue;
        await this.plugin.store.addSession({ ...piece, taskText: task?.text ?? c.taskText, quest, taskId: c.taskId, note: c.note ?? "" });
        logged += piece.end - piece.start;
      }
      new Notice(t("timer.logged", { time: fmtDuration(logged), task: task?.text ?? c.taskText }));
    } else {
      new Notice(t("timer.tooShort"));
    }
    this.plugin.refreshViews();
    return logged;
  }

  /** Throw away the running timer without logging. */
  async discard(): Promise<void> {
    this.plugin.settings.timer = null;
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }
}
