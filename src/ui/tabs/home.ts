// Home: today, quests first. Header, vision, the ritual slot, one card per active quest (next step and
// play), the quest add field, Other (folded), Done today, the backlog, and on wider panes a timeline.
import { fmtHours, isoWeek, parseDay, weekDays } from "../../data/dates";
import { totalMinutes } from "../../data/stats";
import type { Quest, Session, Task } from "../../data/model";
import { currentStage } from "../../data/stages";
import { nextTaskFor } from "../../data/home";
import { questFocusTasks } from "../../data/rituals";
import { isOn, weeklyTargetHours } from "../../settings";
import { fmtDate, t } from "../../i18n";
import type { Ctx } from "../ctx";
import { QuestModal } from "../modals";
import { addTaskField, bar, button, dropTarget, empty, pageHead, playButton, questIcon, questName, sectionHead, taskRow } from "../components";
import { renderTimeline } from "../timeline";
import { compassLine, stageLabel } from "../stagepath";
import { weekDotsView } from "../dots";
import { renderRitualSlot } from "../ritual";

/** Enter and Space act like a click on a `role="button"` element. */
function keyToggle(el: HTMLElement, toggle: () => void): void {
  el.onkeydown = (e) => {
    if (e.target !== el) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };
}

function toggler(ctx: Ctx, key: string): () => void {
  return () => {
    if (ctx.state.expanded.has(key)) ctx.state.expanded.delete(key);
    else ctx.state.expanded.add(key);
    ctx.rerender();
  };
}

