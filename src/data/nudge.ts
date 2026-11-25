/** Choices of the "Remind me after" setting, in minutes of activity. 0 = off. */
export const NUDGE_OPTIONS = [0, 10, 15, 20, 30, 45];

/** Counts the calendar minutes with activity. In memory only, never stored. */
export class ActivityCounter {
  private count = 0;
  private lastMinute = -1;
  private day = "";

  /** Call on every activity event; it counts once per calendar minute and starts over on a new day. */
  note(nowMs: number, day: string): void {
    if (day !== this.day) {
      this.count = 0;
      this.lastMinute = -1;
      this.day = day;
    }
    const minute = Math.floor(nowMs / 60_000);
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.count++;
  }

  reset(): void {
    this.count = 0;
    this.lastMinute = -1;
  }

  get minutes(): number {
    return this.count;
  }
}

/** Whether the status bar should say "No timer". Pure. */
export function nudgeDue(i: {
  minutes: number;
  nudgeMinutes: number;
  running: boolean;
  plannedQuestTasks: number;
  mobile: boolean;
}): boolean {
  return !i.mobile && !i.running && i.nudgeMinutes > 0 && i.minutes >= i.nudgeMinutes && i.plannedQuestTasks > 0;
}
