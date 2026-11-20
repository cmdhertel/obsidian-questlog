// Home: today. Quest work and Other (each with an add field), the done list, the backlog,
// and on wider panes a timeline of today next to the lists.
import { fmtHours, parseDay, weekDays } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import type { Task } from "../../data/model";
import { weeklyTargetHours } from "../../settings";
import { t } from "../../i18n";
import type { Ctx } from "../ctx";
import { QuestModal } from "../modals";
import { addTaskField, button, dropTarget, empty, pageHead, questIcon, questName, sectionHead, taskRow } from "../components";
import { renderTimeline } from "../timeline";

export function renderHome(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, today, state } = ctx;
  const todayMin = totalMinutes(store.sessions([today]));
  const weekQuestMin = totalMinutes(store.sessions(weekDays(today)).filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  const head = pageHead(el, parseDay(today).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }));
  const stats = head.createDiv({ cls: "ql-headstats" });
  headStat(stats, fmtHours(todayMin), t("home.today"));
  headStat(stats, target ? `${fmtHours(weekQuestMin)} / ${target}h` : fmtHours(weekQuestMin), t("home.week"));

  if (plugin.settings.vision.trim()) el.createDiv({ cls: "ql-vision", text: plugin.settings.vision.trim() });

  const grid = el.createDiv({ cls: "ql-home" });
  const main = grid.createDiv({ cls: "ql-home-main" });

  const planned = store.dayTasks(today, today);
  const own = new Set(store.days.get(today)?.plan ?? []);
  const hint = (x: Task) => (x.id && !own.has(x.id) ? t("plan.carried") : undefined);
  const active = store.activeQuests();

  // Quest work
  const qw = main.createDiv({ cls: "ql-card ql-section" });
  const questTasks = planned.filter((x) => store.questOf(x)?.kind === "quest");
  sectionHead(qw, t("home.questWork"), "target", questTasks.length ? String(questTasks.length) : undefined);
  const qList = qw.createDiv({ cls: "ql-list" });
  dropTarget(qList, ctx, today);
  for (const x of questTasks) taskRow(qList, ctx, x, { showQuest: true, day: today, hint: hint(x) });
  if (!active.length) {
    const e = empty(qList, t("home.noQuests"), "flag");
    button(e, t("quest.new"), () => new QuestModal(plugin).open(), { icon: "plus" });
  } else {
    if (!questTasks.length) empty(qList, t("home.questEmpty"), "target");
    addTaskField(qw, ctx, { quests: active, day: today, positions: true, stateKey: "home-quest" });
  }

  // Other
  const ot = main.createDiv({ cls: "ql-card ql-section ql-section-other" });
  const otherTasks = planned.filter((x) => store.questOf(x)?.kind === "other");
  sectionHead(ot, t("other.name"), "inbox", otherTasks.length ? String(otherTasks.length) : undefined);
  const oList = ot.createDiv({ cls: "ql-list" });
  dropTarget(oList, ctx, today);
  for (const x of otherTasks) taskRow(oList, ctx, x, { day: today, hint: hint(x) });
  if (!otherTasks.length) empty(oList, t("home.otherEmpty"), "inbox");
  addTaskField(ot, ctx, { quest: store.other, day: today, positions: true, placeholder: t("home.otherPlaceholder"), stateKey: "home-other" });

  // Done today
  const done = store.doneOn(today);
  const dn = main.createDiv({ cls: "ql-card ql-section ql-section-done" });
  sectionHead(dn, t("home.doneToday"), "check-circle-2", done.length ? String(done.length) : undefined);
  const dList = dn.createDiv({ cls: "ql-list" });
  if (done.length) for (const x of done) taskRow(dList, ctx, x, { showQuest: true, compact: true });
  else empty(dList, t("home.doneEmpty"), "check-circle-2");

  // Backlog by quest (collapsible)
  const backlog = store.backlog();
  if (backlog.length) {
    const open = state.expanded.has("home-backlog");
    const bl = main.createDiv({ cls: "ql-card ql-section ql-collapsible" + (open ? " is-open" : "") });
    const h = bl.createDiv({ cls: "ql-collapse-head", attr: { role: "button", tabindex: "0", "aria-expanded": String(open) } });
    sectionHead(h, t("home.backlog"), open ? "chevron-down" : "chevron-right", String(backlog.length));
    const toggle = () => {
      if (open) state.expanded.delete("home-backlog");
      else state.expanded.add("home-backlog");
      ctx.rerender();
    };
    h.onclick = toggle;
    h.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    if (open) {
      const list = bl.createDiv({ cls: "ql-list" });
      dropTarget(list, ctx, null);
      for (const q of store.workable()) {
        const tasks = backlog.filter((x) => x.questPath === q.path);
        if (!tasks.length) continue;
        const g = list.createDiv({ cls: "ql-group-head" });
        questIcon(g, q, "is-small");
        g.createSpan({ text: questName(q) });
        for (const x of tasks) taskRow(list, ctx, x, { day: null, compact: true });
      }
    }
  }

  // Timeline of today: beside the lists on wide panes, below them on medium ones.
  if (ctx.width !== "narrow") {
    const aside = grid.createDiv({ cls: "ql-home-aside" });
    const card = aside.createDiv({ cls: "ql-card ql-section" });
    sectionHead(card, t("home.timeline"), "clock", fmtHours(todayMin));
    renderTimeline(card, ctx, [today], { hourPx: 40 });
  }
}

function headStat(parent: HTMLElement, value: string, label: string): void {
  const s = parent.createDiv({ cls: "ql-headstat" });
  s.createSpan({ cls: "ql-headstat-value ql-mono", text: value });
  s.createSpan({ cls: "ql-headstat-label", text: label });
}
