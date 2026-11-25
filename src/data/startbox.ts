import type { Quest, Task } from "./model";

/** Result of reading the Start box input. */
export interface ParsedStart {
  /** Task text without the quest token; whitespace trimmed and collapsed. */
  text: string;
  /** Quest picked by a trailing `#token`, else null. */
  quest: Quest | null;
  /** True when a trailing token matched a quest and was removed from `text`. */
  tokenUsed: boolean;
}

/** An open task together with its quest, as the box lists it. */
export interface TaskEntry {
  task: Task;
  quest: Quest;
}

export type StartRow =
  | { kind: "start"; text: string; quest: Quest }
  | { kind: "add"; text: string; quest: Quest }
  | { kind: "backlog"; text: string; quest: Quest }
  | { kind: "task"; task: Task; quest: Quest };

/** Lowercase, NFC, and drop spaces and hyphens so `#travel-book` and `#travelbook` hit "Travel book". */
function norm(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[\s-]+/g, "");
}

/**
 * Finds the quest a token names. Case-insensitive; prefix matches beat contains matches;
 * ties go to the first quest in the given (store) order. Callers pass only workable quests.
 * The quest of kind "other" also answers to every name in `otherNames` (e.g. "Other", "Sonstiges").
 */
export function matchQuest(token: string, quests: Quest[], otherNames: string[]): Quest | null {
  const t = norm(token);
  if (!t) return null;
  const names = (q: Quest): string[] =>
    (q.kind === "other" ? [q.name, ...otherNames] : [q.name]).map(norm).filter(Boolean);
  const hit = (test: (n: string) => boolean): Quest | null => quests.find((q) => names(q).some(test)) ?? null;
  return hit((n) => n.startsWith(t)) ?? hit((n) => n.includes(t));
}

/**
 * Splits the box input into task text and an optional quest. Only a trailing `#token` counts and
 * only if it matches a quest; otherwise it stays in the text (`Fix #2 bug`, `Call #idea`).
 * `#travel` alone gives empty text. Surrounding and repeated whitespace is cleaned.
 */
export function parseStartInput(input: string, quests: Quest[], otherNames: string[]): ParsedStart {
  const clean = input.replace(/\s+/g, " ").trim();
  const m = /(?:^|\s)#([^\s#]+)$/.exec(clean);
  if (m) {
    const quest = matchQuest(m[1] ?? "", quests, otherNames);
    if (quest) return { text: clean.slice(0, m.index).trim(), quest, tokenUsed: true };
  }
  return { text: clean, quest: null, tokenUsed: false };
}

/**
 * Filters and orders open tasks for a query. Every word of the query must be a case-insensitive
 * substring of the task text or the quest name (for Other also one of `otherNames`). Tasks planned
 * today come first in plan order, the rest keep the given order (quest order, then note order).
 * An empty query returns all open tasks. Done tasks are skipped.
 */
export function rankTasks(query: string, entries: TaskEntry[], plannedIds: string[], otherNames: string[] = []): TaskEntry[] {
  // NFC: file names can arrive decomposed ("u" + diaeresis), typed text does not.
  const fold = (s: string): string => s.normalize("NFC").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const plan = (e: TaskEntry): number => {
    const i = e.task.id ? plannedIds.indexOf(e.task.id) : -1;
    return i < 0 ? plannedIds.length : i;
  };
  return entries
    .filter((e) => {
      if (e.task.done) return false;
      const names = e.quest.kind === "other" ? [e.quest.name, ...otherNames] : [e.quest.name];
      const hay = fold([e.task.text, ...names].join(" "));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => plan(a) - plan(b));
}

export interface BuildRowsArgs {
  input: string;
  /** "start": Start row first (start-task, quick-start). "add": Add-only first, then Add-to-backlog, then Start (add-task). */
  mode: "start" | "add";
  /** Workable quests in store order, including Other. */
  quests: Quest[];
  /** "Other" and its translated name. */
  otherNames: string[];
  /** Open tasks of all workable quests, in store order. */
  entries: TaskEntry[];
  /** Task ids planned today, in plan order. */
  plannedIds: string[];
  /** Quest from `settings.lastWork`, already checked to be workable; null if none. */
  lastQuest: Quest | null;
}

/**
 * Builds the ordered rows of the box. With a matched token the tasks are searched with the text
 * without the token and limited to that quest, and the create rows come first. Without a token
 * the whole input is the query; create rows follow the tasks (first when no task matches).
 * Destination without token: last used quest, else Other. No create rows for empty text or when
 * no destination exists. Note "every word" is strict: "Draft the Lisbon chapter" does not list
 * "Draft the Lisbon outline".
 */
export function buildRows(a: BuildRowsArgs): StartRow[] {
  const parsed = parseStartInput(a.input, a.quests, a.otherNames);
  const other = a.quests.find((q) => q.kind === "other") ?? null;
  const dest = parsed.quest ?? a.lastQuest ?? other;
  const pool = parsed.quest ? a.entries.filter((e) => e.quest.path === parsed.quest!.path) : a.entries;
  const tasks: StartRow[] = rankTasks(parsed.text, pool, a.plannedIds, a.otherNames).map(
    (e) => ({ kind: "task", task: e.task, quest: e.quest }),
  );
  if (!parsed.text || !dest) return tasks;
  const start: StartRow = { kind: "start", text: parsed.text, quest: dest };
  const add: StartRow = { kind: "add", text: parsed.text, quest: dest };
  if (a.mode === "add") {
    // Add mode: "Add only" always comes first, then the backlog row, then Start.
    return [add, { kind: "backlog", text: parsed.text, quest: dest }, start, ...tasks];
  }
  const create = [start, add];
  return parsed.tokenUsed || tasks.length === 0 ? [...create, ...tasks] : [...tasks, ...create];
}
