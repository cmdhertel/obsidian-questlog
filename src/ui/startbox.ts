// Start box: one input that finds an open task, or creates one in the right quest and starts it.
import { Notice, Platform, SuggestModal, setIcon } from "obsidian";
import type QuestlogPlugin from "../main";
import { isoDay } from "../data/dates";
import type { ContinueTarget } from "../data/lastwork";
import type { Quest, Task } from "../data/model";
import { buildRows, type StartRow, type TaskEntry } from "../data/startbox";
import { t } from "../i18n";
import { questName } from "./components";

export type StartMode = "start" | "add";

/** Title of what "Continue last work" would start: the task text, or the quest name. */
export function continueTitle(target: ContinueTarget): string {
  if (target.kind === "task") return target.task.text;
  return target.kind === "quest" ? questName(target.quest) : "";
}

/** True while an input method is composing; Enter then confirms the composition, not a row. */
function composing(evt: MouseEvent | KeyboardEvent): boolean {
  // No instanceof: in a pop-out window the event class belongs to another window.
  return "isComposing" in evt && evt.isComposing;
}

export class StartBox extends SuggestModal<StartRow> {
  private readonly today = isoDay(new Date());
  private readonly quests: Quest[];
  private readonly entries: TaskEntry[];
  private readonly plannedIds: string[];
  private readonly otherNames = ["Other", t("other.name")];
  private readonly lastQuest: Quest | null;
  /** Set while a choice is being carried out, so a double Enter cannot create two tasks. */
  private busy = false;

  constructor(private plugin: QuestlogPlugin, private mode: StartMode) {
    super(plugin.app);
    const store = plugin.store;
    this.quests = store.workable();
    this.entries = this.quests.flatMap((quest) => quest.tasks.filter((task) => !task.done).map((task) => ({ task, quest })));
    this.plannedIds = store.dayTasks(this.today, this.today).map((x) => x.id);
    const last = store.quest(plugin.settings.lastWork?.quest ?? "");
    this.lastQuest = last && store.isWorkable(last) ? last : null;

    this.setPlaceholder(t("startbox.placeholder"));
    this.emptyStateText = t("startbox.empty");
    if (!Platform.isMobile) {
      const start = { command: "↵", purpose: t("startbox.hintStart") };
      const add = { command: "⇧↵", purpose: t("startbox.hintAdd") };
      this.setInstructions([...(mode === "start" ? [start, add] : [add, start]), { command: "esc", purpose: t("startbox.hintClose") }]);
    }
    // Obsidian's own Enter handler has no modifier, so Shift+Enter needs its own entry.
    this.scope.register(["Shift"], "Enter", (evt) => {
      if (composing(evt)) return true;
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  getSuggestions(query: string): StartRow[] {
    return buildRows({
      input: query,
      mode: this.mode,
      quests: this.quests,
      otherNames: this.otherNames,
      entries: this.entries,
      plannedIds: this.plannedIds,
      lastQuest: this.lastQuest,
    });
  }

  renderSuggestion(row: StartRow, el: HTMLElement): void {
    el.addClass("ql-sb-row", `is-${row.kind}`);
    el.style.setProperty("--ql-color", row.quest.color);
    setIcon(el.createSpan({ cls: "ql-sb-icon" }), row.kind === "start" ? "play" : row.kind === "add" ? "plus" : row.kind === "backlog" ? "inbox" : "circle");
    const body = el.createDiv({ cls: "ql-sb-text" });
    const quest = questName(row.quest);
    if (row.kind === "start") body.setText(t("startbox.start", { text: row.text, quest }));
    else if (row.kind === "add") body.setText(t("startbox.addOnly", { quest }));
    else if (row.kind === "backlog") body.setText(t("startbox.addBacklog", { quest }));
    else {
      body.createSpan({ cls: "ql-sb-title", text: row.task.text });
      body.createSpan({ cls: "ql-sb-quest", text: ` · ${quest}` });
      if (row.task.id && this.plannedIds.includes(row.task.id)) body.createSpan({ cls: "ql-sb-quest", text: ` · ${t("startbox.planned")}` });
    }
  }

  /** Obsidian closes the modal before it calls onChooseSuggestion; here it stays open if the action fails. */
  selectSuggestion(row: StartRow, evt: MouseEvent | KeyboardEvent): void {
    if (this.busy || composing(evt)) return;
    this.busy = true;
    this.choose(row, evt.shiftKey)
      .then(() => this.close())
      .catch((e: unknown) => {
        console.error("Questlog:", e);
        new Notice(e instanceof Error ? e.message : String(e));
      })
      .finally(() => (this.busy = false));
  }

  // All the work happens in selectSuggestion.
  onChooseSuggestion(): void {}

  private async choose(row: StartRow, shift: boolean): Promise<void> {
    const { store, timer } = this.plugin;
    if (row.kind === "task") {
      const addOnly = shift || this.mode === "add";
      await this.planToday(row.task, addOnly ? "bottom" : "top");
      if (!addOnly) await timer.start(row.task);
      return;
    }
    if (row.kind === "backlog") {
      await store.addTaskTo(row.quest, row.text, null, "bottom");
      new Notice(t("startbox.addedBacklog", { quest: questName(row.quest) }));
      return;
    }
    const addOnly = row.kind === "add" || shift;
    const id = await store.addTaskTo(row.quest, row.text, this.today, addOnly ? "bottom" : "top");
    const task = store.task(id);
    if (!addOnly && task) await timer.start(task);
  }

  /** Plan for today unless it already is (also when carried over), so its place in the plan stays. */
  private async planToday(task: Task, pos: "top" | "bottom"): Promise<void> {
    const store = this.plugin.store;
    if (store.scheduledDay(task, this.today) !== this.today) await store.moveToDay(task, this.today, pos);
  }
}
