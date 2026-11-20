import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type QuestlogPlugin from "./main";
import type { Quest, RunningTimer } from "./data/model";
import { t } from "./i18n";

export type TabId = "home" | "plan" | "calendar" | "focus" | "quests" | "review";

export interface QuestlogSettings {
  folder: string;
  vision: string;
  calendarStartHour: number;
  calendarEndHour: number;
  minSessionMinutes: number;
  /** Weekly quest-hours target. 0 = sum of the quests' own targets. */
  weeklyTarget: number;
  /** Default Focus time box in minutes. 0 = open-ended. */
  pomodoroMinutes: number;
  /** null = use the default questions of the current language */
  weeklyQuestions: string[] | null;
  /** JS weekday (0 = Sunday) on which the weekly review is due. */
  reviewDay: number;
  timer: RunningTimer | null;
  lastTab: TabId;
}

export const DEFAULT_SETTINGS: QuestlogSettings = {
  folder: "Questlog",
  vision: "",
  calendarStartHour: 6,
  calendarEndHour: 22,
  minSessionMinutes: 1,
  weeklyTarget: 20,
  pomodoroMinutes: 0,
  weeklyQuestions: null,
  reviewDay: 0,
  timer: null,
  lastTab: "home",
};

export const TIME_BOXES = [0, 25, 50, 90];

export function weeklyQuestions(s: QuestlogSettings): string[] {
  return s.weeklyQuestions?.length
    ? s.weeklyQuestions
    : [t("q.weekly.1"), t("q.weekly.2"), t("q.weekly.3"), t("q.weekly.4")];
}

const linesOf = (v: string): string[] => v.split("\n").map((l) => l.trim()).filter(Boolean);

export class QuestlogSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QuestlogPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveSettings();
    };
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addText((x) =>
        x.setPlaceholder("Questlog").setValue(s.folder).onChange(async (v) => {
          s.folder = normalizePath(v.trim() || "Questlog");
          await save();
          await this.plugin.store.reload();
        }),
      );

    new Setting(containerEl)
      .setName(t("set.vision"))
      .setDesc(t("set.visionDesc"))
      .addTextArea((x) =>
        x.setValue(s.vision).onChange(async (v) => {
          s.vision = v;
          await save();
          this.plugin.refreshViews();
        }),
      );

    new Setting(containerEl).setName(t("set.calendar")).setHeading();
    const hour = (name: string, key: "calendarStartHour" | "calendarEndHour") =>
      new Setting(containerEl).setName(name).addDropdown((d) => {
        for (let h = 0; h <= 24; h++) d.addOption(String(h), `${String(h).padStart(2, "0")}:00`);
        d.setValue(String(s[key])).onChange(async (v) => {
          s[key] = Number(v);
          if (s.calendarEndHour <= s.calendarStartHour) s.calendarEndHour = Math.min(24, s.calendarStartHour + 1);
          await save();
          this.plugin.refreshViews();
        });
      });
    hour(t("set.calStart"), "calendarStartHour");
    hour(t("set.calEnd"), "calendarEndHour");

    new Setting(containerEl)
      .setName(t("set.minSession"))
      .setDesc(t("set.minSessionDesc"))
      .addSlider((x) =>
        x.setLimits(0, 10, 1).setDynamicTooltip().setValue(s.minSessionMinutes).onChange(async (v) => {
          s.minSessionMinutes = v;
          await save();
        }),
      );

    new Setting(containerEl).setName(t("set.focus")).setHeading();
    new Setting(containerEl)
      .setName(t("set.target"))
      .setDesc(t("set.targetDesc"))
      .addText((x) => {
        x.inputEl.type = "number";
        x.inputEl.min = "0";
        x.inputEl.step = "1";
        x.setValue(String(s.weeklyTarget)).onChange(async (v) => {
          s.weeklyTarget = Math.max(0, Number(v) || 0);
          await save();
          this.plugin.refreshViews();
        });
      });
    new Setting(containerEl)
      .setName(t("set.box"))
      .setDesc(t("set.boxDesc"))
      .addDropdown((d) => {
        for (const m of TIME_BOXES) d.addOption(String(m), m ? t("focus.boxMin", { n: m }) : t("focus.boxFree"));
        d.setValue(String(s.pomodoroMinutes)).onChange(async (v) => {
          s.pomodoroMinutes = Number(v);
          await save();
        });
      });

    new Setting(containerEl).setName(t("set.reflection")).setHeading();
    new Setting(containerEl)
      .setName(t("set.reviewDay"))
      .addDropdown((d) => {
        for (let i = 0; i < 7; i++) d.addOption(String(i), t(`wd.long.${i}` as "wd.long.0"));
        d.setValue(String(s.reviewDay)).onChange(async (v) => {
          s.reviewDay = Number(v);
          await save();
          this.plugin.refreshViews();
        });
      });
    new Setting(containerEl)
      .setName(t("set.weeklyQ"))
      .setDesc(t("set.questionsDesc"))
      .addTextArea((x) => {
        x.inputEl.rows = 5;
        x.setValue(weeklyQuestions(s).join("\n")).onChange(async (v) => {
          s.weeklyQuestions = linesOf(v);
          await save();
        });
      });
  }
}

/** The weekly quest-hours target: the global setting, or the sum of the active quests' targets when it is 0. */
export function weeklyTargetHours(s: QuestlogSettings, quests: Quest[]): number {
  if (s.weeklyTarget > 0) return s.weeklyTarget;
  return quests.filter((q) => q.status === "active").reduce((a, q) => a + q.weeklyHours, 0);
}
