import { App, PluginSettingTab, Setting, normalizePath, type DropdownComponent, type SettingDefinition, type SettingDefinitionItem, type ToggleComponent } from "obsidian";
import type QuestlogPlugin from "./main";
import type { LastWork, Quest, RunningTimer } from "./data/model";
import { mergeSettings, pickQuestions } from "./data/settings-merge";
import type { Period } from "./data/periods";
import { NUDGE_OPTIONS } from "./data/nudge";
import { MODULES, PRESETS, PRESET_IDS, moduleOn, presetOf, type ModuleId, type Modules, type Preset } from "./data/modules";
import { t, type Key } from "./i18n";
import { act, actWith } from "./ui/components";
import { VisionModal } from "./ui/modals";

export { mergeSettings };

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
  /** Monthly review questions; null = the defaults of the current language. */
  monthlyQuestions: string[] | null;
  /** JS weekday (0 = Sunday) on which the weekly review is due. */
  reviewDay: number;
  timer: RunningTimer | null;
  lastTab: TabId;
  /** Last day (YYYY-MM-DD) or week the start, close, week and check-in rituals were dismissed. */
  rituals: { start: string | null; close: string | null; week: string | null; checkin: string | null };
  /** Quiet weeks before a quest check-in is offered (2 to 8). */
  checkinWeeks: number;
  /** Active minutes before the nudge appears. 0 = off. */
  nudgeMinutes: number;
  lastWork: LastWork | null;
  /** Calendar layout: one day, the week, or "auto" (one day on narrow panes, else the week). */
  calendarView: "auto" | "day" | "week";
  /** Which modules are shown; off only hides, the data stays. */
  modules: Modules;
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
  monthlyQuestions: null,
  reviewDay: 0,
  timer: null,
  lastTab: "home",
  rituals: { start: null, close: null, week: null, checkin: null },
  checkinWeeks: 3,
  nudgeMinutes: 15,
  lastWork: null,
  calendarView: "auto",
  modules: { ...PRESETS.standard },
};

/** Whether a module is on. */
export function isOn(s: QuestlogSettings, id: ModuleId): boolean {
  return moduleOn(s.modules, id);
}

/** The tabs a module hides; the rest are always shown. */
const TAB_MODULE: Partial<Record<TabId, ModuleId>> = { plan: "plan", calendar: "calendar", review: "review" };

/** Whether a tab is shown. */
export function tabOn(s: QuestlogSettings, tab: TabId): boolean {
  const m = TAB_MODULE[tab];
  return !m || isOn(s, m);
}

export const TIME_BOXES = [0, 25, 50, 90];

export function weeklyQuestions(s: QuestlogSettings): string[] {
  return pickQuestions(s.weeklyQuestions, [t("q.weekly.1"), t("q.weekly.2"), t("q.weekly.3"), t("q.weekly.4")]);
}

export function monthlyQuestions(s: QuestlogSettings): string[] {
  return pickQuestions(s.monthlyQuestions, [t("q.monthly.1"), t("q.monthly.2"), t("q.monthly.3")]);
}

/** The questions of a review period. Week and month follow the settings; quarter and year are fixed texts. */
export function periodQuestions(s: QuestlogSettings, period: Period): string[] {
  switch (period) {
    case "week":
      return weeklyQuestions(s);
    case "month":
      return monthlyQuestions(s);
    case "quarter":
      return [t("q.quarterly.1"), t("q.quarterly.2"), t("q.quarterly.3")];
    case "year":
      return [t("q.yearly.1"), t("q.yearly.2"), t("q.yearly.3")];
  }
}

const linesOf = (v: string): string[] => v.split("\n").map((l) => l.trim()).filter(Boolean);

/** One settings row as plain data; only the two render paths below know how it is shown. */
interface Row {
  name: string;
  desc?: string;
  aliases: string;
  build: (setting: Setting) => void;
}
interface Section {
  heading?: string;
  rows: Row[];
}

