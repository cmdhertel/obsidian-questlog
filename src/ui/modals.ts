import { App, FuzzySuggestModal, Modal, Notice, Setting, setIcon, setTooltip } from "obsidian";
import type QuestlogPlugin from "../main";
import type { Quest, Session, Task } from "../data/model";
import { fmtClock, isoDay, parseClock } from "../data/dates";
import { PALETTE } from "../data/store";
import { t } from "../i18n";

export class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onYes: () => void) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(t("common.delete")).setWarning().onClick(() => {
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
    private init: { day: string; start: number; end: number; quest?: string; taskId?: string; taskText?: string },
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
      buttons.addButton((b) =>
        b.setButtonText(t("common.delete")).setWarning().onClick(async () => {
          await store.deleteSession(ex);
          this.close();
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

/** Command palette: quickly capture a task into a quest or Other. */
export class AddTaskModal extends Modal {
  constructor(private plugin: QuestlogPlugin) {
    super(plugin.app);
  }
  onOpen(): void {
    const store = this.plugin.store;
    this.setTitle(t("task.add"));
    const quests = store.workable();
    const v = { quest: store.other.path, text: "", today: true };
    const submit = async () => {
      const q = quests.find((x) => x.path === v.quest);
      if (!q || !v.text.trim()) return;
      try {
        await store.addTaskTo(q, v.text.trim(), v.today ? isoDay(new Date()) : null, "bottom");
        this.close();
      } catch (e) {
        new Notice(e instanceof Error ? e.message : String(e));
      }
    };
    new Setting(this.contentEl).setName(t("session.task")).addText((x) => {
      x.inputEl.addClass("ql-wide");
      x.setPlaceholder(t("task.addPlaceholder"));
      x.onChange((s) => (v.text = s));
      x.inputEl.onkeydown = (e) => {
        if (e.key === "Enter" && !e.isComposing) void submit();
      };
      window.setTimeout(() => x.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName(t("session.quest")).addDropdown((d) => {
      for (const q of quests) d.addOption(q.path, q.kind === "other" ? t("other.name") : q.name);
      d.setValue(v.quest).onChange((s) => (v.quest = s));
    });
    new Setting(this.contentEl).setName(t("plan.addToday")).addToggle((x) => x.setValue(v.today).onChange((b) => (v.today = b)));
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("task.add")).setCta().onClick(() => void submit()));
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
