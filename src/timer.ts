import { Notice } from "obsidian";
import type QuestlogPlugin from "./main";
import { fmtDuration } from "./data/dates";
import { resolveContinue, type ContinueTarget } from "./data/lastwork";
import type { Quest, RunningTimer, Task } from "./data/model";
import { runToSessions, workTitle } from "./data/timerlog";
import { t } from "./i18n";

export interface StartOpts {
  box?: number;
  note?: string;
  /** Epoch ms of the real start, for "started 10 min ago". Never later than now. */
  startedAt?: number;
}

/** Display name of a quest; the Other inbox is translated. */
function questLabel(q: Quest | undefined, fallback: string): string {
  if (!q) return fallback;
  return q.kind === "other" ? t("other.name") : q.name;
}

/** The focus timer. Its state lives in plugin data so a running timer survives restarts. */
export class Timer {
  /** Start time of the run whose time box already announced its end. */
  private boxAnnounced = 0;
  /** Set while a start is in progress, so a double click cannot start or log twice. */
  private starting = false;

  constructor(private plugin: QuestlogPlugin) {}

  get current() {
    return this.plugin.settings.timer;
  }

  isRunningFor(task: Task): boolean {
    const c = this.current;
    return !!c && !!task.id && c.taskId === task.id;
  }

  /** True while a timer runs in that quest, with or without a task. */
  isRunningForQuest(quest: string): boolean {
    return this.current?.quest === quest;
  }

  /** The task of the running timer; undefined for a quest-only run or a deleted task. */
  runningTask(): Task | undefined {
    const c = this.current;
    return c ? this.plugin.store.task(c.taskId) : undefined;
  }

  elapsedMs(): number {
    return this.current ? Date.now() - this.current.start : 0;
  }

  async start(task: Task, opts: StartOpts = {}): Promise<void> {
    const store = this.plugin.store;
    const quest = store.questOf(task);
    if (!quest || this.starting) return;
    this.starting = true;
    try {
      const id = await store.ensureId(task);
      await this.begin({ taskId: id, taskText: task.text, quest: quest.name }, opts);
    } finally {
      this.starting = false;
    }
  }

  /** Start a timer on a quest without a task. Takes the quest name ("Other" for the inbox). */
  async startQuest(name: string, opts: StartOpts = {}): Promise<void> {
    const quest = this.plugin.store.quest(name);
    if (!quest || !this.plugin.store.isWorkable(quest)) {
      new Notice(t("err.questNotWorkable", { quest: questLabel(quest, name) }));
      return;
    }
    if (this.starting) return;
    this.starting = true;
    try {
      await this.begin({ taskId: "", taskText: "", quest: quest.name }, opts);
    } finally {
      this.starting = false;
    }
  }

  /** What "Continue last work" would start now. */
  continueTarget(): ContinueTarget {
    return resolveContinue(this.plugin.settings.lastWork, this.plugin.store);
  }

  /** Start a resolved target: its open task, or the quest without a task. "none" does nothing. */
  async startTarget(target: ContinueTarget, opts: StartOpts = {}): Promise<void> {
    if (target.kind === "task") await this.start(target.task, opts);
    else if (target.kind === "quest") await this.startQuest(target.quest.name, opts);
  }

  /** True when the running timer is already that target. */
  isRunningTarget(target: ContinueTarget): boolean {
    if (target.kind === "task") return this.isRunningFor(target.task);
    return target.kind === "quest" && this.current?.taskId === "" && this.current.quest === target.quest.name;
  }

  /** Stop a running timer, then start this run and remember it as the last work. */
  private async begin(run: Pick<RunningTimer, "taskId" | "taskText" | "quest">, opts: StartOpts): Promise<void> {
    // An earlier start must not overlap the run that is logged right now.
    const floor = this.current ? Date.now() : 0;
    if (this.current) await this.stop();
    const now = Date.now();
    this.plugin.settings.timer = {
      ...run,
      start: Math.min(Math.max(opts.startedAt ?? now, floor), now),
      box: opts.box ?? this.plugin.settings.pomodoroMinutes,
      note: opts.note ?? "",
    };
    this.plugin.settings.lastWork = { ...run };
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  /** Move the start of the running timer (never into the future). */
  async setStart(ms: number): Promise<void> {
    const c = this.current;
    if (!c) return;
    const old = c.start;
    c.start = Math.min(ms, Date.now());
    // A box that already announced stays announced; otherwise it is measured from the new start.
    this.boxAnnounced = this.boxAnnounced === old ? c.start : 0;
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
      new Notice(t("focus.boxOver", { n: c.box, task: this.title(c) }), 0);
    }
  }

  /** Stop and log the session. Returns the logged minutes. */
  async stop(): Promise<number> {
    const c = this.current;
    if (!c) return 0;
    this.plugin.settings.timer = null;
    await this.plugin.saveSettings();
    const store = this.plugin.store;
    // Use the current task text/quest in case the task was renamed while running.
    const task = store.task(c.taskId);
    const quest = task ? (store.questOf(task)?.name ?? c.quest) : c.quest;
    const pieces = runToSessions(c, Date.now(), this.plugin.settings.minSessionMinutes, { text: task?.text, quest });
    let logged = 0;
    for (const piece of pieces) {
      await store.addSession(piece);
      logged += piece.end - piece.start;
    }
    if (pieces.length) {
      new Notice(t("timer.logged", { time: fmtDuration(logged), task: this.title({ ...c, taskText: task?.text ?? c.taskText, quest }) }));
    } else new Notice(t("timer.tooShort"));
    this.plugin.refreshViews();
    return logged;
  }

  /** Throw away the running timer without logging. */
  async discard(): Promise<void> {
    this.plugin.settings.timer = null;
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }

  /** Title for notices: the task text, or the quest's display name for a quest-only run. */
  private title(c: RunningTimer): string {
    return workTitle(c.taskText, questLabel(this.plugin.store.quest(c.quest), c.quest));
  }
}
