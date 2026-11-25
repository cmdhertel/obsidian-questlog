// Capture bar on a phone (#28): which quick actions the bottom bar of the Questlog view shows. Pure.

export interface CaptureBarInput {
  /** Running in the mobile app (phone or tablet). */
  isMobile: boolean;
  width: "wide" | "mid" | "narrow";
  timerRunning: boolean;
  /** A title of the last work to continue, or null when there is none. */
  lastWork: string | null;
  /** The view shows the Focus tab. */
  focusTab: boolean;
}

export interface CaptureBarState {
  /** Show the bar at all. */
  show: boolean;
  /** "Continue" can be pressed (there is last work). */
  canContinue: boolean;
  /** Text for the continue button; empty when there is nothing to continue. */
  continueTitle: string;
}

/**
 * The bar shows in a narrow view on the mobile app, on every tab but Focus, and never together with the timer
 * bar (a running timer takes its place). Start and Add always work; Continue needs last work.
 */
export function captureBarState(a: CaptureBarInput): CaptureBarState {
  const show = a.isMobile && a.width === "narrow" && !a.focusTab && !a.timerRunning;
  const title = a.lastWork?.trim() ?? "";
  return { show, canContinue: show && !!title, continueTitle: show ? title : "" };
}
