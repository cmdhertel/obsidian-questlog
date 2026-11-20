import type QuestlogPlugin from "../main";
import type { QuestStore } from "../data/store";
import type { QuestlogView, UiState, Width } from "./view";

export interface Ctx {
  plugin: QuestlogPlugin;
  store: QuestStore;
  view: QuestlogView;
  state: UiState;
  today: string;
  /** Pane width class: wide (timeline beside lists), mid, narrow (phone / sidebar). */
  width: Width;
  /** All-time minutes per task id (or "quest::text" for sessions without id). */
  taskMinutes: Map<string, number>;
  rerender: () => void;
}
