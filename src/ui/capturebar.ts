// Capture bar (#28): on a phone, Start, Continue and Add sit at the bottom of the view, in thumb reach.
import { setIcon } from "obsidian";
import { captureBarState } from "../data/mobile";
import { t } from "../i18n";
import type { Ctx } from "./ctx";
import { act } from "./components";
import { continueTitle, onMobile, StartBox } from "./startbox";

export function captureBar(parent: HTMLElement, ctx: Ctx, focusTab: boolean): void {
  const { plugin } = ctx;
  const target = plugin.timer.continueTarget();
  const s = captureBarState({
    isMobile: onMobile(parent.doc),
    width: ctx.width,
    timerRunning: !!plugin.settings.timer,
    lastWork: target.kind === "none" ? null : continueTitle(target),
    focusTab,
  });
  if (!s.show) return;
  const bar = parent.createDiv({ cls: "ql-capturebar", attr: { role: "toolbar", "aria-label": t("capture.label") } });
  const btn = (cls: string, icon: string, label: string, onClick: () => void) => {
    const b = bar.createEl("button", { cls: `ql-capture-btn ${cls}` });
    setIcon(b.createSpan({ cls: "ql-capture-icon", attr: { "aria-hidden": "true" } }), icon);
    b.createSpan({ cls: "ql-capture-label", text: label });
    b.onclick = onClick;
    return b;
  };
  btn("is-start mod-cta", "play", t("capture.start"), () => new StartBox(plugin, "start").open());
  const cont = btn("is-continue", "rotate-ccw", t("capture.continue"), act(() => plugin.continueLast()));
  if (s.canContinue) {
    cont.setAttr("aria-label", t("capture.continueAria", { title: s.continueTitle }));
    cont.createSpan({ cls: "ql-capture-sub", text: s.continueTitle, attr: { "aria-hidden": "true" } });
  } else {
    cont.disabled = true;
    cont.setAttr("aria-label", t("capture.continueNone"));
  }
  btn("is-add", "plus", t("capture.add"), () => new StartBox(plugin, "add").open());
}
