import { describe, expect, it } from "vitest";
import { captureBarState } from "../src/data/mobile";

const base = { isMobile: true, width: "narrow" as const, timerRunning: false, lastWork: "Draft the Lisbon chapter", focusTab: false };

describe("capture bar", () => {
  it("shows on a narrow mobile view with continue", () => {
    expect(captureBarState(base)).toEqual({ show: true, canContinue: true, continueTitle: "Draft the Lisbon chapter" });
  });

  it("is hidden on desktop and on wider mobile panes", () => {
    expect(captureBarState({ ...base, isMobile: false }).show).toBe(false);
    expect(captureBarState({ ...base, width: "mid" }).show).toBe(false);
    expect(captureBarState({ ...base, width: "wide" }).show).toBe(false);
  });

  it("gives way to Focus and to a running timer", () => {
    expect(captureBarState({ ...base, focusTab: true }).show).toBe(false);
    expect(captureBarState({ ...base, timerRunning: true }).show).toBe(false);
  });

  it("disables continue without last work", () => {
    expect(captureBarState({ ...base, lastWork: null })).toEqual({ show: true, canContinue: false, continueTitle: "" });
    expect(captureBarState({ ...base, lastWork: "  " }).canContinue).toBe(false);
  });
});
