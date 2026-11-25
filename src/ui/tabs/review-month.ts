// Monthly review (#24): the stages reached this month; the frame shows hours against plan and last month.
import { fmtHours, parseDay } from "../../data/dates";
import { stagesReachedIn } from "../../data/review-month";
import { stageMinutes } from "../../data/stagehours";
import { monthlyQuestions } from "../../settings";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { empty, questIcon, sectionHead } from "../components";
import { stageLabel } from "../stagepath";
import type { PeriodConfig, PeriodInfo } from "./review-periods";

function reached(ctx: Ctx, info: PeriodInfo) {
  return stagesReachedIn(ctx.store.quests, info.range);
}

export const MONTH: PeriodConfig = {
  questions: monthlyQuestions,
  compare: true,
  doneList: true,
  summary: (ctx, info) => ({ stages_reached: reached(ctx, info).length }),
  extras(el, ctx, info) {
    const { store } = ctx;
    const list = reached(ctx, info);
    const card = el.createDiv({ cls: "ql-card ql-section" });
    sectionHead(card, t("review.stagesReached"), "milestone", list.length ? String(list.length) : undefined);
    if (!list.length) {
      empty(card, t("review.stagesNone"), "milestone");
      return;
    }
    const all = store.allSessions();
    const ul = card.createEl("ul", { cls: "ql-reached" });
    for (const s of list) {
      const q = store.quest(s.quest);
      if (!q) continue;
      const min = stageMinutes(q.stages, q.tasks, all.filter((x) => x.quest === q.name)).byStage.get(s.index) ?? 0;
      const li = ul.createEl("li", { cls: "ql-reached-row" });
      li.style.setProperty("--ql-color", q.color);
      const n = li.createDiv({ cls: "ql-reached-name" });
      questIcon(n, q, "is-small");
      n.createSpan({ text: q.name });
      n.createSpan({ cls: "ql-muted", text: "·" });
      const stage = q.stages.find((x) => x.index === s.index);
      n.createSpan({ cls: "ql-reached-stage", text: stage ? stageLabel(stage) : s.name });
      const m = li.createDiv({ cls: "ql-reached-meta ql-small ql-muted" });
      m.createSpan({ text: fmtDate(parseDay(s.reached), { day: "numeric", month: "short" }) });
      m.createSpan({ cls: "ql-mono", text: fmtHours(min) });
    }
  },
};