export function renderHome(el: HTMLElement, ctx: Ctx): void {
  const { store, plugin, today, state } = ctx;
  const todayMin = totalMinutes(store.sessions([today]));
  const weekSessions = store.sessions(weekDays(today));
  const weekQuestMin = totalMinutes(weekSessions.filter((s) => store.isQuestWork(s.quest)));
  const target = weeklyTargetHours(plugin.settings, store.quests);

  // 1. Header
  const head = pageHead(el, fmtDate(parseDay(today), { weekday: "long", day: "numeric", month: "long" }));
  const stats = head.createDiv({ cls: "ql-headstats" });
  headStat(stats, fmtHours(todayMin), t("home.today"));
  headStat(stats, target ? `${fmtHours(weekQuestMin)} / ${target}h` : fmtHours(weekQuestMin), t("home.week"));

  // 2. Vision
  const vision = isOn(plugin.settings, "vision") ? store.visionText() : "";
  if (vision) el.createDiv({ cls: "ql-vision", text: vision });

  // 3. Ritual line or card (#18); collapses when empty.
  renderRitualSlot(el, ctx);

  const grid = el.createDiv({ cls: "ql-home" });
  const main = grid.createDiv({ cls: "ql-home-main" });

  const planned = store.dayTasks(today, today);
  const own = new Set(store.days.get(today)?.plan ?? []);
  const hint = (x: Task) => (x.id && !own.has(x.id) ? t("plan.carried") : undefined);
  const active = store.activeQuests();

  // 4. Quest cards, 5. the add field below them
  if (!active.length) {
    const box = main.createDiv({ cls: "ql-card ql-section" });
    const e = empty(box, t("home.noQuests"), "flag");
    button(e, t("quest.new"), () => new QuestModal(plugin).open(), { icon: "plus" });
  } else {
    const allSessions = store.allSessions();
    const cards = main.createDiv({ cls: "ql-hcards" });
    for (const q of active) {
      const mine = allSessions.filter((s) => s.quest === q.name);
      const weekMin = totalMinutes(weekSessions.filter((s) => s.quest === q.name));
      questCard(cards, ctx, q, planned.filter((x) => x.questPath === q.path), weekMin, mine, hint);
    }
    const add = main.createDiv({ cls: "ql-home-add" });
    addTaskField(add, ctx, { quests: active, day: today, positions: true, stateKey: "home-quest", placeholder: t("home.addQuestTask") });
  }

  // 6. Other, folded by default
  const otherTasks = planned.filter((x) => store.questOf(x)?.kind === "other");
  const otherOpen = state.expanded.has("home-other");
  const ot = main.createDiv({ cls: "ql-card ql-section ql-section-other ql-collapsible" + (otherOpen ? " is-open" : "") });
  const oh = ot.createDiv({
    cls: "ql-collapse-head",
    attr: { role: "button", tabindex: "0", "aria-expanded": String(otherOpen), "aria-label": t("home.otherCount", { n: otherTasks.length }) },
  });
  sectionHead(oh, t("other.name"), otherOpen ? "chevron-down" : "chevron-right", String(otherTasks.length));
  oh.onclick = toggler(ctx, "home-other");
  keyToggle(oh, toggler(ctx, "home-other"));
  dropTarget(ot, ctx, today);
  if (otherOpen) {
    const oList = ot.createDiv({ cls: "ql-list" });
    for (const x of otherTasks) taskRow(oList, ctx, x, { day: today, hint: hint(x) });
    if (!otherTasks.length) empty(oList, t("home.otherEmpty"), "inbox");
    addTaskField(ot, ctx, { quest: store.other, day: today, positions: true, placeholder: t("home.otherPlaceholder"), stateKey: "home-other" });
  }

  // 7. Done today
  const done = store.doneOn(today);
  const dn = main.createDiv({ cls: "ql-card ql-section ql-section-done" });
  sectionHead(dn, t("home.doneToday"), "check-circle-2", done.length ? String(done.length) : undefined);
  const dList = dn.createDiv({ cls: "ql-list" });
  if (done.length) for (const x of done) taskRow(dList, ctx, x, { showQuest: true, compact: true });
  else empty(dList, t("home.doneEmpty"), "check-circle-2");

  // 8. Backlog by quest (collapsible)
  const backlog = store.backlog();
  if (backlog.length) {
    const open = state.expanded.has("home-backlog");
    const bl = main.createDiv({ cls: "ql-card ql-section ql-collapsible" + (open ? " is-open" : "") });
    const h = bl.createDiv({ cls: "ql-collapse-head", attr: { role: "button", tabindex: "0", "aria-expanded": String(open) } });
    sectionHead(h, t("home.backlog"), open ? "chevron-down" : "chevron-right", String(backlog.length));
    h.onclick = toggler(ctx, "home-backlog");
    keyToggle(h, toggler(ctx, "home-backlog"));
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

  // 9. Timeline of today: beside the lists on wide panes, below them on medium ones.
  if (ctx.width !== "narrow") {
    const aside = grid.createDiv({ cls: "ql-home-aside" });
    const card = aside.createDiv({ cls: "ql-card ql-section" });
    sectionHead(card, t("home.timeline"), "clock", fmtHours(todayMin));
    renderTimeline(card, ctx, [today], { hourPx: 40 });
  }
}

/**
 * One active quest: name, play, stage, week hours, compass and dots, then the next step. Tapping the
 * summary unfolds the rest of today's tasks of the quest (`home-card:<path>`).
 */
function questCard(parent: HTMLElement, ctx: Ctx, q: Quest, todayTasks: Task[], weekMin: number, sessions: Session[], hint: (x: Task) => string | undefined): void {
  const { store, state, today, plugin } = ctx;
  const key = `home-card:${q.path}`;
  const open = state.expanded.has(key);
  const next = nextTaskFor(questFocusTasks(q), todayTasks);
  const rest = todayTasks.filter((x) => x !== next && !x.done);

  const c = parent.createDiv({ cls: "ql-hcard" + (open ? " is-open" : "") });
  c.style.setProperty("--ql-color", q.color);
  const toggle = toggler(ctx, key);

  const summary = c.createDiv({ cls: "ql-hcard-summary" });
  summary.onclick = toggle;
  const top = summary.createDiv({ cls: "ql-hcard-top" });
  const head = top.createDiv({
    cls: "ql-hcard-head",
    attr: { role: "button", tabindex: "0", "aria-expanded": String(open), "aria-label": t("home.cardUnfold", { quest: q.name }) },
  });
  keyToggle(head, toggle);
  questIcon(head, q);
  const title = head.createDiv({ cls: "ql-hcard-title" });
  title.createDiv({ cls: "ql-hcard-name", text: q.name });
  const stages = isOn(plugin.settings, "stages") && q.stages.length > 0;
  const cur = stages ? currentStage(q.stages) : null;
  if (stages) {
    title.createDiv({
      cls: "ql-hcard-stage",
      text: cur ? t("quest.stageOf", { i: cur.index + 1, n: q.stages.length, name: stageLabel(cur) }) : t("stage.allReached"),
    });
  }
  playButton(top, ctx, { kind: "quest", quest: q }, { running: plugin.timer.isRunningForQuest(q.name), cls: "ql-hcard-play" });

  const meta = summary.createDiv({ cls: "ql-hcard-meta" });
  const weekTarget = store.weekTarget(q, isoWeek(today));
  const w = meta.createDiv({ cls: "ql-hcard-week" });
  w.createSpan({ cls: "ql-mono", text: weekTarget ? `${fmtHours(weekMin)} / ${weekTarget}h` : fmtHours(weekMin) });
  if (weekTarget) bar(w, weekMin, weekTarget * 60, q.color);
  if (cur) compassLine(meta, ctx, q, cur, { actions: false });
  weekDotsView(meta, ctx, q, sessions);
  if (!open && rest.length) meta.createDiv({ cls: "ql-hcard-more", text: t("home.moreToday", { n: rest.length }) });

  const body = c.createDiv({ cls: "ql-list ql-hcard-next" });
  if (next) {
    const day = todayTasks.includes(next) ? today : store.scheduledDay(next, today);
    taskRow(body, ctx, next, { showQuest: false, day, hint: todayTasks.includes(next) ? hint(next) : undefined });
  } else {
    const none = body.createDiv({ cls: "ql-hcard-none" });
    none.createSpan({ text: t("home.nothingPlanned") });
    playButton(none, ctx, { kind: "quest", quest: q }, { text: true, running: plugin.timer.isRunningForQuest(q.name) });
  }
  if (open) for (const x of rest) taskRow(body, ctx, x, { showQuest: false, day: today, hint: hint(x) });
  dropTarget(c, ctx, today);
}

function headStat(parent: HTMLElement, value: string, label: string): void {
  const s = parent.createDiv({ cls: "ql-headstat" });
  s.createSpan({ cls: "ql-headstat-value ql-mono", text: value });
  s.createSpan({ cls: "ql-headstat-label", text: label });
}
