// Start box: one input that finds an open task, or creates one in the right quest and starts it.
import { type App, Notice, Platform, SuggestModal, setIcon } from "obsidian";
import type QuestlogPlugin from "../main";
import { isoDay } from "../data/dates";
import type { ContinueTarget } from "../data/lastwork";
import type { Quest, Task } from "../data/model";
import { buildRows, type StartRow, type TaskEntry } from "../data/startbox";
import { t } from "../i18n";
import { dot, questName } from "./components";

export type StartMode = "start" | "add";

/** Title of what "Continue last work" would start: the task text, or the quest name. */
export function continueTitle(target: ContinueTarget): string {
  if (target.kind === "task") return target.task.text;
  return target.kind === "quest" ? questName(target.quest) : "";
}

/** The mobile app, or a desktop app emulating it (the smoke test does). */
export function onMobile(doc: Document): boolean {
  return Platform.isMobile || doc.body.hasClass("is-mobile");
}

/** A plain list of quests to pick the Start box destination on a phone. */
class QuestPicker extends SuggestModal<Quest> {
  constructor(app: App, private quests: Quest[], private onPick: (q: Quest | null) => void) {
    super(app);
    this.setPlaceholder(t("startbox.pickQuest"));
  }
  getSuggestions(query: string): Quest[] {
    const q = query.trim().toLowerCase();
    return this.quests.filter((x) => !q || questName(x).toLowerCase().includes(q));
  }
  renderSuggestion(q: Quest, el: HTMLElement): void {
    el.addClass("ql-sb-row");
    el.style.setProperty("--ql-color", q.color);
    dot(el, q.color || "var(--text-faint)");
    el.createSpan({ cls: "ql-sb-text", text: questName(q) });
  }
  onChooseSuggestion(q: Quest): void {
    this.onPick(q);
  }
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
  /** Quest picked with the phone quest row (#28); null = the usual destination. */
  private chosen: Quest | null = null;
  private questBtn: HTMLButtonElement | null = null;
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
    // Phone keyboards: an action key that says what Enter does, and a capital first letter.
    this.inputEl.setAttr("enterkeyhint", "go");
    this.inputEl.setAttr("autocapitalize", "sentences");
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

  onOpen(): void {
    void super.onOpen();
    if (!onMobile(this.modalEl.doc)) return;
    // On a phone "#quest" is awkward to type: a row under the field shows where new tasks go and changes it.
    const row = createDiv({ cls: "ql-sb-questrow" });
    this.inputEl.parentElement?.after(row);
    this.modalEl.addClass("ql-sb-has-questrow");
    this.questBtn = row.createEl("button", { cls: "ql-sb-questbtn" });
    this.questBtn.onclick = () => {
      new QuestPicker(this.app, this.quests, (q) => {
        this.chosen = q;
        this.paintQuest();
        this.inputEl.focus();
        this.inputEl.dispatchEvent(new Event("input"));
      }).open();
    };
    this.paintQuest();
  }

  /** The destination without a typed token: the picked quest, the last used one, else Other. */
  private destination(): Quest | null {
    return this.chosen ?? this.lastQuest ?? this.quests.find((q) => q.kind === "other") ?? null;
  }

  private paintQuest(): void {
    const b = this.questBtn;
    const dest = this.destination();
    if (!b || !dest) return;
    b.empty();
    b.style.setProperty("--ql-color", dest.color || "var(--text-faint)");
    dot(b, dest.color || "var(--text-faint)");
    b.createSpan({ text: t("startbox.quest", { quest: questName(dest) }) });
    setIcon(b.createSpan({ cls: "ql-sb-questchev", attr: { "aria-hidden": "true" } }), "chevron-down");
    b.setAttr("aria-label", t("startbox.questChange", { quest: questName(dest) }));
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
      chosenQuest: this.chosen,
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
    // On a phone the box closes over a view that may not show today: say where the task went.
    else if (addOnly && onMobile(this.modalEl.doc)) new Notice(t("startbox.addedToday", { quest: questName(row.quest) }));
  }

  /** Plan for today unless it already is (also when carried over), so its place in the plan stays. */
  private async planToday(task: Task, pos: "top" | "bottom"): Promise<void> {
    const store = this.plugin.store;
    if (store.scheduledDay(task, this.today) !== this.today) await store.moveToDay(task, this.today, pos);
  }
}
