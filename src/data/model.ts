export type QuestStatus = "active" | "paused" | "done";

export interface Task {
  /** Stable id stored as `🆔 xxxxxx` on the task line (Tasks-plugin compatible). Empty until first needed. */
  id: string;
  text: string;
  done: boolean;
  /** "YYYY-MM-DD" from `✅ date`, if completed. */
  doneDate: string | null;
  /** 0-based line in the quest note. */
  line: number;
  questPath: string;
}

export interface Quest {
  path: string;
  /** File basename, used as the link target in logs. */
  name: string;
  /** "other" is the built-in inbox for everything that is not quest work. */
  kind: "quest" | "other";
  status: QuestStatus;
  color: string;
  /** Lucide icon name. */
  icon: string;
  /** Why this quest matters — the link to the vision (vertical coherence). */
  why: string;
  /** Planned input per week, in hours. 0 = no target. */
  weeklyHours: number;
  order: number;
  tasks: Task[];
}

export interface Session {
  day: string;
  /** Minutes since midnight. */
  start: number;
  end: number;
  taskText: string;
  /** Quest basename (link target). */
  quest: string;
  taskId: string;
  /** Free-text note written in Focus. */
  note: string;
  /** 0-based line in the day note. */
  line: number;
}

export interface DayLog {
  path: string;
  day: string;
  /** Planned task ids in order. */
  plan: string[];
  sessions: Session[];
}

export interface Review {
  path: string;
  week: string;
  answers: Record<string, string>;
}

export interface RunningTimer {
  taskId: string;
  taskText: string;
  quest: string;
  /** Epoch ms. */
  start: number;
  /** Time box in minutes; 0 or missing = open-ended. */
  box?: number;
  /** Session note, written to the session line when the timer stops. */
  note?: string;
}
