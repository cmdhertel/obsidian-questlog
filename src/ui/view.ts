import { ItemView, Platform, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import type QuestlogPlugin from "../main";
import type { TabId } from "../settings";
import { isoDay } from "../data/dates";
import { minutesByTask } from "../data/stats";
import { t } from "../i18n";
import type { Ctx } from "./ctx";
import { renderHome } from "./tabs/home";
import { renderPlan } from "./tabs/plan";
import { renderCalendar } from "./tabs/calendar";
import { renderFocus } from "./tabs/focus";
import { renderQuests } from "./tabs/quests";
import { renderReview } from "./tabs/review";
import { timerBar } from "./components";

export const VIEW_TYPE = "questlog-view";

const TABS: { id: TabId; icon: string }[] = [
  { id: "home", icon: "home" },
  { id: "plan", icon: "list-checks" },
  { id: "calendar", icon: "calendar-days" },
  { id: "focus", icon: "timer" },
  { id: "quests", icon: "flag" },
  { id: "review", icon: "notebook-pen" },
];

const RENDER: Record<TabId, (el: HTMLElement, ctx: Ctx) => void> = {
  home: renderHome,
  plan: renderPlan,
  calendar: renderCalendar,
  focus: renderFocus,
  quests: renderQuests,
  review: renderReview,
};

/** Per-view UI state that survives re-renders (selected week, expanded sections, unsaved drafts …). */
export interface UiState {
  planDay: string;
  calendarDay: string;
  reviewDay: string;
  questsMode: "active" | "done";
  /** Quest whose detail page is open in the Quests tab. */
  questOpen: string | null;
  expanded: Set<string>;
  drafts: Map<string, string>;
  /** Task chosen in Focus while no timer runs (null = first planned task). */
  focusTask: string | null;
  focusBox: number;
  focusNote: string;
  /** Zen mode: Focus shows only the clock and the task. */
  zen: boolean;
}

export type Width = "wide" | "mid" | "narrow";

export class QuestlogView extends ItemView {
  private tab: TabId;
  private tabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private deferred = false;
  state: UiState;
  width: Width = "wide";

  constructor(leaf: WorkspaceLeaf, private plugin: QuestlogPlugin) {
    super(leaf);
    this.tab = plugin.settings.lastTab;
    const today = isoDay(new Date());
    this.state = {
      planDay: today,
      calendarDay: today,
      reviewDay: today,
      questsMode: "active",
      questOpen: null,
      expanded: new Set(),
      drafts: new Map(),
      focusTask: null,
      focusBox: plugin.settings.pomodoroMinutes,
      focusNote: "",
      zen: false,
    };
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Questlog";
  }
  getIcon(): string {
    return "target";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("questlog");
    root.setAttr("tabindex", "-1");
    this.tabsEl = root.createDiv({ cls: "ql-tabs", attr: { role: "tablist" } });
    this.bodyEl = root.createDiv({ cls: "ql-body" });
    // Don't re-render under the user's cursor; catch up when they leave the field.
    this.registerDomEvent(root, "focusout", () => {
      window.setTimeout(() => {
        if (this.deferred && !this.isEditing()) this.refresh();
      }, 50);
    });
    // Leaving fullscreen (Esc in the browser, window controls) also leaves zen mode.
    this.registerDomEvent(root, "fullscreenchange", () => {
      if (this.state.zen && this.contentEl.doc.fullscreenElement !== this.contentEl) this.setZen(false);
    });
    this.registerDomEvent(root, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.state.zen) {
        e.preventDefault();
        this.setZen(false);
      }
    });
    this.updateWidth();
    this.refresh();
  }

  /** Turn zen mode on or off. On desktop the view also goes fullscreen. */
  setZen(on: boolean): void {
    if (this.state.zen === on) return;
    this.state.zen = on;
    this.contentEl.toggleClass("is-zen", on);
    if (on) {
      if (Platform.isDesktopApp && !this.contentEl.doc.fullscreenElement) {
        this.contentEl.requestFullscreen?.().catch(() => undefined);
      }
      if (this.tab !== "focus") return this.showTab("focus");
    } else if (this.contentEl.doc.fullscreenElement === this.contentEl) {
      void this.contentEl.doc.exitFullscreen().catch(() => undefined);
    }
    this.render();
    if (on) this.contentEl.focus();
  }

  onResize(): void {
    if (this.updateWidth()) this.render();
  }

  /** Set the width class from the pane width; returns true when it changed. */
  private updateWidth(): boolean {
    const w = this.contentEl.clientWidth || 1000;
    const next: Width = w >= 880 ? "wide" : w >= 560 ? "mid" : "narrow";
    if (next === this.width && this.contentEl.hasClass(`ql-w-${next}`)) return false;
    this.contentEl.removeClass("ql-w-wide", "ql-w-mid", "ql-w-narrow");
    this.contentEl.addClass(`ql-w-${next}`);
    this.width = next;
    return true;
  }

  async onClose(): Promise<void> {
    if (this.contentEl.doc.fullscreenElement === this.contentEl) void this.contentEl.doc.exitFullscreen().catch(() => undefined);
    this.contentEl.empty();
  }

  showTab(tab: TabId): void {
    if (tab !== "focus" && this.state.zen) {
      this.state.zen = false;
      this.contentEl.removeClass("is-zen");
      if (this.contentEl.doc.fullscreenElement === this.contentEl) void this.contentEl.doc.exitFullscreen().catch(() => undefined);
    }
    if (this.tab !== tab) {
      this.tab = tab;
      this.plugin.settings.lastTab = tab;
      void this.plugin.saveSettings();
    }
    this.render();
  }

  /** True while the user types in a field that a re-render would destroy (add fields are restored instead). */
  private isEditing(): boolean {
    const a = this.contentEl.doc.activeElement;
    if (!a || !this.contentEl.contains(a)) return false;
    if (a.instanceOf(HTMLInputElement) && a.dataset.addKey) return false;
    return a.instanceOf(HTMLTextAreaElement) || (a.instanceOf(HTMLInputElement) && a.type !== "checkbox");
  }

  refresh(): void {
    if (!this.bodyEl) return;
    if (this.isEditing()) {
      this.deferred = true;
      return;
    }
    this.render();
  }

  private render(): void {
    this.deferred = false;
    const scroll = this.bodyEl.scrollTop;
    const focused = this.contentEl.doc.activeElement;
    const addKey = focused?.instanceOf(HTMLInputElement) && this.contentEl.contains(focused) ? focused.dataset.addKey : undefined;
    const addValue = addKey && focused?.instanceOf(HTMLInputElement) ? focused.value : "";
    const boards = Array.from(this.bodyEl.querySelectorAll<HTMLElement>("[data-scroll-key]")).map((el) => [el.dataset.scrollKey, el.scrollLeft] as const);
    const reviewDue =
      new Date().getDay() === this.plugin.settings.reviewDay && this.plugin.store.reviewMissing(isoDay(new Date()));

    this.tabsEl.empty();
    for (const { id, icon } of TABS) {
      const b = this.tabsEl.createEl("button", {
        cls: "ql-tab" + (id === this.tab ? " is-active" : ""),
        attr: { role: "tab", "aria-selected": String(id === this.tab), "aria-label": t(`tab.${id}` as "tab.home") },
      });
      setIcon(b.createSpan({ cls: "ql-tab-icon" }), icon);
      b.createSpan({ cls: "ql-tab-label", text: t(`tab.${id}` as "tab.home") });
      if (id === "focus" && this.plugin.settings.timer) b.createSpan({ cls: "ql-badge is-live" });
      if (id === "review" && reviewDue) b.createSpan({ cls: "ql-badge" });
      setTooltip(b, t(`tab.${id}` as "tab.home"), { placement: "bottom" });
      b.onclick = () => this.showTab(id);
    }

    this.bodyEl.empty();
    const ctx: Ctx = {
      plugin: this.plugin,
      store: this.plugin.store,
      view: this,
      state: this.state,
      today: isoDay(new Date()),
      width: this.width,
      taskMinutes: minutesByTask(this.plugin.store.allSessions()),
      rerender: () => this.render(),
    };
    this.contentEl.toggleClass("is-zen", this.state.zen && this.tab === "focus");
    if (this.tab !== "focus") timerBar(this.bodyEl, ctx);
    RENDER[this.tab](this.bodyEl.createDiv({ cls: `ql-page ql-page-${this.tab}` }), ctx);
    this.bodyEl.scrollTop = scroll;
    for (const [key, left] of boards) {
      const el = this.bodyEl.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`);
      if (el) el.scrollLeft = left;
    }
    if (addKey) {
      const input = Array.from(this.bodyEl.querySelectorAll<HTMLInputElement>("input[data-add-key]")).find((i) => i.dataset.addKey === addKey);
      if (input) {
        input.value = addValue;
        input.focus();
      }
    }
  }
}
