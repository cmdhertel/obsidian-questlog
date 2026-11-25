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
  /** Name of the stage the task belongs to; null = loose. Names can repeat, stageIndex is the key. */
  stage: string | null;
  stageIndex: number | null;
}

/** Minutes since midnight, end exclusive. */
export interface Span {
  start: number;
  end: number;
}

/** A `###` heading in the Stages section of a quest note. */
export interface Stage {
  /** Position in the section, the key of a stage. */
  index: number;
  /** Heading text without the markers; may be empty. */
  name: string;
  started: string | null;
  target: string | null;
  reached: string | null;
  /** 0-based line of the heading. */
  line: number;
  /** Line after the last line of the body (exclusive). */
  end: number;
}

/** `Vision.md`. */
export interface VisionNote {
  text: string;
  updated: string | null;
  /** Earlier versions, newest first. */
  earlier: { until: string; text: string }[];
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
  /** Document order; empty for Other and notes without a Stages section. */
  stages: Stage[];
  /** Days from the frontmatter. */
  created: string | null;
  checkedIn: string | null;
  paused: string | null;
  finished: string | null;
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
  /** Time that is not work, from the `breaks` frontmatter. */
  breaks: Span[];
  sessions: Session[];
}

export interface Review {
  path: string;
  week: string;
  answers: Record<string, string>;
}

export interface RunningTimer {
  /** Empty for a run on the quest itself, without a task (taskText is empty then, too). */
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

/** The last started work, kept in plugin data so it can be resumed. A quest-only run has an empty taskId and taskText. */
export interface LastWork {
  taskId: string;
  taskText: string;
  quest: string;
}
