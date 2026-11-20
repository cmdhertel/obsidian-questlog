import { moment } from "obsidian";
import en from "./en";
import de from "./de";

export type Key = keyof typeof en;

const dictionaries: Record<string, Partial<Record<Key, string>>> = { en, de };

function lang(): string {
  const l = (moment.locale() || "en").toLowerCase();
  return l.split("-")[0] ?? "en";
}

/** Translate a key; `{name}` placeholders are filled from `vars`. Falls back to English. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = dictionaries[lang()]?.[key] ?? en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : s;
}

export function weekdayShort(day: Date): string {
  return t(`wd.short.${day.getDay()}` as Key);
}

/** The key's text in every language — used to read Markdown headings written under a different UI language. */
export function variants(key: Key): string[] {
  return [...new Set(Object.values(dictionaries).map((d) => d[key]).filter((x): x is string => !!x))];
}
