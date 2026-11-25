// Home: the next step of a quest card. Pure.
import type { Task } from "./model";

/** First open task planned today for the quest, else the first open task of its current stage, else null. */
export function nextTaskFor(stageTasks: Task[], todayTasks: Task[]): Task | null {
  return todayTasks.find((x) => !x.done) ?? stageTasks.find((x) => !x.done) ?? null;
}
