// Minutes per stage of one quest, from its sessions. Pure, no Obsidian imports. Never stored.
import { dur } from "./stats";

export interface StageWindow {
  index: number;
  started: string | null;
  reached: string | null;
}

/**
 * Sessions of one quest -> minutes per stage index plus the rest ("outside").
 * A session of a task in a stage counts for that stage; a loose task counts as outside. A session without a task, or
 * of a task that no longer exists, counts for the first stage whose window (🛫 to ✅, both inclusive) holds its day.
 */
export function stageMinutes(
  stages: StageWindow[],
  tasks: { id: string; stageIndex: number | null }[],
  sessions: { day: string; start: number; end: number; taskId: string }[],
): { byStage: Map<number, number>; outside: number } {
  const byStage = new Map<number, number>();
  for (const s of stages) byStage.set(s.index, 0);
  const stageOfTask = new Map<string, number | null>();
  for (const t of tasks) if (t.id && !stageOfTask.has(t.id)) stageOfTask.set(t.id, t.stageIndex);
  let outside = 0;
  for (const s of sessions) {
    const min = dur(s);
    let idx: number | null = null;
    if (s.taskId && stageOfTask.has(s.taskId)) idx = stageOfTask.get(s.taskId) ?? null;
    else idx = stages.find((w) => w.started !== null && w.started <= s.day && (w.reached === null || s.day <= w.reached))?.index ?? null;
    if (idx === null || !byStage.has(idx)) outside += min;
    else byStage.set(idx, (byStage.get(idx) ?? 0) + min);
  }
  return { byStage, outside };
}
