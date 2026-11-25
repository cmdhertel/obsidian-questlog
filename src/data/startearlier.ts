/**
 * Latest end (minutes since midnight) among sessions that ended at or before `limitMin`;
 * 0 if none. Sessions ending later (overlapping the run) are ignored, so the boundary cannot
 * jump past the run's current start.
 */
export function lastEndBefore(sessions: { start: number; end: number }[], limitMin: number): number {
  let best = 0;
  for (const s of sessions) if (s.end <= limitMin && s.end > best) best = s.end;
  return best;
}

/**
 * Epoch ms of a minute-of-day on the day that starts at `midnightMs`. Built with setHours on a
 * Date, not `midnightMs + min * 60000`: on a DST day the latter is an hour off after the switch.
 */
export function minuteToMs(midnightMs: number, minute: number): number {
  const d = new Date(midnightMs);
  d.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return d.getTime();
}

export type StartClamp = "none" | "session" | "midnight" | "future";

/**
 * Limits a requested start: never in the future, never before midnight, never before the end of
 * the last session (`boundaryMin`, 0 = none). `clamped` names the limit that applied.
 * The boundary is a whole minute, so when it is the current minute the start may lie up to 59 s
 * before `nowMs` and is still valid. A boundary later than now cannot happen, but then the
 * result falls back to `nowMs` with "future".
 */
export function clampStart(
  requestedMs: number,
  nowMs: number,
  midnightMs: number,
  boundaryMin: number,
): { start: number; clamped: StartClamp } {
  const boundaryMs = boundaryMin > 0 ? minuteToMs(midnightMs, boundaryMin) : midnightMs;
  const floor = Math.max(midnightMs, boundaryMs);
  let start = requestedMs;
  let clamped: StartClamp = "none";
  if (start < floor) {
    start = floor;
    clamped = boundaryMs > midnightMs ? "session" : "midnight";
  }
  if (start > nowMs) {
    start = nowMs;
    clamped = "future";
  }
  return { start, clamped };
}

/** Local midnight of the day containing `ms`. */
export function midnightOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Clamp a requested start against today's logged sessions. `limitMs` is the point the start must
 * not pass: now for a new run, the run's current start for "Change start". `todaySessions` are
 * the sessions of the day containing `nowMs`.
 */
export function clampToday(
  requestedMs: number,
  nowMs: number,
  todaySessions: { start: number; end: number }[],
  limitMs: number,
): { start: number; clamped: StartClamp } {
  const midnight = midnightOf(nowMs);
  const limit = new Date(limitMs);
  const limitMin = limit.getHours() * 60 + limit.getMinutes();
  return clampStart(requestedMs, nowMs, midnight, lastEndBefore(todaySessions, limitMin));
}
