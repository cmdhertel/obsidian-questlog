import type { LastWork, Quest, Session, Task } from "./model";

/** Small view of the store, passed in so this module stays pure. */
export interface WorkLookup {
  /** Task by id, open or done; undefined if gone. */
  task(id: string): Task | undefined;
  /** Quest by basename; undefined if gone. */
  quest(name: string): Quest | undefined;
  /** The quest a task lives in. */
  questOf(task: Task): Quest | undefined;
  /** Active quest or Other. */
  isWorkable(quest: Quest): boolean;
}

export type ContinueTarget =
  | { kind: "task"; task: Task; quest: Quest }
  | { kind: "quest"; quest: Quest }
  | { kind: "none" };

const NONE: ContinueTarget = { kind: "none" };

function questOnly(name: string, lookup: WorkLookup): ContinueTarget {
  const quest = lookup.quest(name);
  return quest && lookup.isWorkable(quest) ? { kind: "quest", quest } : NONE;
}

/** An open task found by id takes its quest from the task; if that quest is not workable it is not startable. */
function byId(id: string, lookup: WorkLookup): ContinueTarget | null {
  const task = id ? lookup.task(id) : undefined;
  if (!task || task.done) return null;
  const quest = lookup.questOf(task);
  return quest && lookup.isWorkable(quest) ? { kind: "task", task, quest } : null;
}

/**
 * What "Continue last work" should start: the open task (live text and quest, by id), else the
 * stored quest without a task if workable, else "none" (callers open the Start box).
 */
export function resolveContinue(last: LastWork | null | undefined, lookup: WorkLookup): ContinueTarget {
  if (!last) return NONE;
  return byId(last.taskId, lookup) ?? questOnly(last.quest, lookup);
}

/**
 * Same for a logged session (calendar play button). Sessions without an id (hand-written lines)
 * match an open task of the same quest by exact text; otherwise the quest alone, if workable.
 */
export function resolveContinueSession(session: Session, lookup: WorkLookup): ContinueTarget {
  if (session.taskId) return byId(session.taskId, lookup) ?? questOnly(session.quest, lookup);
  const quest = lookup.quest(session.quest);
  if (!quest || !lookup.isWorkable(quest)) return NONE;
  const task = session.taskText ? quest.tasks.find((t) => !t.done && t.text === session.taskText) : undefined;
  return task ? { kind: "task", task, quest } : { kind: "quest", quest };
}
