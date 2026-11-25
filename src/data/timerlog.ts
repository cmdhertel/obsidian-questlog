import { splitByDay } from "./dates";
import type { RunningTimer } from "./model";
import type { SessionInput } from "./store";

/** Title of a piece of work: the task text, or the quest's display name when there is no task ("" or "—"). */
export function workTitle(taskText: string, questLabel: string): string {
  const text = taskText.trim();
  return text && text !== "—" ? text : questLabel;
}

/**
 * The sessions a stopped run is logged as, one per day piece (a run over midnight lands on both days).
 * Empty when the run is shorter than the minimum. `resolved` carries the live task text and quest,
 * which win over the stored ones in case the task or quest was renamed while running.
 */
export function runToSessions(
  run: RunningTimer,
  endMs: number,
  minSessionMinutes: number,
  resolved: { text?: string; quest?: string } = {},
): SessionInput[] {
  if (endMs - run.start < Math.max(minSessionMinutes * 60_000, 60_000)) return [];
  const taskText = resolved.text ?? run.taskText;
  const quest = resolved.quest ?? run.quest;
  return splitByDay(run.start, endMs)
    .filter((p) => p.end > p.start)
    .map((p) => ({ ...p, taskText, quest, taskId: run.taskId, note: run.note ?? "" }));
}
