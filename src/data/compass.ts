// The soft compass: does the recent pace fit the target date of the current stage? Pure, no Obsidian imports.
import { addDays, daysBetween } from "./dates";

export interface CompassInput {
  today: string;
  /** 📅 of the stage. */
  target: string | null;
  /** 🛫 of the stage. */
  started: string | null;
  openTasks: number;
  /** doneDate of every done task in the stage. */
  doneDates: string[];
}

export type Compass =
  | null
  | { kind: "left"; daysLeft: number; pace: "fits" | "tight" | null; done: number; winDays: number }
  | { kind: "passed"; daysAgo: number };

/** Window of 28 days including today, or since 🛫 when the stage is younger. */
export const COMPASS_WINDOW = 28;
const MIN_DAYS = 7;
const MIN_DONE = 2;

export function compass(i: CompassInput): Compass {
  if (!i.target) return null;
  const daysLeft = daysBetween(i.today, i.target);
  if (daysLeft < 0) return { kind: "passed", daysAgo: -daysLeft };
  const full = addDays(i.today, -(COMPASS_WINDOW - 1));
  const winStart = i.started && i.started > full ? i.started : full;
  const winDays = daysBetween(winStart, i.today) + 1;
  const done = winDays > 0 ? i.doneDates.filter((d) => d >= winStart && d <= i.today).length : 0;
  const enough = winDays >= MIN_DAYS && done >= MIN_DONE;
  // Integer maths: open / (done / winDays) <= daysLeft.
  const pace = enough ? (i.openTasks * winDays <= done * daysLeft ? "fits" : "tight") : null;
  return { kind: "left", daysLeft, pace, done, winDays: Math.max(0, winDays) };
}
