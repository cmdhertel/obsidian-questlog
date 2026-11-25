// Backlog filter for the Plan board (#27): a quest chip and a plain-text search. Pure, no Obsidian imports.

/** Lower case without accents: "Café" -> "cafe". */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Words of a query; an empty list means "no filter". */
export function queryWords(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

/** True when every word of the query occurs in the task text or the quest name (plain substring, no regex). */
export function matchesQuery(text: string, questName: string, query: string): boolean {
  const words = queryWords(query);
  if (!words.length) return true;
  const hay = `${normalizeText(text)} ${normalizeText(questName)}`;
  return words.every((w) => hay.includes(w));
}

export interface BacklogItem {
  text: string;
  /** Quest name, also the chip id. */
  quest: string;
}

export interface BacklogFilter {
  /** Chip: one quest name, or null for "All". */
  quest: string | null;
  query: string;
}

/** True when a filter actually narrows the list. */
export function isFiltering(f: BacklogFilter): boolean {
  return f.quest !== null || queryWords(f.query).length > 0;
}

/** The items that pass the chip and the search, in their original order. */
export function filterBacklog<T extends BacklogItem>(items: T[], f: BacklogFilter): T[] {
  return items.filter((x) => (f.quest === null || x.quest === f.quest) && matchesQuery(x.text, x.quest, f.query));
}

/** The chip to keep: a chip whose quest has no backlog task left falls back to "All". */
export function validChip(chip: string | null, quests: string[]): string | null {
  return chip !== null && quests.includes(chip) ? chip : null;
}
