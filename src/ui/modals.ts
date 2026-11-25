import { App, FuzzySuggestModal, Modal, Notice, Setting, setIcon, setTooltip } from "obsidian";
import type QuestlogPlugin from "../main";
import type { Quest, Session, Span, Task } from "../data/model";
import type { GapItem } from "../data/gaps";
import { fmtClock, isoDay, minutesOfDay, parseClock } from "../data/dates";
import { clampToday, midnightOf, minuteToMs, type StartClamp } from "../data/startearlier";
import { resolveContinueSession } from "../data/lastwork";
import { PALETTE } from "../data/store";
import { t } from "../i18n";
import { act } from "./components";

export class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onYes: () => void) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(t("common.delete")).setClass("mod-warning").onClick(() => {
          this.close();
          this.onYes();
        }),
      );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export class TextModal extends Modal {
  constructor(app: App, private heading: string, private value: string, private onSubmit: (v: string) => void) {
    super(app);
  }
  onOpen(): void {
    this.setTitle(this.heading);
    let v = this.value;
    const submit = () => {
      if (!v.trim()) return;
      this.close();
      this.onSubmit(v.trim());
    };
    new Setting(this.contentEl).addText((x) => {
      x.setValue(v).onChange((nv) => (v = nv));
      x.inputEl.addClass("ql-wide");
      x.inputEl.onkeydown = (e) => {
        if (e.key === "Enter" && !e.isComposing) submit();
      };
      window.setTimeout(() => x.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("common.save")).setCta().onClick(submit));
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Edit the vision note; the old text can be kept under "Earlier". */
export class VisionModal extends Modal {
  constructor(private plugin: QuestlogPlugin) {
    super(plugin.app);
  }
  onOpen(): void {
    const { store } = this.plugin;
    this.setTitle(t("vision.edit"));
    this.modalEl.addClass("ql-modal");
    let text = store.visionText();
    let keep = true;
    const area = this.contentEl.createEl("textarea", { cls: "ql-wide ql-vision-input", attr: { rows: "8", "aria-label": t("set.vision") } });
    area.value = text;
    area.addEventListener("input", () => (text = area.value));
    const label = this.contentEl.createEl("label", { cls: "ql-vision-keep" });
    const box = label.createEl("input", { type: "checkbox", cls: "ql-check" });
    box.checked = keep;
    box.addEventListener("change", () => (keep = box.checked));
    label.createSpan({ text: t("vision.keepOld") });
    let busy = false;
    const submit = act(async () => {
      if (busy) return;
      busy = true;
      try {
        // Save first: when writing fails, the dialog stays open and keeps the text.
        await store.saveVision(text, keep);
        this.close();
      } finally {
        busy = false;
      }
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(t("common.save")).setCta().onClick(submit));
    window.setTimeout(() => area.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Icons offered for quests (Lucide names). */
export const QUEST_ICONS = [
  "target", "flag", "rocket", "book-open", "pen-tool", "code-2", "briefcase", "graduation-cap",
  "dumbbell", "heart", "home", "music", "camera", "globe", "leaf", "lightbulb",
  "palette", "shield", "users", "wallet", "waves", "mountain", "sword", "star",
];

/** Create or edit a quest. */
export class QuestModal extends Modal {
  constructor(private plugin: QuestlogPlugin, private quest?: Quest) {
    super(plugin.app);
  }
  onOpen(): void {
    const q = this.quest;
    const n = this.plugin.store.quests.length;
    this.setTitle(q ? t("quest.edit") : t("quest.new"));
    this.modalEl.addClass("ql-modal");
    const v = {
      name: q?.name ?? "",
      why: q?.why ?? "",
      hours: q?.weeklyHours ?? 0,
      color: q?.color ?? PALETTE[n % PALETTE.length]!,
      icon: q?.icon ?? QUEST_ICONS[n % QUEST_ICONS.length]!,
    };
    new Setting(this.contentEl).setName(t("quest.name")).addText((x) => {
      x.setPlaceholder(t("quest.namePh")).setValue(v.name).onChange((s) => (v.name = s));
      x.inputEl.addClass("ql-wide");
      if (!q) window.setTimeout(() => x.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .setName(t("quest.why"))
      .setDesc(t("quest.whyDesc"))
      .addTextArea((x) => {
        x.setPlaceholder(t("quest.whyPh")).setValue(v.why).onChange((s) => (v.why = s));
        x.inputEl.rows = 3;
        x.inputEl.addClass("ql-wide");
      });
    new Setting(this.contentEl)
      .setName(t("quest.hours"))
      .setDesc(t("quest.hoursDesc"))
      .addText((x) => {
        x.inputEl.type = "number";
        x.inputEl.min = "0";
        x.inputEl.step = "0.5";
        x.setValue(String(v.hours)).onChange((s) => (v.hours = Math.max(0, Number(s) || 0)));
      });

    // Color swatches + custom picker
    const colorSet = new Setting(this.contentEl).setName(t("quest.color"));
    const swatches = colorSet.controlEl.createDiv({ cls: "ql-swatches" });
    const paintSwatches = () => {
      swatches.empty();
      for (const c of PALETTE) {
        const b = swatches.createEl("button", { cls: "ql-swatch" + (c === v.color ? " is-active" : ""), attr: { "aria-label": c } });
        b.style.setProperty("--ql-color", c);
        b.onclick = () => {
          v.color = c;
          paintSwatches();
          paintIcons();
        };
      }
    };
    colorSet.addColorPicker((c) =>
      c.setValue(v.color).onChange((s) => {
        v.color = s;
        paintSwatches();
        paintIcons();
      }),
    );

    // Icon grid
    const iconSet = new Setting(this.contentEl).setName(t("quest.icon"));
    iconSet.settingEl.addClass("ql-setting-block");
    const icons = iconSet.controlEl.createDiv({ cls: "ql-icon-grid" });
    const paintIcons = () => {
      icons.empty();
      icons.style.setProperty("--ql-color", v.color);
      for (const name of QUEST_ICONS) {
        const b = icons.createEl("button", { cls: "ql-icon-choice" + (name === v.icon ? " is-active" : ""), attr: { "aria-label": name } });
        setIcon(b, name);
        setTooltip(b, name);
        b.onclick = () => {
          v.icon = name;
          paintIcons();
        };
      }
    };
    paintSwatches();
    paintIcons();

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(q ? t("common.save") : t("quest.create")).setCta().onClick(async () => {
          if (!v.name.trim()) return new Notice(t("err.questName"));
          try {
            if (q) await this.plugin.store.updateQuest(q, { name: v.name, why: v.why, weeklyHours: v.hours, color: v.color, icon: v.icon });
            else await this.plugin.store.createQuest({ name: v.name, why: v.why, weeklyHours: v.hours, color: v.color, icon: v.icon });
            this.close();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e));
          }
        }),
      );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Add or edit a time entry by hand (calendar). */
export class SessionModal extends Modal {
  constructor(
    private plugin: QuestlogPlugin,
    private init: { day: string; start: number; end: number; quest?: string; taskId?: string; taskText?: string; suggestions?: GapItem[]; breakSpan?: Span },
    private existing?: Session,
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    const store = this.plugin.store;
    this.setTitle(this.existing ? t("session.edit") : t("session.add"));
    const quests = [...store.quests.filter((q) => q.status !== "done" || q.name === this.init.quest), store.other];
    const v = {
      day: this.init.day,
      start: fmtClock(this.init.start),
      end: fmtClock(this.init.end),
      quest: this.init.quest && store.quest(this.init.quest) ? this.init.quest : quests[0]!.name,
      taskId: this.init.taskId ?? "",
      taskText: this.init.taskText ?? "",
      note: this.existing?.note ?? "",
    };
    const chips = this.init.suggestions?.filter((x) => quests.some((q) => q.name === x.quest)) ?? [];
    let pickQuest: ((q: string) => void) | undefined;
    if (chips.length) {
      const row = this.contentEl.createDiv({ cls: "ql-gap-fill" });
      row.createDiv({ cls: "ql-gap-fill-label", text: t("gap.fill") });
      const last = this.plugin.settings.lastWork;
      for (const c of chips) {
        const isLast = !!last && last.quest === c.quest && last.taskId === c.taskId && last.taskText === c.taskText;
        const label = c.taskText || (store.quest(c.quest)?.kind === "other" ? t("other.name") : c.quest);
        const chip = row.createEl("button", { cls: "ql-gap-chip", text: isLast ? t("gap.last", { x: label }) : label });
        chip.onclick = () => {
          v.quest = c.quest;
          v.taskId = c.taskId;
          v.taskText = c.taskText;
          pickQuest?.(c.quest);
          fillTasks();
        };
      }
    }
    new Setting(this.contentEl).setName(t("session.day")).addText((x) => {
      x.inputEl.type = "date";
      x.setValue(v.day).onChange((s) => (v.day = s));
    });
    new Setting(this.contentEl).setName(t("session.time")).addText((x) => {
      x.inputEl.type = "time";
      x.setValue(v.start).onChange((s) => (v.start = s));
    }).addText((x) => {
      x.inputEl.type = "time";
      x.setValue(v.end).onChange((s) => (v.end = s));
    });
    let taskSetting: Setting | undefined;
    const fillTasks = () => {
      taskSetting?.settingEl.remove();
      const q = store.quest(v.quest);
      taskSetting = new Setting(this.contentEl).setName(t("session.task")).addDropdown((d) => {
        d.addOption("", t("session.noTask"));
        const tasks = (q?.tasks ?? []).filter((x) => !x.done || x.id === v.taskId);
        for (const task of tasks) d.addOption(task.id || `line:${task.line}`, task.text);
        const match = tasks.find((x) => x.id && x.id === v.taskId);
        d.setValue(match ? match.id : "");
        d.onChange((s) => {
          v.taskId = s;
          v.taskText = tasks.find((x) => (x.id || `line:${x.line}`) === s)?.text ?? "";
        });
      });
      this.contentEl.insertBefore(taskSetting.settingEl, buttons.settingEl);
    };
    new Setting(this.contentEl).setName(t("session.quest")).addDropdown((d) => {
      for (const q of quests) d.addOption(q.name, q.kind === "other" ? t("other.name") : q.name);
      pickQuest = (q) => d.setValue(q);
      d.setValue(v.quest).onChange((s) => {
        v.quest = s;
        v.taskId = "";
        v.taskText = "";
        fillTasks();
      });
    });
    new Setting(this.contentEl).setName(t("focus.note")).addText((x) => {
      x.setPlaceholder(t("focus.notePh")).setValue(v.note).onChange((s) => (v.note = s));
      x.inputEl.addClass("ql-wide");
    });
    const buttons = new Setting(this.contentEl);
    if (this.existing) {
      const ex = this.existing;
      // Starts the logged work again; the dialog's own edits are not saved, it just closes.
      const target = resolveContinueSession(ex, store);
      if (target.kind !== "none" && !this.plugin.timer.isRunningTarget(target)) {
        buttons.addButton((b) =>
          b.setButtonText(t("session.continue")).onClick(() => {
            this.close();
            this.plugin.timer.startTarget(target).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
          }),
        );
      }
      buttons.addButton((b) =>
        b.setButtonText(t("common.delete")).setClass("mod-warning").onClick(async () => {
          await store.deleteSession(ex);
          this.close();
        }),
      );
    }
    const breakSpan = this.init.breakSpan ?? { start: this.init.start, end: this.init.end };
    if (!this.existing && this.init.suggestions) {
      buttons.addButton((b) =>
        b.setButtonText(t("gap.notWork")).onClick(() => {
          store
            .addBreak(this.init.day, breakSpan)
            .then(() => this.close())
            .catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
        }),
      );
    }
    buttons
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(t("common.save")).setCta().onClick(async () => {
          const start = parseClock(v.start);
          const end = parseClock(v.end);
          if (start === null || end === null || end <= start || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) {
            return new Notice(t("err.sessionTime"));
          }
          let taskId = v.taskId;
          let taskText = v.taskText;
          if (taskId.startsWith("line:")) {
            const task = store.quest(v.quest)?.tasks.find((x) => `line:${x.line}` === taskId);
            taskId = task ? await store.ensureId(task) : "";
          }
          if (!taskText) taskText = this.init.taskText || (store.quest(v.quest)?.kind === "other" ? t("other.name") : v.quest);
          const s = { day: v.day, start, end, quest: v.quest, taskId, taskText, note: v.note.trim() };
          try {
            if (this.existing) await store.updateSession(this.existing, s);
            else await store.addSession(s);
            this.close();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e));
          }
        }),
      );
    fillTasks();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** "Change start" of the running timer: a time field for today, clamped to what is already logged. */
export class StartTimeModal extends Modal {
  constructor(private plugin: QuestlogPlugin) {
    super(plugin.app);
  }

  /** One line that says which limit moved the start; nothing for an unclamped start. */
  static announce(clamped: StartClamp, start: number): void {
    if (clamped === "none") return;
    new Notice(t(`focus.clamped.${clamped}`, { time: fmtClock(minutesOfDay(new Date(start))) }));
  }

  /** Clamp a "HH:MM" text against today's sessions; null for empty or invalid input. */
  private resolve(text: string, runStart: number): { start: number; clamped: StartClamp } | null {
    const min = parseClock(text);
    if (min === null || min >= 1440) return null;
    const now = Date.now();
    const today = isoDay(new Date(now));
    const sessions = this.plugin.store.sessions([today]);
    return clampToday(minuteToMs(midnightOf(now), min), now, sessions, runStart);
  }

  onOpen(): void {
    const run = this.plugin.settings.timer;
    if (!run) return this.close();
    const runStart = run.start;
    this.setTitle(t("focus.changeStart"));
    const initial = fmtClock(minutesOfDay(new Date(runStart)));
    let value = initial;
    let hint: HTMLElement | undefined;
    const showHint = () => {
      const r = this.resolve(value, runStart);
      const key = r && r.clamped !== "none" ? (`focus.clamped.${r.clamped}` as const) : null;
      hint?.setText(key && r ? t(key, { time: fmtClock(minutesOfDay(new Date(r.start))) }) : "");
    };
    const save = async () => {
      // Untouched field: keep the exact start instead of rounding it to the minute.
      if (value === initial) return this.close();
      const r = this.resolve(value, runStart);
      if (!r) return void new Notice(t("err.startTime"));
      this.close();
      // The run may have been stopped or replaced while the dialog was open (sync, status bar).
      if (this.plugin.settings.timer?.start !== runStart) return;
      await this.plugin.timer.setStart(r.start);
      StartTimeModal.announce(r.clamped, r.start);
    };
    new Setting(this.contentEl).setName(t("focus.startedAt")).addText((x) => {
      x.inputEl.type = "time";
      x.setValue(value).onChange((s) => {
        value = s;
        showHint();
      });
      x.inputEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        void save().catch((err) => new Notice(err instanceof Error ? err.message : String(err)));
      });
      window.setTimeout(() => x.inputEl.focus(), 0);
    });
    hint = this.contentEl.createEl("p", { cls: "ql-muted ql-small ql-start-hint", attr: { "aria-live": "polite" } });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(t("common.save")).setCta().onClick(() => {
          void save().catch((err) => new Notice(err instanceof Error ? err.message : String(err)));
        }),
      );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Fuzzy picker over all open tasks of active quests. */
export class TaskSuggestModal extends FuzzySuggestModal<Task> {
  constructor(private plugin: QuestlogPlugin, private onPick: (task: Task) => void) {
    super(plugin.app);
    this.setPlaceholder(t("pick.placeholder"));
  }
  getItems(): Task[] {
    const store = this.plugin.store;
    const today = store.dayTasks(isoDay(new Date()));
    const rest = store.workable().flatMap((q) => q.tasks.filter((x) => !x.done && !today.includes(x)));
    return [...today, ...rest];
  }
  getItemText(task: Task): string {
    const q = this.plugin.store.questOf(task);
    return `${task.text} · ${q?.kind === "other" ? t("other.name") : q?.name ?? ""}`;
  }
  onChooseItem(task: Task): void {
    this.onPick(task);
  }
}