export class QuestlogSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QuestlogPlugin) {
    super(app, plugin);
  }

  /** Obsidian 1.13+: declarative rows, so they show up in settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const toDef = (r: Row): SettingDefinition => ({
      name: r.name,
      desc: r.desc,
      aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      render: (setting) => r.build(setting),
    });
    return this.sections().flatMap((sec): SettingDefinitionItem[] =>
      sec.heading ? [{ type: "group", heading: sec.heading, items: sec.rows.map(toDef) }] : sec.rows.map(toDef),
    );
  }

  /** Older Obsidian: Obsidian only calls this when getSettingDefinitions() is empty. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const sec of this.sections()) {
      if (sec.heading) new Setting(containerEl).setName(sec.heading).setHeading();
      for (const r of sec.rows) r.build(new Setting(containerEl));
    }
  }

  /** The single list both render paths use, so they cannot drift. */
  private sections(): Section[] {
    // Obsidian keeps the definitions and settings can be replaced by sync, so rows always look up the current object.
    const { plugin } = this;
    const save = async () => {
      await plugin.saveSettings();
    };
    const row = (name: string, aliasKey: Key, desc: string | undefined, build: (x: Setting) => void): Row => ({
      name,
      desc,
      aliases: t(aliasKey),
      build: (x) => {
        x.setName(name);
        if (desc) x.setDesc(desc);
        build(x);
      },
    });
    const hour = (name: string, aliasKey: Key, key: "calendarStartHour" | "calendarEndHour") =>
      row(name, aliasKey, undefined, (x) =>
        x.addDropdown((d) => {
          for (let h = 0; h <= 24; h++) d.addOption(String(h), `${String(h).padStart(2, "0")}:00`);
          d.setValue(String(plugin.settings[key])).onChange(actWith(async (v) => {
            plugin.settings[key] = Number(v);
            if (plugin.settings.calendarEndHour <= plugin.settings.calendarStartHour) plugin.settings.calendarEndHour = Math.min(24, plugin.settings.calendarStartHour + 1);
            await save();
            plugin.refreshViews();
          }));
        }),
      );

    // The preset and the switches show each other's changes; `syncing` keeps those updates from saving again.
    const toggles = new Map<ModuleId, ToggleComponent>();
    let presetDrop: DropdownComponent | null = null;
    let syncing = false;
    const setModules = async (m: Modules) => {
      plugin.settings.modules = m;
      syncing = true;
      try {
        presetDrop?.setValue(presetOf(m));
        for (const [id, tg] of toggles) tg.setValue(m[id]);
      } finally {
        syncing = false;
      }
      await save();
      plugin.refreshViews();
    };
    const moduleRow = (id: ModuleId) =>
      row(t(`mod.${id}` as Key), "set.alias.module", t(`mod.${id}Desc` as Key), (x) =>
        x.addToggle((tg) => {
          toggles.set(id, tg);
          tg.setValue(plugin.settings.modules[id]).onChange(actWith(async (v: boolean) => {
            if (syncing) return;
            await setModules({ ...plugin.settings.modules, [id]: v });
          }));
        }),
      );

    return [
      {
        rows: [
          row(t("set.folder"), "set.alias.folder", t("set.folderDesc"), (x) =>
            x.addText((c) =>
              c.setPlaceholder("Questlog").setValue(plugin.settings.folder).onChange(actWith(async (v) => {
                plugin.settings.folder = normalizePath(v.trim() || "Questlog");
                await save();
                await plugin.store.reload();
              })),
            ),
          ),
          row(t("set.vision"), "set.alias.vision", t("set.visionDesc"), (x) =>
            x
              .addButton((b) => b.setButtonText(t("set.visionEdit")).onClick(() => new VisionModal(plugin).open()))
              .addButton((b) =>
                b.setButtonText(t("set.visionOpen")).onClick(
                  act(async () => {
                    const f = await plugin.store.visionFile();
                    await plugin.app.workspace.openLinkText(f.path, "", false);
                    // The note opens behind the settings window; `setting` is not in the public types.
                    (plugin.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
                  }),
                ),
              ),
          ),
        ],
      },
      {
        heading: t("set.modules"),
        rows: [
          row(t("set.preset"), "set.alias.preset", t("set.presetDesc"), (x) =>
            x.addDropdown((d) => {
              presetDrop = d;
              for (const p of PRESET_IDS) d.addOption(p, t(`preset.${p}`));
              d.addOption("custom", t("preset.custom"));
              d.setValue(presetOf(plugin.settings.modules)).onChange(actWith(async (v) => {
                if (syncing) return;
                // "Custom" is only a label for hand-picked switches; picking it changes nothing.
                if (v === "custom") {
                  d.setValue(presetOf(plugin.settings.modules));
                  return;
                }
                await setModules({ ...PRESETS[v as Preset] });
              }));
            }),
          ),
          ...MODULES.map(moduleRow),
        ],
      },
      {
        heading: t("set.calendar"),
        rows: [
          hour(t("set.calStart"), "set.alias.calStart", "calendarStartHour"),
          hour(t("set.calEnd"), "set.alias.calEnd", "calendarEndHour"),
          row(t("set.minSession"), "set.alias.minSession", t("set.minSessionDesc"), (x) =>
            x.addSlider((c) =>
              c.setLimits(0, 10, 1).setValue(plugin.settings.minSessionMinutes).onChange(actWith(async (v) => {
                plugin.settings.minSessionMinutes = v;
                await save();
              })),
            ),
          ),
        ],
      },
      {
        heading: t("set.focus"),
        rows: [
          row(t("set.target"), "set.alias.target", t("set.targetDesc"), (x) =>
            x.addText((c) => {
              c.inputEl.type = "number";
              c.inputEl.min = "0";
              c.inputEl.step = "1";
              c.setValue(String(plugin.settings.weeklyTarget)).onChange(actWith(async (v) => {
                plugin.settings.weeklyTarget = Math.max(0, Number(v) || 0);
                await save();
                plugin.refreshViews();
              }));
            }),
          ),
          row(t("set.box"), "set.alias.box", t("set.boxDesc"), (x) =>
            x.addDropdown((d) => {
              for (const m of TIME_BOXES) d.addOption(String(m), m ? t("focus.boxMin", { n: m }) : t("focus.boxFree"));
              d.setValue(String(plugin.settings.pomodoroMinutes)).onChange(actWith(async (v) => {
                plugin.settings.pomodoroMinutes = Number(v);
                await save();
              }));
            }),
          ),
          row(t("set.nudge"), "set.alias.nudge", t("set.nudgeDesc"), (x) =>
            x.addDropdown((d) => {
              for (const m of NUDGE_OPTIONS) d.addOption(String(m), m ? t("set.nudgeN", { n: m }) : t("set.nudgeOff"));
              d.setValue(String(plugin.settings.nudgeMinutes)).onChange(actWith(async (v) => {
                plugin.settings.nudgeMinutes = Number(v);
                await save();
              }));
            }),
          ),
        ],
      },
      {
        heading: t("set.reflection"),
        rows: [
          row(t("set.reviewDay"), "set.alias.reviewDay", undefined, (x) =>
            x.addDropdown((d) => {
              for (let i = 0; i < 7; i++) d.addOption(String(i), t(`wd.long.${i}` as "wd.long.0"));
              d.setValue(String(plugin.settings.reviewDay)).onChange(actWith(async (v) => {
                plugin.settings.reviewDay = Number(v);
                await save();
                plugin.refreshViews();
              }));
            }),
          ),
          row(t("set.weeklyQ"), "set.alias.weeklyQ", t("set.questionsDesc"), (x) =>
            x.addTextArea((c) => {
              c.inputEl.rows = 5;
              c.setValue(weeklyQuestions(plugin.settings).join("\n")).onChange(actWith(async (v) => {
                plugin.settings.weeklyQuestions = linesOf(v);
                await save();
              }));
            }),
          ),
          row(t("set.monthlyQ"), "set.alias.monthlyQ", t("set.questionsDesc"), (x) =>
            x.addTextArea((c) => {
              c.inputEl.rows = 4;
              c.setValue(monthlyQuestions(plugin.settings).join("\n")).onChange(actWith(async (v) => {
                plugin.settings.monthlyQuestions = linesOf(v);
                await save();
              }));
            }),
          ),
          row(t("set.checkinWeeks"), "set.alias.checkinWeeks", t("set.checkinWeeksDesc"), (x) =>
            x.addDropdown((d) => {
              for (let n = 2; n <= 8; n++) d.addOption(String(n), t("set.checkinWeeksN", { n }));
              d.setValue(String(plugin.settings.checkinWeeks)).onChange(actWith(async (v) => {
                plugin.settings.checkinWeeks = Number(v);
                await save();
                plugin.refreshViews();
              }));
            }),
          ),
        ],
      },
    ];
  }
}

/** The weekly quest-hours target: the global setting, or the sum of the active quests' targets when it is 0; 0 when hour targets are off. */
export function weeklyTargetHours(s: QuestlogSettings, quests: Quest[]): number {
  if (!isOn(s, "hours")) return 0;
  if (s.weeklyTarget > 0) return s.weeklyTarget;
  return quests.filter((q) => q.status === "active").reduce((a, q) => a + q.weeklyHours, 0);
}
