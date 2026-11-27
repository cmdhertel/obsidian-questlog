// The smoke steps. Each step is { name, issue, run(ctx), each?, timeout?, shot? }.
//
// How to add a step (later issues append theirs at the end of `steps`):
//   1. Add an object to `steps` below. `issue` names the issue that added it ("#10", ...).
//   2. `run(ctx)` throws to fail. Helpers: ctx.c.ev(code) runs async code in Obsidian (`P` is the plugin,
//      `R()` the Questlog view element, `sleep(ms)`; use `return` for results), wait(ctx, expr, what),
//      ctx.c.key(...), tab(ctx, "plan"), clickIn(ctx, selector, textRegex?).
//   3. `each: true` repeats the step at all three sizes and in both languages; the default runs it once
//      (desktop, English). A screenshot <step>-<size>-<lang>.png is taken after every step (`shot: false` skips it).
//   4. Console errors during a step fail it. Texts in German: match both languages, e.g. /Start|Starten/.
//   Run only yours: npm run smoke -- --only my-step
import { setViewport, sleep } from "./cdp.mjs";

const PRE = `const P=app.plugins.plugins.questlog; const R=()=>app.workspace.getLeavesOfType("questlog-view")[0]?.view.contentEl; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const timer=()=>P.settings.timer;`;
const ev = (ctx, body, ms) => ctx.c.ev(`${PRE}\n${body}`, ms);

/** Poll an expression in the page (with the P / R() / timer() helpers) until it is truthy. */
export function wait(ctx, expr, what, ms = 8000) {
  return ctx.c.waitFor(`(async()=>{${PRE}\n return await (${expr});})()`, what, ms);
}

export const TABS = ["home", "plan", "calendar", "focus", "quests", "review"];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Open a Questlog tab and wait until it has content. */
export async function tab(ctx, id) {
  await ev(ctx, `await P.openView(${JSON.stringify(id)}); await sleep(500);`);
  await wait(ctx, `(()=>{const r=app.workspace.getLeavesOfType("questlog-view")[0]?.view.contentEl; return r && r.textContent.trim().length>20})()`, `the ${id} tab`);
}

/** Click the first element matching `selector` (optionally with text matching `re`) inside the view or the page. */
export async function clickIn(ctx, selector, re, scope = "R()") {
  const ok = await ev(
    ctx,
    `const root=${scope}||document; const re=${re ? re.toString() : "null"}; const el=[...root.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0&&(!re||re.test(e.textContent+" "+(e.getAttribute("aria-label")||"")))); if(!el) return false; el.click(); return true;`,
  );
  assert(ok, `no ${selector}${re ? " " + re : ""} to click`);
  await sleep(500);
}

/**
 * Page code that drops leftover dialogs. Removing a modal's element leaves its keymap scope active, and Obsidian then
 * blurs every focus outside that modal (Keymap.onFocusIn), so the scopes are popped too. The trust-vault dialog of a
 * fresh profile is the usual case.
 */
const DROP_MODALS = `document.querySelectorAll(".modal-container,.prompt,.menu").forEach((n) => n.remove());
  { const km = app.keymap, st = km.getWindowStack?.(window); for (let i = 0; st && st.scope && st.scope !== km.rootScope && i < 10; i++) km.popScope(st.scope); }`;

const modalCount = (ctx) => ev(ctx, `return document.querySelectorAll(".modal-container").length`);

// ---------------------------------------------------------------- app helpers (used by smoke.mjs)

/** Language is per profile: stored in the app's local storage, applied on reload. Keep it in this one function. */
export async function setLanguage(ctx, lang) {
  await ctx.c.ev(`localStorage.setItem("language", ${JSON.stringify(lang)}); setTimeout(()=>location.reload(), 50); return 1`);
  await sleep(1500);
  await wait(ctx, `window.app && app.workspace && app.workspace.layoutReady`, "Obsidian to reload", 60000);
}

/** Make sure community plugins run and Questlog is enabled (a fresh profile starts in restricted mode). */
export async function enablePlugin(ctx) {
  await ctx.c.ev(`
    if (!app.plugins.plugins.questlog) {
      await app.plugins.setEnable(true);
      await app.plugins.enablePlugin("questlog");
    }
    app.setting?.close?.();
    ${DROP_MODALS}
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    return !!app.plugins.plugins.questlog;`, 30000);
  await wait(ctx, `app.plugins.plugins.questlog?.store?.quests?.length > 0`, "Questlog to load the demo quests", 20000);
}

/** Back to a known state before each step: no modal, no timer, no notices. */
export async function resetState(ctx) {
  for (let i = 0; i < 3 && (await modalCount(ctx)); i++) {
    await ctx.c.key("Escape", "Escape", 27);
    await sleep(250);
  }
  await ev(ctx, `${DROP_MODALS} document.querySelectorAll(".notice,.tooltip").forEach(n=>n.remove()); if (timer()) await P.timer.discard(); app.workspace.getLeavesOfType("questlog-view").forEach(l=>l.detach()); await sleep(300);`);
}

/**
 * Phone emulation is a precheck only (the real phone test is #29). Obsidian's own emulation is internal, and
 * `hover: none` cannot be emulated over CDP, so the touch rules are injected as always-on styles.
 */
export async function setPhone(ctx, on) {
  // Switching Obsidian's emulation reloads the page: switch, wait for the reload, then inject the touch rules.
  const changed = await ctx.c.ev(
    `const was=document.body.classList.contains("is-mobile"); if (was !== ${on}) setTimeout(()=>{ try { app.emulateMobile?.(${on}); } catch {} }, 50); return was !== ${on};`,
  );
  if (changed) {
    await sleep(2000);
    await wait(ctx, `window.app && app.workspace && app.workspace.layoutReady && app.plugins.plugins.questlog?.store?.quests?.length > 0`, "Obsidian after the emulation switch", 60000);
  }
  await ctx.c.ev(
    `
    document.getElementById("smoke-touch")?.remove();
    if (${on}) {
      const css = await app.vault.adapter.read(app.vault.configDir + "/plugins/questlog/styles.css");
      const s = document.createElement("style"); s.id = "smoke-touch";
      s.textContent = css.replace(/@media\\s*\\(hover:\\s*none\\)/g, "@media all");
      document.head.appendChild(s);
    }
    return 1`,
  );
  await sleep(500);
}

/** The text of every note under Questlog/, to put back after a step that writes. */
async function snapshot(ctx) {
  return ev(ctx, `const out={}; for (const f of app.vault.getMarkdownFiles()) if (f.path.startsWith("Questlog/")) out[f.path]=await app.vault.read(f); return out;`);
}

/** Put the notes back as `snap` had them and delete notes the step created. */
async function restore(ctx, snap) {
  await ev(ctx, `const snap=${JSON.stringify(snap)};
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith("Questlog/")) continue;
      if (!(f.path in snap)) await app.vault.delete(f);
      else if ((await app.vault.read(f)) !== snap[f.path]) await app.vault.modify(f, snap[f.path]);
    }
    await sleep(700);`);
}

/** Run a Questlog command and wait for the ritual card on Home. */
async function openRitual(ctx, command) {
  await ev(ctx, `app.commands.executeCommandById("questlog:${command}"); await sleep(700);`);
  await wait(ctx, `R()?.querySelector(".ql-ritual-card")`, `the ${command} card`);
}

/** Click a button in the open ritual card by its text. */
const cardButton = (ctx, re) => clickIn(ctx, ".ql-ritual-card .ql-ritual-actions button", re);

/** Fill a field like a person typing: value, then an input event. */
const typeInto = (ctx, selector, text) =>
  ev(ctx, `const el=R().querySelector(${JSON.stringify(selector)}); el.focus(); el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event("input",{bubbles:true})); el.blur(); await sleep(200); return true;`);

// ---------------------------------------------------------------- steps

export const steps = [
  {
    name: "plugin-enabled",
    issue: "smoke",
    run: async (ctx) => {
      assert(await ev(ctx, `return !!P && P.store.quests.length === 3`), "plugin not loaded with the three demo quests");
      await tab(ctx, "home");
      assert(await ev(ctx, `return !!R()`), "view did not open");
    },
  },

  ...TABS.map((id) => ({
    name: `tab-${id}`,
    issue: "smoke",
    each: true,
    run: async (ctx) => {
      await tab(ctx, id);
      await sleep(400);
      const overflow = await ev(ctx, `const r=R(); return r.scrollWidth > r.clientWidth + 1`);
      assert(!overflow, "content is wider than the view");
    },
  })),

  {
    name: "timer-start-stop",
    issue: "smoke",
    run: async (ctx) => {
      await tab(ctx, "plan");
      await clickIn(ctx, ".ql-task-play");
      await wait(ctx, `app.plugins.plugins.questlog.settings.timer`, "the timer to start");
      await sleep(1200);
      await clickIn(ctx, ".ql-play.is-live, .ql-task-play.is-live");
      await wait(ctx, `!app.plugins.plugins.questlog.settings.timer`, "the timer to stop");
    },
  },

  {
    name: "start-box",
    issue: "block 1",
    run: async (ctx) => {
      const word = await ev(ctx, `return P.store.allTasks().find(x=>!x.done).text.split(" ")[0]`);
      await ev(ctx, `app.commands.executeCommandById("questlog:quick-start")`);
      await wait(ctx, `document.querySelector(".prompt-input")`, "the Start box");
      await ctx.c.send("Input.insertText", { text: word });
      await wait(ctx, `document.querySelector(".suggestion-item")`, "a suggestion");
      await ctx.shot("start-box");
      await ctx.c.key("Enter", "Enter", 13);
      await wait(ctx, `app.plugins.plugins.questlog.settings.timer`, "the timer to start from the Start box");
      assert(await ev(ctx, `return timer().taskText.startsWith(${JSON.stringify(word)})`), "started a different task than the one typed");
    },
  },

  {
    name: "continue-last-work",
    issue: "block 1",
    run: async (ctx) => {
      await ev(ctx, `await P.timer.start(P.store.allTasks().find(x=>!x.done)); await P.timer.discard(); await sleep(300)`);
      await ev(ctx, `app.commands.executeCommandById("questlog:continue-last")`);
      await wait(ctx, `app.plugins.plugins.questlog.settings.timer`, "Continue to start the timer");
      await tab(ctx, "focus");
      assert(await ev(ctx, `return !!R().querySelector(".ql-focus-state") && /running|läuft/i.test(R().textContent)`), "focus tab does not show the running timer");
    },
  },

  {
    name: "play-buttons",
    issue: "block 1",
    run: async (ctx) => {
      let seen = 0;
      for (const id of ["home", "plan", "calendar", "quests"]) {
        await tab(ctx, id);
        const has = await ev(ctx, `return [...R().querySelectorAll(".ql-task-play, .ql-play")].some(e=>e.getBoundingClientRect().width>0 && !e.classList.contains("is-live"))`);
        if (!has) continue;
        seen++;
        await clickIn(ctx, ".ql-task-play:not(.is-live), .ql-play:not(.is-live)");
        await wait(ctx, `app.plugins.plugins.questlog.settings.timer`, `the play button on ${id} to start the timer`);
        await ev(ctx, `await P.timer.discard()`);
      }
      assert(seen >= 2, `only ${seen} tab(s) had a play button`);
    },
  },

  {
    name: "start-earlier",
    issue: "block 1",
    run: async (ctx) => {
      await tab(ctx, "focus");
      await wait(ctx, `R().querySelector(".ql-start-earlier .ql-chip-btn")`, "the start-earlier chips");
      await clickIn(ctx, ".ql-start-earlier .ql-chip-btn");
      await wait(ctx, `app.plugins.plugins.questlog.settings.timer`, "the timer to start earlier");
      const ago = await ev(ctx, `return Math.round((Date.now() - timer().start) / 60000)`);
      assert(ago >= 1 && ago <= 5, `timer started ${ago} min ago, expected up to 5`);
    },
  },

  {
    name: "add-task",
    issue: "smoke",
    run: async (ctx) => {
      await tab(ctx, "plan");
      const before = await ev(ctx, `return P.store.allTasks().length`);
      await ev(ctx, `app.commands.executeCommandById("questlog:add-task")`);
      await wait(ctx, `document.querySelector(".prompt-input")`, "the add-task box");
      await ctx.c.send("Input.insertText", { text: "Smoke test task" });
      await sleep(400);
      await ctx.c.key("Enter", "Enter", 13);
      await wait(ctx, `P.store.allTasks().some(x=>x.text==="Smoke test task")`, "the new task");
      assert((await ev(ctx, `return P.store.allTasks().length`)) === before + 1, "task count did not grow by one");
    },
  },

  {
    name: "quest-page",
    issue: "smoke",
    run: async (ctx) => {
      await tab(ctx, "quests");
      await clickIn(ctx, ".ql-qcard", /Travel book/);
      await wait(ctx, `R().querySelector(".ql-qdetail")?.textContent.includes("Travel book")`, "the quest page");
    },
  },

  {
    name: "modals",
    issue: "smoke",
    run: async (ctx) => {
      const closeAll = async (what) => {
        const b = await ev(ctx, `const b=document.querySelector(".modal-header-button, .modal-close-button"); if(b){b.click(); return true} return false`);
        if (!b) await ctx.c.key("Escape", "Escape", 27);
        await wait(ctx, `document.querySelectorAll(".modal-container").length===0`, `${what} to close`);
      };
      await ev(ctx, `app.commands.executeCommandById("questlog:quick-start")`);
      await wait(ctx, `document.querySelectorAll(".modal-container").length===1`, "the Start box");
      await closeAll("the Start box");
      await tab(ctx, "quests");
      await clickIn(ctx, "button", /New quest|Neue Quest|Neues Quest/);
      await wait(ctx, `document.querySelectorAll(".modal-container").length===1`, "the quest modal");
      await closeAll("the quest modal");
      await tab(ctx, "focus");
      await ev(ctx, `app.commands.executeCommandById("questlog:add-task")`);
      await wait(ctx, `document.querySelectorAll(".modal-container").length===1`, "the add-task box");
      await closeAll("the add-task box");
    },
  },

  // ---------------------------------------------------------------- block 1 fixes
  {
    name: "start-box-backlog",
    issue: "#5",
    run: async (ctx) => {
      await ev(ctx, String.raw`app.commands.executeCommandById("questlog:add-task")`);
      await wait(ctx, `document.querySelector(".prompt-input")`, "the add-task box");
      await ctx.c.send("Input.insertText", { text: "Backlog smoke task" });
      await wait(ctx, `document.querySelector(".suggestion-item.is-backlog, .suggestion-item .is-backlog")`, "the backlog row");
      await ctx.shot("start-box-backlog");
      await ev(ctx, String.raw`document.querySelector(".suggestion-item.is-backlog, .suggestion-item .is-backlog").closest(".suggestion-item").click()`);
      await wait(ctx, `P.store.allTasks().some(x=>x.text==="Backlog smoke task")`, "the backlog task");
      assert(await ev(ctx, String.raw`const x=P.store.allTasks().find(x=>x.text==="Backlog smoke task"); return P.store.scheduledDay(x)===null && !timer()`), "the task was scheduled or started");
    },
  },
  {
    name: "time-box-announces-again",
    issue: "#9",
    run: async (ctx) => {
      const notices = await ev(ctx, String.raw`
        const task=P.store.allTasks().find(x=>!x.done); const seen=[];
        for (let i=0;i<2;i++){ await P.timer.start(task,{box:1,startedAt:Date.now()-90000}); P.timer.checkBox(); P.timer.checkBox(); await sleep(200);
          seen.push(document.querySelectorAll(".notice").length); document.querySelectorAll(".notice").forEach(n=>n.remove()); await P.timer.discard(); }
        return seen;`);
      assert(notices[0] === 1 && notices[1] === 1, `announcements per run: ${notices}`);
    },
  },

  // ---------------------------------------------------------------- honest time
  {
    name: "gaps",
    issue: "#10",
    run: async (ctx) => {
      const day = await ev(ctx, String.raw`const d=new Date(); d.setDate(d.getDate()-1); const p=n=>String(n).padStart(2,"0"); const day=d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
        const x=P.store.allTasks().find(x=>!x.done); const path="Questlog/Days/"+day+".md";
        const text="---\ntype: questlog-day\ndate: "+day+"\nplan: ["+x.id+"]\nmine: keep me\n---\n\n## Sessions\n- 09:00–10:00 One · [[Garden]]\n- 11:00–12:00 Two · [[Garden]]\n";
        const f=app.vault.getAbstractFileByPath(path); if(f) await app.vault.modify(f,text); else await app.vault.create(path,text);
        await sleep(800); return day;`);
      await ev(ctx, String.raw`await P.openView("calendar"); await sleep(600); window.smokeDay=${JSON.stringify(day)};`);
      // Monday: yesterday is in the week before.
      if (!(await ev(ctx, String.raw`return !!R().querySelector(".ql-cal-gap")`))) await clickIn(ctx, "button, .clickable-icon", /previous|vorherig|zurück/i);
      const gaps = await ev(ctx, String.raw`const now=new Date(); return [...R().querySelectorAll(".ql-cal-col")].map(c=>({today:c.classList.contains("is-today"),gaps:[...c.querySelectorAll(".ql-cal-gap")].map(g=>({edge:g.classList.contains("is-edge"),empty:g.classList.contains("is-empty"),label:g.getAttribute("aria-label")}))})).filter(c=>c.gaps.length)`);
      const y = gaps.find((g) => !g.today);
      assert(y && y.gaps.length === 3, `gaps of yesterday: ${JSON.stringify(gaps)}`);
      assert(y.gaps.filter((g) => g.edge).length === 2, "two of the three gaps should be faint");
      assert(gaps.length <= 2, "only today and yesterday have gaps");
      await ctx.shot("gaps");
      await ev(ctx, `document.body.classList.replace("theme-dark","theme-light"); await sleep(300)`);
      await ctx.shot("gaps-light");
      await ev(ctx, `document.body.classList.replace("theme-light","theme-dark"); await sleep(200)`);
      // Fill the middle one with a suggestion.
      await clickIn(ctx, ".ql-cal-gap:not(.is-edge):not(.is-empty)", /10:00/);
      await wait(ctx, `document.querySelector(".ql-gap-chip")`, "the suggestions");
      await ctx.shot("gap-dialog");
      const times = await ev(ctx, String.raw`return [...document.querySelectorAll(".modal input[type=time]")].map(x=>x.value)`);
      assert(times.join() === "10:00,11:00", `prefilled ${times}`);
      await ev(ctx, String.raw`document.querySelector(".ql-gap-chip").click(); await sleep(200); document.querySelector(".modal .mod-cta").click()`);
      await wait(ctx, `P.store.sessions([smokeDay]).length===3`, "the filled session");
      // Mark the morning as not work time.
      await wait(ctx, `![...R().querySelectorAll(".ql-cal-gap")].some(g=>/10:00 (to|bis) 11:00/.test(g.getAttribute("aria-label")))`, "the filled gap to disappear");
      await clickIn(ctx, ".ql-cal-gap.is-edge", /(06:00|6:00).*(09:00|9:00)/);
      await wait(ctx, `document.querySelector(".modal")`, "the dialog");
      await ev(ctx, String.raw`[...document.querySelectorAll(".modal button")].find(b=>/Not work time|Keine Arbeit/i.test(b.textContent)).click()`);
      await wait(ctx, `P.store.breaksOf(smokeDay).length===1`, "the break");
      await wait(ctx, `!document.querySelector(".modal")`, "the dialog to close");
      const note = await ev(ctx, String.raw`return await app.vault.read(app.vault.getAbstractFileByPath("Questlog/Days/"+smokeDay+".md"))`);
      assert(/06:00-09:00/.test(note) && /mine: keep me/.test(note), `break not written as expected: ${note}`);
      await wait(ctx, `![...R().querySelectorAll(".ql-cal-gap")].some(g=>/06:00 (to|bis) 09:00/.test(g.getAttribute("aria-label")))`, "the break to hide its gap");
      // An entry we cannot read survives the next break.
      await ev(ctx, String.raw`const f=app.vault.getAbstractFileByPath("Questlog/Days/"+smokeDay+".md"); await app.fileManager.processFrontMatter(f,m=>{m.breaks=["lunch",...m.breaks]}); await sleep(500); await P.store.addBreak(smokeDay,{start:1200,end:1320}); await sleep(500)`);
      const after = await ev(ctx, String.raw`return await app.vault.read(app.vault.getAbstractFileByPath("Questlog/Days/"+smokeDay+".md"))`);
      assert(/lunch/.test(after) && /06:00-09:00/.test(after) && /20:00-22:00/.test(after), `breaks after the second one: ${after}`);
    },
    timeout: 40000,
  },
  {
    name: "gap-empty-day",
    issue: "#10",
    run: async (ctx) => {
      await ev(ctx, String.raw`const f=app.vault.getAbstractFileByPath("Questlog/Days/"+smokeDay+".md"); await app.vault.modify(f,"---\ntype: questlog-day\ndate: "+smokeDay+"\n---\n\n## Sessions\n"); await sleep(800); await P.openView("calendar"); await sleep(500)`);
      if (!(await ev(ctx, String.raw`return [...R().querySelectorAll(".ql-cal-col:not(.is-today) .ql-cal-gap.is-empty")].length===1`))) await clickIn(ctx, "button, .clickable-icon", /previous|vorherig|zurück/i);
      await wait(ctx, `R().querySelectorAll(".ql-cal-col:not(.is-today) .ql-cal-gap").length===1`, "one Nothing logged row for yesterday");
      await ctx.shot("gap-empty");
      await ev(ctx, String.raw`R().querySelector(".ql-cal-col:not(.is-today) .ql-cal-gap").click()`);
      await wait(ctx, `document.querySelector(".modal")`, "the dialog");
      await ev(ctx, String.raw`[...document.querySelectorAll(".modal button")].find(b=>/Not work time|Keine Arbeit/i.test(b.textContent)).click()`);
      await wait(ctx, `R().querySelectorAll(".ql-cal-col:not(.is-today) .ql-cal-gap").length===0`, "the row to disappear");
    },
  },
  {
    name: "nudge",
    issue: "#11",
    run: async (ctx) => {
      const before = await ev(ctx, String.raw`return JSON.stringify(Object.keys(await P.loadData()??{}).sort())`);
      const status = `document.querySelector(".status-bar-item.plugin-questlog")?.textContent.trim()`;
      const r = await ev(ctx, String.raw`
        const old=P.settings.nudgeMinutes, out={};
        const task=P.store.allTasks().find(x=>!x.done && P.store.questOf(x).kind==="quest"); await P.store.moveToDay(task,P.today(),"top"); await sleep(400);
        const real=Date.now; let shift=0; Date.now=()=>real()+shift;
        const txt=()=>${status};
        try {
          P.settings.nudgeMinutes=10; P.resetActivity();
          for(let i=0;i<9;i++){ shift=i*60000; window.dispatchEvent(new PointerEvent("pointermove")); }
          for(let i=0;i<5;i++) window.dispatchEvent(new KeyboardEvent("keydown",{key:"Shift"}));
          P.tick(); out.nine=txt(); out.count=P.activity.minutes;
          shift=40*60000; P.tick(); out.idle=txt();
          window.dispatchEvent(new PointerEvent("pointermove")); P.tick(); out.ten=txt(); out.label=document.querySelector(".status-bar-item.plugin-questlog").getAttribute("aria-label");
          P.settings.nudgeMinutes=0; P.tick(); out.off=txt(); P.settings.nudgeMinutes=10; P.tick(); out.again=txt();
        } finally { Date.now=real; }
        await P.timer.start(task); P.tick(); out.run=txt(); out.countRun=P.activity.minutes;
        await P.timer.discard(); P.tick(); out.after=txt(); P.settings.nudgeMinutes=old; return out;`);
      assert(r.count === 9 && !/No timer|Kein Timer/i.test(r.nine), `after nine minutes: ${JSON.stringify(r)}`);
      assert(!/No timer|Kein Timer/i.test(r.idle), "idle time counted");
      assert(/No timer|Kein Timer/i.test(r.ten) && /No timer|Kein Timer/i.test(r.again) && !/No timer|Kein Timer/i.test(r.off), `nudge: ${JSON.stringify(r)}`);
      assert(/⏱/.test(r.run) && r.countRun === 0 && !/No timer|Kein Timer/i.test(r.after), `timer did not reset the nudge: ${JSON.stringify(r)}`);
      const after = await ev(ctx, String.raw`return JSON.stringify(Object.keys(await P.loadData()??{}).sort())`);
      assert(before === after || JSON.parse(after).every((k) => k in {} || !/activ|minute(?!s)/i.test(k)), `data.json keys changed: ${before} ${after}`);
    },
  },

  // ---------------------------------------------------------------- foundation
  {
    name: "stages",
    issue: "#1",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const path="Questlog/Quests/Travel book.md", f=app.vault.getAbstractFileByPath(path);
        const before=await app.vault.read(f); const q=P.store.quest("Travel book");
        const names=q.stages.map(s=>s.name);
        const id=await P.store.addTask(q,"Task for the stage"); await sleep(600);
        const x=P.store.task(id); const after=await app.vault.read(f);
        const added=after.split("\n").filter(l=>!before.split("\n").includes(l));
        await P.store.updateQuest(P.store.quest("Travel book"),{status:"paused"}); await sleep(600); const paused=await app.vault.read(f);
        await P.store.updateQuest(P.store.quest("Travel book"),{status:"done"}); await sleep(600); const done=await app.vault.read(f);
        await P.store.updateQuest(P.store.quest("Travel book"),{status:"active"}); await sleep(600); const active=await app.vault.read(f);
        const g=P.store.quest("Garden");
        return {names,stage:x.stage,added,paused:/^paused: \d{4}/m.test(paused),done:/^finished: \d{4}/m.test(done),active:!/^(paused|finished):/m.test(active),old:[g.paused,g.finished,g.checkedIn]};`);
      assert(r.names.join() === "Research,Drafting,Editing", `stages ${r.names}`);
      assert(r.stage === "Drafting" && r.added.length === 1, `task landed in ${r.stage}; new lines ${JSON.stringify(r.added)}`);
      assert(r.paused && r.done && r.active, `dates: ${JSON.stringify(r)}`);
      assert(r.old.every((v) => v === null), `quest without dates: ${JSON.stringify(r.old)}`);
    },
  },
  {
    name: "stages-crlf",
    issue: "#1",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const path="Questlog/Quests/Windows.md";
        const text=["---","type: quest","status: active","---","","## Stages","### Alpha","- [ ] First 🆔 w1","","## Tasks","- [ ] Loose 🆔 w2",""].join("\r\n");
        await app.vault.create(path,text); await sleep(900); const q=P.store.quest("Windows"); const tasks=q.tasks.map(x=>x.text+"|"+x.stage);
        await P.store.addTask(q,"Second"); await P.store.setTaskDone?.(P.store.task("w1"),true); await sleep(500);
        const c=await app.vault.read(app.vault.getAbstractFileByPath(path)); await app.fileManager.trashFile(app.vault.getAbstractFileByPath(path)); await sleep(500);
        return {tasks,lf:c.replace(/\r\n/g,"").includes("\n"),has:/Second/.test(c)};`);
      assert(r.tasks.join() === "First|Alpha,Loose|null", `tasks ${r.tasks}`);
      assert(!r.lf && r.has, "LF-only lines in a CRLF note");
    },
  },
  {
    name: "vision-migration",
    issue: "#2",
    run: async (ctx) => {
      const read = `const V=async()=>await app.vault.read(app.vault.getAbstractFileByPath("Questlog/Vision.md"));`;
      const a = await ev(ctx, String.raw`${read} const f=app.vault.getAbstractFileByPath("Questlog/Vision.md"); const old=await V(); P.settings.vision="From the setting"; const res=await P.store.migrateVision(); const same=(await V())===old; const shown=P.store.visionText();
        P.settings.vision=""; await app.fileManager.trashFile(f); await sleep(600); P.settings.vision="From the setting"; const res2=await P.store.migrateVision(); await sleep(500);
        return {res,same,shown,res2,text:P.store.visionText(),setting:P.settings.vision,note:await V()};`);
      assert(a.res === "skipped" && a.same && /^A finished/.test(a.shown), `existing note: ${JSON.stringify(a)}`);
      assert(a.res2 === "created" && a.text === "From the setting" && a.setting === "" && /From the setting/.test(a.note), `migration: ${JSON.stringify(a)}`);
      await tab(ctx, "home");
      const t0 = Date.now();
      await ev(ctx, String.raw`const f=app.vault.getAbstractFileByPath("Questlog/Vision.md"); await app.vault.process(f,c=>c.replace("From the setting","Edited by hand"))`);
      await wait(ctx, `R().querySelector(".ql-vision")?.textContent==="Edited by hand"`, "the hand edit on Home", 3000);
      assert(Date.now() - t0 < 1500, `hand edit took ${Date.now() - t0} ms`);
    },
  },
  {
    name: "vision-dialog",
    issue: "#2",
    each: true,
    run: async (ctx) => {
      // Newer Obsidian opens its settings in a window of their own: look in whichever document they are in.
      const D = `const D=()=>app.setting.activeTab?.containerEl.ownerDocument??document; const top=()=>[...D().querySelectorAll(".modal")].pop(); const input=()=>D().querySelector(".ql-vision-input");`;
      const button = (re) => `[...app.setting.activeTab.containerEl.querySelectorAll("button")].find(b=>${re}.test(b.textContent))`;
      const open = async () => {
        await ev(ctx, String.raw`app.setting.open(); app.setting.openTabById("questlog")`);
        await wait(ctx, button("/Edit vision|Vision bearbeiten/"), "the settings");
        await ev(ctx, `${button("/Edit vision|Vision bearbeiten/")}.click()`);
        await wait(ctx, `(()=>{${D} return input()})()`, "the vision dialog");
      };
      const type = (text) => `${D} const a=input(); a.value=${JSON.stringify(text)}; a.dispatchEvent(new Event("input"));`;
      const save = async (text, keep) => {
        await open();
        await ev(ctx, `${type(text)} const b=D().querySelector(".ql-vision-keep input"); if(b.checked!==${keep}) b.click(); top().querySelector(".mod-cta").click()`);
        await wait(ctx, `(()=>{${D} return !input()})()`, "the dialog to close");
        await sleep(400);
        return ev(ctx, `return await app.vault.read(app.vault.getAbstractFileByPath("Questlog/Vision.md"))`);
      };
      await open();
      await ctx.shot("vision-open");
      await ev(ctx, `${D} [...top().querySelectorAll("button")].find(b=>/^(Cancel|Abbrechen)$/.test(b.textContent)).click(); await sleep(300)`);
      const before = await ev(ctx, `return P.store.visionText()`);
      const one = await save("Second text\n## with a heading", true);
      const entry = one.split(/^## (?:Earlier|Früher)$/m)[1] ?? "";
      assert(/^### (until|bis) \d{4}-\d\d-\d\d$/m.test(entry) && entry.includes(before), `archive: ${one}`);
      assert((await ev(ctx, `return P.store.visionText()`)) === "Second text\n## with a heading", "heading text did not round-trip");
      const two = await save("Third text", false);
      assert(/Third text/.test(two) && !/Second text/.test(two) && two.includes(entry), `replace only: ${two}`);
      // A failing write keeps the dialog and the typed text.
      await open();
      const kept = await ev(ctx, `const old=P.store.saveVision; P.store.saveVision=async()=>{throw new Error("smoke: failing write")}; ${type("Precious")} top().querySelector(".mod-cta").click(); await sleep(400); delete P.store.saveVision; return input()?.value`);
      assert(kept === "Precious", "a failed save lost the text");
      assert((await ev(ctx, `return P.store.visionText()`)) === "Third text", "a failed save changed the note");
      ctx.c.takeErrors?.();
      await ev(ctx, `${D} [...top().querySelectorAll("button")].find(b=>/^(Cancel|Abbrechen)$/.test(b.textContent)).click(); await sleep(300)`);
      await ev(ctx, `document.querySelectorAll(".notice").forEach(n=>n.remove()); ${button("/Open note|Notiz öffnen/")}.click(); await sleep(1000)`);
      assert(await ev(ctx, `return app.workspace.getActiveFile()?.path==="Questlog/Vision.md"`), "the note did not open");
      assert(await ev(ctx, `return !app.setting.activeTab?.containerEl.isConnected`), "the settings stayed in front of the note");
    },
    timeout: 60000,
  },

  // ---------------------------------------------------------------- remaining acceptance criteria
  {
    name: "play-follows-quest-state",
    issue: "#8",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const out={}; const today=P.today();
        await P.store.addSession({day:today,start:1,end:61,taskText:"Gone task",quest:"Garden",taskId:null,note:""}); await sleep(600);
        const look=async()=>{ await P.openView("calendar"); await sleep(500); const b=[...R().querySelectorAll(".ql-cal-col.is-today .ql-cal-block")].find(b=>/Gone task/.test(b.textContent)); const cal=!!b?.querySelector(".ql-play");
          await P.openView("quests"); await sleep(500); const c=[...R().querySelectorAll(".ql-qcard")].find(c=>/Garden/.test(c.textContent)); return {cal, block:!!b, card:!!c?.querySelector(".ql-qcard-play")}; };
        out.active=await look();
        [...R().querySelectorAll(".ql-qcard")].find(c=>/Garden/.test(c.textContent)).querySelector(".ql-qcard-play").click(); await sleep(500);
        out.run=timer()&&[timer().quest,timer().taskId]; out.stayed=!!R().querySelector(".ql-qcard"); out.live=!!R().querySelector(".ql-qcard-play.is-live");
        await P.timer.discard(); await sleep(300);
        for (const st of ["paused","done"]) { await P.store.updateQuest(P.store.quest("Garden"),{status:st}); await sleep(600); out[st]=await look(); }
        await P.store.updateQuest(P.store.quest("Garden"),{status:"active"}); await sleep(500);
        [...R().querySelectorAll(".ql-qcard")].find(c=>/Garden/.test(c.textContent)).click(); await sleep(400); out.opened=!R().querySelector(".ql-qcard") && /Garden/.test(R().textContent);
        return out;`);
      assert(r.active.cal && r.active.card, `active: ${JSON.stringify(r)}`);
      assert(r.run && r.run[0] === "Garden" && !r.run[1] && r.stayed && r.live, `card play: ${JSON.stringify(r)}`);
      assert(r.paused.block && !r.paused.cal && !r.paused.card && !r.done.cal && !r.done.card, `paused/done: ${JSON.stringify(r)}`);
      assert(r.opened, "a tap on the card did not open the quest");
    },
    timeout: 40000,
  },
  {
    name: "continue-cases",
    issue: "#7",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const out={}; const run=async()=>{app.commands.executeCommandById("questlog:continue-last"); await sleep(600)};
        const x=P.store.allTasks().find(x=>!x.done&&P.store.questOf(x).name==="Garden")??P.store.task(await P.store.addTask(P.store.quest("Garden"),"Garden smoke"));
        await P.timer.start(P.store.task(x.id)); out.saved=(await P.loadData()).lastWork?.taskId===x.id; await run(); out.same=timer()?.taskId===x.id; await P.timer.discard();
        await run(); out.open=timer()?.taskId===x.id; await P.timer.discard();
        await P.store.setDone(P.store.task(x.id),true); await sleep(600); await run(); for(let i=0;i<20&&!timer();i++) await sleep(200); out.done=timer()?[timer().quest,timer().taskId]:"no timer; box "+!!document.querySelector(".prompt-input")+"; last "+JSON.stringify(P.settings.lastWork)+"; notices "+[...document.querySelectorAll(".notice")].map(n=>n.textContent); await P.timer.discard();
        await P.store.updateQuest(P.store.quest("Garden"),{status:"paused"}); await sleep(600); await run(); out.paused=!timer()&&!!document.querySelector(".prompt-input"); 
        document.querySelector(".prompt-input")?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); document.querySelector(".modal-bg")?.click(); await sleep(300);
        out.playHidden=!document.querySelector(".status-bar-item.plugin-questlog svg")||getComputedStyle(document.querySelector(".status-bar-item.plugin-questlog")).display==="none";
        await P.store.updateQuest(P.store.quest("Garden"),{status:"active"}); await sleep(600);
        await P.store.updateQuest(P.store.quest("Garden"),{name:"Allotment"}); await sleep(1200); out.rename=P.settings.lastWork?.quest;
        await P.store.updateQuest(P.store.quest("Allotment"),{name:"Garden"}); await sleep(1200); out.back=P.settings.lastWork?.quest;
        return out;`);
      assert(r.saved && r.same && r.open, `open task: ${JSON.stringify(r)}`);
      assert(Array.isArray(r.done) && r.done[0] === "Garden" && !r.done[1], `done task: ${JSON.stringify(r)}`);
      assert(r.paused && r.playHidden, `paused quest: ${JSON.stringify(r)}`);
      assert(r.rename === "Allotment" && r.back === "Garden", `rename: ${JSON.stringify(r)}`);
    },
    timeout: 40000,
  },
  {
    name: "start-limits",
    issue: "#9",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const out={}; const now=new Date(), m=now.getHours()*60+now.getMinutes(); const x=P.store.allTasks().find(x=>!x.done);
        if(m<40) return {skip:true};
        await P.store.addSession({day:P.today(),start:m-30,end:m-4,taskText:"Earlier",quest:"Garden",taskId:null,note:""}); await sleep(600);
        await P.openView("focus"); await sleep(400); const chips=[...R().querySelectorAll(".ql-start-earlier .ql-chip-btn")]; chips[chips.length-1].click(); await sleep(600);
        const s=new Date(timer().start); out.start=s.getHours()*60+s.getMinutes()-(m-4); out.notice=[...document.querySelectorAll(".notice")].some(n=>/\d\d:\d\d/.test(n.textContent));
        out.change=[...R().querySelectorAll("button")].some(b=>/Change start|Beginn ändern|Start ändern/i.test(b.textContent));
        P.settings.timer.start-=86400000; P.refreshViews(); await sleep(400); out.changeOld=[...R().querySelectorAll("button")].some(b=>/Change start|Beginn ändern|Start ändern/i.test(b.textContent)); P.settings.timer.start+=86400000;
        await P.timer.stop(); await sleep(600); out.logged=P.store.sessions([P.today()]).some(s=>s.start===m-4);
        return out;`);
      if (r.skip) return;
      assert(r.start === 0 && r.notice, `clamp: ${JSON.stringify(r)}`);
      assert(r.change && !r.changeOld, `change start: ${JSON.stringify(r)}`);
      assert(r.logged, `logged: ${JSON.stringify(r)}`);
    },
    timeout: 30000,
  },
  {
    name: "nudge-windows",
    issue: "#11",
    run: async (ctx) => {
      const r = await ev(ctx, String.raw`
        const out={}; const wait=ms=>sleep(ms); P.settings.nudgeMinutes=10; P.resetActivity();
        const leaf=app.workspace.openPopoutLeaf(); await leaf.setViewState({type:"questlog-view",active:true}); await wait(1500);
        const win=leaf.view.containerEl.ownerDocument.defaultView; out.other=win!==window; P.resetActivity();
        win.dispatchEvent(new win.PointerEvent("pointermove")); out.popout=P.activity.minutes;
        out.vision=!!leaf.view.contentEl.querySelector(".ql-vision")||leaf.view.contentEl.textContent.length>20;
        P.resetActivity(); const mtime=(await app.vault.adapter.stat(app.vault.configDir+"/plugins/questlog/data.json")).mtime;
        for(let i=0;i<5;i++) window.dispatchEvent(new PointerEvent("pointermove")); P.tick(); await wait(1500); out.unsaved=mtime===(await app.vault.adapter.stat(app.vault.configDir+"/plugins/questlog/data.json")).mtime;
        // Only Other planned, then nothing planned.
        const day=P.today(); for(const x of P.store.dayTasks(day,day)) await P.store.moveToDay(x,null); await wait(600);
        const real=Date.now; let k=0; Date.now=()=>real()+k*60000; const fill=()=>{P.resetActivity(); for(let i=0;i<12;i++){k++; window.dispatchEvent(new PointerEvent("pointermove"));} P.tick(); return document.querySelector(".status-bar-item.plugin-questlog")?.textContent.trim()};
        try { out.none=fill(); out.planned=P.store.dayTasks(day,day).length;
          const id=await P.store.addTask(P.store.other,"Other smoke"); await wait(600); await P.store.moveToDay(P.store.task(id),day); await wait(600); out.otherPlanned=P.store.dayTasks(day,day).length; out.otherOnly=fill(); } finally { Date.now=real; }
        leaf.detach(); await wait(500); P.settings.nudgeMinutes=15;
        const old=P; await app.plugins.disablePlugin("questlog"); const before=old.activity.minutes; const n2=Date.now; Date.now=()=>n2()+99*60000; window.dispatchEvent(new PointerEvent("pointermove")); Date.now=n2; out.unload=old.activity.minutes===before;
        await app.plugins.enablePlugin("questlog"); await wait(1500); return out;`);
      assert(r.other && r.popout === 1 && r.vision, `pop-out: ${JSON.stringify(r)}`);
      assert(r.unsaved, "activity was written to data.json");
      assert(r.planned === 0 && !r.none && r.otherPlanned === 1 && !r.otherOnly, `planned: ${JSON.stringify(r)}`);
      assert(r.unload, "listeners survived unload");
    },
    timeout: 40000,
  },

  // ---------------------------------------------------------------- stages and story
  {
    name: "stage-path",
    issue: "#13",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "quests");
      await clickIn(ctx, ".ql-qcard", /Travel book/);
      await wait(ctx, `R().querySelector(".ql-path")`, "the stage path");
      const r = await ev(ctx, String.raw`
        const v=R(), body=v.querySelector(".ql-body"), cur=v.querySelector(".ql-stage.is-current");
        return {
          nodes:[...v.querySelectorAll(".ql-stage-node")].map(n=>(n.className.match(/is-(\w+)/)||[])[1]).join(),
          cur:cur?.querySelector(".ql-stage-name")?.textContent||"",
          rows:cur?.querySelectorAll(".ql-task").length||0,
          add:!!cur?.querySelector("input[data-add-key]"),
          compass:cur?.querySelector(".ql-compass")?.textContent||"",
          folded:[...v.querySelectorAll(".ql-stage:not(.is-current) button.ql-stage-toggle")].every(b=>b.getAttribute("aria-expanded")==="false"),
          loose:[...v.querySelectorAll(".ql-section-title")].some(e=>/Loose tasks|Lose Aufgaben/.test(e.textContent)),
          overflow:body.scrollWidth-body.clientWidth,
          warn:!!v.querySelector(".ql-warn"),
        };`);
      assert(r.nodes === "reached,current,upcoming", `nodes ${r.nodes}`);
      assert(r.cur.startsWith("Drafting") && r.rows >= 2 && r.add, `current stage: ${JSON.stringify(r)}`);
      assert(/\d/.test(r.compass), `no compass: ${JSON.stringify(r)}`);
      assert(r.folded && r.loose, `folds: ${JSON.stringify(r)}`);
      assert(r.overflow <= 1, `page scrolls sideways by ${r.overflow}px`);
      assert(!r.warn, "a warning colour is used");
      // Unfold a reached stage: its done tasks show.
      await clickIn(ctx, "button.ql-stage-toggle", /Research|Recherche/);
      await wait(ctx, `R().querySelector(".ql-stage.is-reached.is-open .ql-task.is-done")`, "the done tasks of Research");
    },
  },
  {
    name: "quest-story",
    issue: "#16",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "quests");
      await clickIn(ctx, ".ql-qcard", /Travel book/);
      const before = await ev(ctx, `return (await app.vault.adapter.stat("Questlog/Quests/Travel book.md")).mtime`);
      await clickIn(ctx, ".ql-seg-btn", /Story|Geschichte/);
      await wait(ctx, `R().querySelector(".ql-story-week")`, "the story");
      const r = await ev(ctx, String.raw`
        const v=R(), weeks=[...v.querySelectorAll(".ql-story-week")];
        return {n:weeks.length, first:weeks[0]?.querySelector("h3")?.textContent||"",
          reached:v.textContent.includes("Research"), overflow:v.querySelector(".ql-body").scrollWidth-v.querySelector(".ql-body").clientWidth,
          mtime:(await app.vault.adapter.stat("Questlog/Quests/Travel book.md")).mtime};`);
      assert(r.n >= 2 && r.n <= 8, `chapters: ${r.n}`);
      assert(/^(Week|Woche) \d+ · /.test(r.first), `chapter title ${r.first}`);
      assert(r.reached, "the reached stage is missing from the story");
      assert(r.overflow <= 1, `page scrolls sideways by ${r.overflow}px`);
      assert(r.mtime === before, "the story wrote to the quest note");
    },
  },
  {
    name: "week-dots",
    issue: "#15",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "quests");
      const r = await ev(ctx, String.raw`
        const c=[...R().querySelectorAll(".ql-qcard")].find(e=>e.textContent.includes("Travel book"));
        const dots=[...c.querySelectorAll(".ql-dot-week")];
        return {n:dots.length, current:dots.filter(d=>d.classList.contains("is-current")).length, labels:dots.every(d=>d.getAttribute("aria-label")),
          text:c.querySelector(".ql-dots-text")?.textContent||"", stage:c.querySelector(".ql-qcard-stage")?.textContent||""};`);
      assert(r.n >= 2 && r.n <= 12 && r.current === 1 && r.labels, `dots: ${JSON.stringify(r)}`);
      assert(/\d/.test(r.text), `dots text: ${r.text}`);
      assert(/Drafting/.test(r.stage), `stage line: ${r.stage}`);
    },
  },
  {
    name: "stage-edit",
    issue: "#13",
    run: async (ctx) => {
      const path = "Questlog/Quests/Travel book.md";
      const before = await ev(ctx, `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`);
      try {
        await tab(ctx, "quests");
        await clickIn(ctx, ".ql-qcard", /Travel book/);
        await clickIn(ctx, "button.ql-stage-add");
        await wait(ctx, `document.querySelectorAll(".modal-container").length===1`, "the stage dialog");
        await ctx.c.send("Input.insertText", { text: "Proofing" });
        await sleep(300);
        await ctx.c.key("Enter", "Enter", 13);
        await wait(ctx, `P.store.quest("Travel book").stages.some(s=>s.name==="Proofing")`, "the new stage");
        await wait(ctx, `document.activeElement?.classList.contains("ql-stage-add")`, "focus back on Add stage");
        const r = await ev(ctx, String.raw`
          const f=app.vault.getAbstractFileByPath(${JSON.stringify(path)}); const q=()=>P.store.quest("Travel book"); const out={};
          try { await P.store.addStage(q(),"research"); out.dup="written"; } catch(e) { out.dup=e.message; }
          const drafting=q().stages.find(s=>s.name==="Drafting"); const open=q().tasks.filter(x=>!x.done&&x.stageIndex===drafting.index).map(x=>x.id);
          await P.store.reachStage(q(),drafting,"next"); await sleep(600);
          out.moved=open.every(id=>P.store.task(id)?.stage==="Editing");
          out.editing=q().stages.find(s=>s.name==="Editing"); out.text=await app.vault.read(f);
          const loose=P.store.task(open[0]); await P.store.moveTaskToStage(loose,"loose"); await sleep(500); out.loose=P.store.task(open[0])?.stage;
          await P.store.deleteStage(q(),q().stages.find(s=>s.name==="Proofing")); await sleep(500);
          out.deleted=!/### Proofing/.test(await app.vault.read(f)); out.count=q().tasks.length;
          return out;`);
        assert(/exists|existiert|gibt es/i.test(r.dup), `duplicate name: ${r.dup}`);
        assert(r.moved && r.editing?.started && !r.editing?.reached, `reach: ${JSON.stringify(r)}`);
        assert(/### Drafting.*✅/.test(r.text), "Drafting has no ✅");
        assert(r.loose === null && r.deleted, `loose/delete: ${JSON.stringify(r)}`);
      } finally {
        await ev(ctx, `await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), ${JSON.stringify(before)}); await sleep(600);`);
      }
    },
  },
  // ---------------------------------------------------------------- Home and rituals
  {
    name: "home-cards",
    issue: "#17",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "home");
      const r = await ev(ctx, String.raw`
        const v=R(), cards=[...v.querySelectorAll(".ql-hcard")], body=v.querySelector(".ql-body");
        const other=v.querySelector(".ql-section-other .ql-collapse-head");
        return {
          cards:cards.length, active:P.store.activeQuests().length,
          names:cards.map(c=>c.querySelector(".ql-hcard-name")?.textContent).join(),
          play:cards.every(c=>c.querySelector(".ql-hcard-play")),
          heads:cards.every(c=>c.querySelector(".ql-hcard-head[role=button][aria-expanded]")),
          next:cards.filter(c=>c.querySelector(".ql-hcard-next .ql-task, .ql-hcard-none")).length,
          dots:cards.some(c=>c.querySelector(".ql-dot-week")),
          lines:v.querySelectorAll(".ql-ritual-line").length,
          otherFolded:other?.getAttribute("aria-expanded")==="false", otherRows:v.querySelectorAll(".ql-section-other .ql-task").length,
          order:[".ql-vision",".ql-hcards",".ql-section-other",".ql-section-done"].map(s=>v.querySelector(s)).every((e,i,a)=>e&&(!i||a[i-1].compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)),
          overflow:body.scrollWidth-body.clientWidth, warn:!!v.querySelector(".ql-warn"),
        };`);
      assert(r.cards === r.active && r.cards >= 2, `cards: ${JSON.stringify(r)}`);
      assert(r.play && r.heads && r.next === r.cards && r.dots, `card parts: ${JSON.stringify(r)}`);
      assert(r.lines <= 1, `${r.lines} ritual lines`);
      assert(r.otherFolded && r.otherRows === 0, `Other is not folded: ${JSON.stringify(r)}`);
      assert(r.order, "Home is not in the order vision, quests, Other, Done");
      assert(r.overflow <= 1, `page scrolls sideways by ${r.overflow}px`);
      assert(!r.warn, "a warning colour is used");
      // Unfold a card and Other with the keyboard, fold them again.
      const keyOn = (sel) => ev(ctx, `const el=R().querySelector(${JSON.stringify(sel)}); el.focus(); el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); await sleep(400); return R().querySelector(${JSON.stringify(sel)})?.getAttribute("aria-expanded");`);
      assert((await keyOn(".ql-hcard-head")) === "true", "Enter does not unfold a quest card");
      assert((await keyOn(".ql-hcard-head")) === "false", "Enter does not fold a quest card");
      assert((await keyOn(".ql-section-other .ql-collapse-head")) === "true", "Enter does not unfold Other");
      assert(await ev(ctx, `return !!R().querySelector(".ql-section-other input[data-add-key]")`), "Other has no add field");
      assert((await keyOn(".ql-section-other .ql-collapse-head")) === "false", "Enter does not fold Other");
    },
  },
  {
    name: "ritual-line",
    issue: "#18",
    run: async (ctx) => {
      const saved = await ev(ctx, `return JSON.stringify(P.settings.rituals)`);
      try {
        await tab(ctx, "home");
        // Nothing opens by itself: no card without a command or a click.
        assert(!(await ev(ctx, `return !!R().querySelector(".ql-ritual-card")`)), "a ritual card opened by itself");
        const line = await ev(ctx, `return R().querySelector(".ql-ritual-line")?.textContent||""`);
        if (line) {
          await clickIn(ctx, ".ql-ritual-line button", /Not now|Nicht jetzt/);
          await wait(ctx, `!R().querySelector(".ql-ritual-line") || R().querySelector(".ql-ritual-line").textContent!==${JSON.stringify(line)}`, "the line to go");
          assert(await ev(ctx, `return Object.values(P.settings.rituals).some(v=>v)`), "Not now was not remembered");
        }
        // A command opens the card at any time; Not now on the card closes it.
        await openRitual(ctx, "ritual-start-day");
        assert(await ev(ctx, `const c=R().querySelector(".ql-ritual-card"); return c.getAttribute("role")==="region" && !!c.getAttribute("aria-label") && document.activeElement===c`), "the card is not a focused region");
        await cardButton(ctx, /Not now|Nicht jetzt/);
        await wait(ctx, `!R().querySelector(".ql-ritual-card")`, "the card to close");
      } finally {
        await ev(ctx, `P.settings.rituals=JSON.parse(${JSON.stringify(saved)}); await P.saveSettings(); P.refreshViews(); await sleep(300);`);
      }
    },
  },
  {
    name: "ritual-start-day",
    issue: "#19",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        await openRitual(ctx, "ritual-start-day");
        const rows = await ev(ctx, `return R().querySelectorAll(".ql-ritual-card .ql-ritual-row").length`);
        assert(rows >= 2, `start card rows: ${rows}`);
        await clickIn(ctx, ".ql-ritual-card .ql-ritual-row input[type=radio]");
        assert(await ev(ctx, `const b=R().querySelector(".ql-ritual-go"); return !!b && !b.classList.contains("is-hidden") && /“|„/.test(b.textContent)`), "no Start button for the one thing");
        await cardButton(ctx, /^(Done|Fertig) /);
        await wait(ctx, `!R().querySelector(".ql-ritual-card")`, "the card to close");
        const r = await ev(ctx, `const d=P.store.days.get(P.today()); return {started:d?.dayStarted, one:d?.oneThing, timer:!!P.settings.timer};`);
        assert(r.started != null && r.one, `day note: ${JSON.stringify(r)}`);
        assert(!r.timer, "Done started the timer");
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "ritual-close-day",
    issue: "#20",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        await openRitual(ctx, "ritual-close-day");
        for (let i = 0; i < 4 && !(await ev(ctx, `return !!R().querySelector(".ql-ritual-card textarea")`)); i++) await cardButton(ctx, /^(Next|Weiter) /);
        await typeInto(ctx, ".ql-ritual-card textarea", "Smoke closing line.");
        for (let i = 0; i < 3 && (await ev(ctx, `return [...R().querySelectorAll(".ql-ritual-card .ql-ritual-actions button")].some(b=>/^(Next|Weiter)$/.test(b.textContent))`)); i++) {
          await cardButton(ctx, /^(Next|Weiter) /);
        }
        await cardButton(ctx, /Close the day|Tag abschließen/);
        await wait(ctx, `R().querySelector(".ql-ritual-note")`, "the quiet note");
        const day = await ev(ctx, `return P.today()`);
        const text = await ev(ctx, `return await app.vault.adapter.read("Questlog/Days/${day}.md")`);
        assert(/## (Closing line|Tagesfazit)\s+Smoke closing line\./.test(text), "no closing line in the day note");
        assert(/day_closed: /.test(text), "no day_closed in the day note");
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "ritual-plan-week",
    issue: "#21",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        await openRitual(ctx, "ritual-plan-week");
        const n = await ev(ctx, `return R().querySelectorAll(".ql-ritual-card .ql-ritual-hours input").length`);
        assert(n === (await ev(ctx, `return P.store.activeQuests().length`)), `hours fields: ${n}`);
        const sum = await ev(ctx, `return R().querySelector(".ql-ritual-sum")?.textContent||""`);
        await typeInto(ctx, ".ql-ritual-card .ql-ritual-hours input", "17");
        await wait(ctx, `(R().querySelector(".ql-ritual-sum")?.textContent||"")!==${JSON.stringify(sum)}`, "the sum to follow");
        await cardButton(ctx, /^(Finish|Fertig) /);
        await wait(ctx, `!R().querySelector(".ql-ritual-card")`, "the card to close");
        await wait(ctx, `[...P.store.reviews.keys()].some(k=>P.store.planHours(k))`, "plan_hours in a week note");
        const r = await ev(ctx, `const q=P.store.activeQuests()[0]; const w=Object.keys(Object.fromEntries(P.store.reviews)).find(k=>P.store.planHours(k)); return {w, h:w&&P.store.planHours(w)[q.name]};`);
        assert(r.w && r.h === 17, `plan_hours: ${JSON.stringify(r)}`);
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "ritual-check-in",
    issue: "#22",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        // A quiet quest gets the card; without one the command says so in a notice.
        await ev(ctx, `app.commands.executeCommandById("questlog:ritual-check-in"); await sleep(800);`);
        const card = await ev(ctx, `return !!R()?.querySelector(".ql-ritual-card")`);
        if (!card) {
          assert(await ev(ctx, `return [...document.querySelectorAll(".notice")].some(n=>/check-in|Standortbestimmung/.test(n.textContent))`), "no card and no notice");
          // No quiet quest in the demo: open the card for Garden the way the line would.
          await tab(ctx, "home");
          await ev(ctx, `app.workspace.getLeavesOfType("questlog-view")[0].view.openRitual({id:"check-in", day:P.today(), quest:"Garden"}); await sleep(500);`);
          await wait(ctx, `R()?.querySelector(".ql-ritual-card .ql-radio-chip")`, "the check-in card");
        }
        const quest = await ev(ctx, `return app.workspace.getLeavesOfType("questlog-view")[0].view.state.ritual?.quest`);
        await clickIn(ctx, ".ql-ritual-card .ql-radio-chip", /Keep|Behalten/);
        await cardButton(ctx, /^(Save|Speichern) /);
        await wait(ctx, `R().querySelector(".ql-ritual-note")`, "the quiet note");
        const text = await ev(ctx, `return await app.vault.read(app.vault.getAbstractFileByPath(P.store.quest(${JSON.stringify(quest)}).path))`);
        assert(/## (Check-ins|Standortbestimmung)/.test(text) && /keep|behalten/i.test(text), "no check-in line in the quest note");
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "ritual-cards-fit",
    issue: "#18",
    each: true,
    run: async (ctx) => {
      // Every card fits the pane; the close card stays open for the screenshot (no writes, nothing chosen).
      for (const cmd of ["ritual-start-day", "ritual-plan-week", "ritual-close-day"]) {
        await openRitual(ctx, cmd);
        const r = await ev(ctx, String.raw`
          const v=R(), body=v.querySelector(".ql-body"), c=v.querySelector(".ql-ritual-card");
          return {overflow:body.scrollWidth-body.clientWidth, cardOver:c.scrollWidth-c.clientWidth, cards:v.querySelectorAll(".ql-ritual-card").length,
            lines:v.querySelectorAll(".ql-ritual-line").length, warn:!!c.querySelector(".ql-warn")};`);
        assert(r.cards === 1 && r.lines === 0, `${cmd}: ${JSON.stringify(r)}`);
        assert(r.overflow <= 1 && r.cardOver <= 1, `${cmd} scrolls sideways: ${JSON.stringify(r)}`);
        assert(!r.warn, `${cmd} uses a warning colour`);
      }
    },
  },
  // ---------------------------------------------------------------- review periods (#23–#26)
  {
    name: "review-periods",
    issue: "#23",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "review");
      const fit = () => ev(ctx, String.raw`
        const v=R(), body=v.querySelector(".ql-body");
        return {overflow:body.scrollWidth-body.clientWidth, title:v.querySelector(".ql-page-title, h2")?.textContent||"",
          warn:!!v.querySelector(".ql-warn"), switch:!!v.querySelector(".ql-period-switch[aria-label]")};`);
      const w = await fit();
      assert(w.switch, "no period switch on the weekly review");
      for (const [re, sel] of [
        [/^(Month|Monat)/, ".ql-prows"],
        [/^(Quarter|Quartal)/, ".ql-vcheck"],
        [/^(Year|Jahr)/, ".ql-ownwords"],
        [/^(Week|Woche)/, ".ql-review"],
      ]) {
        await clickIn(ctx, ".ql-period-switch .ql-seg-btn", re);
        await wait(ctx, `R().querySelector(${JSON.stringify(sel)})`, `the ${re} review`);
        const r = await fit();
        assert(r.overflow <= 1, `${re} scrolls sideways by ${r.overflow}px`);
        assert(!r.warn, `${re} uses a warning colour`);
      }
      // A month shows planned hours and last month next to each quest; the labels carry the numbers.
      await clickIn(ctx, ".ql-period-switch .ql-seg-btn", /^(Month|Monat)/);
      const m = await ev(ctx, String.raw`
        const rows=[...R().querySelectorAll(".ql-prow")];
        return {n:rows.length, labelled:rows.every(r=>r.querySelector(".ql-bar[role=img]")?.getAttribute("aria-label")),
          last:rows.some(r=>/last month|Vormonat/.test(r.textContent)), trend:R().querySelectorAll(".ql-trend-col").length};`);
      assert(m.n >= 3 && m.labelled && m.last, `month rows: ${JSON.stringify(m)}`);
      assert(m.trend >= 4 && m.trend <= 6, `month trend has ${m.trend} weeks`);
      // Previous / next keep the period.
      await clickIn(ctx, ".ql-navgroup button", /Previous month|Vorheriger Monat/);
      await wait(ctx, `R().querySelector(".ql-prows")`, "the previous month");
      await clickIn(ctx, ".ql-navgroup button", /^(This month|Dieser Monat)/);
    },
  },
  {
    name: "review-period-notes",
    issue: "#24",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        for (const [re, period] of [[/^(Month|Monat)/, "month"], [/^(Quarter|Quartal)/, "quarter"], [/^(Year|Jahr)/, "year"]]) {
          await resetState(ctx);
          await tab(ctx, "review");
          await clickIn(ctx, ".ql-period-switch .ql-seg-btn", re);
          await wait(ctx, `R().querySelector(".ql-answer")`, `the ${period} questions`);
          const id = await ev(ctx, `const d=new Date(), y=d.getFullYear(), m=d.getMonth()+1; return ${JSON.stringify(period)}==="month"?y+"-"+String(m).padStart(2,"0"):${JSON.stringify(period)}==="quarter"?y+"-Q"+Math.ceil(m/3):String(y);`);
          const answer = `Smoke ${period} answer`;
          await typeInto(ctx, ".ql-answer", answer);
          await clickIn(ctx, ".ql-question-actions button.mod-cta", /Save|Speichern/);
          await wait(ctx, `P.store.reviews.get(${JSON.stringify(id)})?.answers && Object.values(P.store.reviews.get(${JSON.stringify(id)}).answers).includes(${JSON.stringify(answer)})`, `the ${period} note`);
          const r = await ev(ctx, `const rv=P.store.reviews.get(${JSON.stringify(id)}); return {path:rv.path, period:rv.period, text:await app.vault.read(app.vault.getAbstractFileByPath(rv.path))};`);
          assert(r.path.endsWith(`/${id}.md`), `${period} note at ${r.path}`);
          assert(r.period === period && new RegExp(`^period: ${period}$`, "m").test(r.text), `${period} frontmatter: ${r.text.slice(0, 200)}`);
          assert(/^hours_total: /m.test(r.text) && r.text.includes(answer), `${period} note body: ${r.text}`);
          // A fresh view fills the form from the note.
          await resetState(ctx);
          await tab(ctx, "review");
          await clickIn(ctx, ".ql-period-switch .ql-seg-btn", re);
          await wait(ctx, `[...R().querySelectorAll(".ql-answer")].some(t=>t.value===${JSON.stringify(answer)})`, `the saved ${period} answer`);
        }
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "review-quarter-decisions",
    issue: "#25",
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        await tab(ctx, "review");
        await clickIn(ctx, ".ql-period-switch .ql-seg-btn", /^(Quarter|Quartal)/);
        await wait(ctx, `R().querySelector(".ql-decide-row")`, "the quest decisions");
        // Vision check: "Needs an update" offers the vision dialog, nothing opens by itself.
        await ev(ctx, `[...R().querySelectorAll(".ql-vcheck .ql-radio-chip input")][1].click(); await sleep(300);`);
        await wait(ctx, `R().querySelector(".ql-vcheck-edit button")`, "the Edit vision button");
        assert((await modalCount(ctx)) === 0, "a dialog opened by itself");
        const r = await ev(ctx, String.raw`
          const fs=[...R().querySelectorAll("fieldset.ql-decide-row")].find(f=>f.querySelector("legend").textContent.includes("Travel book"));
          if (!fs) return {err:"no Travel book row"};
          const labelled=[...fs.querySelectorAll("input")].every(i=>i.type==="radio"?i.closest("label"):R().querySelector('label[for="'+i.id+'"]'));
          fs.querySelector('input[type=radio][value=pause]').click();
          const num=fs.querySelector('input[type=number]'); num.focus(); num.value="2"; num.dispatchEvent(new Event("input",{bubbles:true})); num.blur();
          await sleep(200);
          return {labelled, group:fs.querySelector("[role=radiogroup]")?.getAttribute("aria-label")||""};`);
        assert(!r.err && r.labelled && r.group, `decision row: ${JSON.stringify(r)}`);
        await clickIn(ctx, ".ql-decide .ql-question-actions button", /Apply changes|Änderungen übernehmen/);
        await wait(ctx, `P.store.quest("Travel book").status==="paused" && P.store.quest("Travel book").weeklyHours===2`, "the decision in the quest");
        const after = await ev(ctx, String.raw`
          const t=await app.vault.read(app.vault.getAbstractFileByPath(P.store.quest("Travel book").path));
          return {status:/^status: paused$/m.test(t), hours:/^weekly_hours: 2$/m.test(t), live:R().querySelector(".ql-decide-status")?.textContent||"",
            others:P.store.quests.filter(q=>q.name!=="Travel book"&&q.kind==="quest").map(q=>q.status).join()};`);
        assert(after.status && after.hours, `quest note: ${JSON.stringify(after)}`);
        assert(/1/.test(after.live), `no result line: ${after.live}`);
        // The paused quest now offers Resume.
        await wait(ctx, `[...R().querySelectorAll("fieldset.ql-decide-row")].find(f=>f.textContent.includes("Travel book"))?.querySelector("input[value=resume]")`, "Resume for the paused quest");
      } finally {
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "review-year",
    issue: "#26",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "review");
      await clickIn(ctx, ".ql-period-switch .ql-seg-btn", /^(Year|Jahr)/);
      await wait(ctx, `R().querySelector(".ql-ystories, .ql-empty")`, "the year");
      const r = await ev(ctx, String.raw`
        const v=R(), body=v.querySelector(".ql-body");
        const table=v.querySelector(".ql-ytable");
        return {stories:v.querySelectorAll(".ql-ystory").length, open:v.querySelectorAll(".ql-ystory-open").length,
          bars:table?[...table.querySelectorAll(".ql-bar")].every(b=>/ Q[1-4]: /.test(b.getAttribute("aria-label")||"")):true,
          select:!!v.querySelector(".ql-ownwords select[id]") && !!v.querySelector('.ql-ownwords label[for]'),
          expanded:[...v.querySelectorAll(".ql-ownwords-toggle")].filter(b=>b.getAttribute("aria-expanded")==="true").length,
          toggles:v.querySelectorAll(".ql-ownwords-toggle").length,
          overflow:body.scrollWidth-body.clientWidth, warn:!!v.querySelector(".ql-warn")};`);
      assert(r.stories >= 1 && r.open >= 1, `stories: ${JSON.stringify(r)}`);
      assert(r.bars, "a quarter bar has no label");
      assert(!r.toggles || (r.select && r.expanded === 1), `own words: ${JSON.stringify(r)}`);
      assert(r.overflow <= 1, `page scrolls sideways by ${r.overflow}px`);
      assert(!r.warn, "a warning colour is used");
      await clickIn(ctx, ".ql-ystory-open", /Travel book/);
      await wait(ctx, `R().querySelector(".ql-story-week")`, "the story from the year review");
    },
  },
  // ---------------------------------------------------------------- block 7: plan fit, day view, phone (#27–#29)
  {
    name: "plan-board-fit",
    issue: "#27",
    timeout: 60000,
    run: async (ctx) => {
      // Pane widths of about 1100, 1000 and 700 px (the ribbon takes the rest of the window).
      const out = [];
      try {
        for (const width of [1150, 1050, 750]) {
          await setViewport(ctx.c, { width, height: 800 });
          await ev(ctx, `app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); await sleep(300);`);
          await tab(ctx, "plan");
          const r = await ev(ctx, String.raw`
            const v=R(), body=v.querySelector(".ql-body"), board=v.querySelector(".ql-board"), rail=v.querySelector(".ql-backlog-rail");
            const today=board.querySelector(".ql-col.is-today"), br=board.getBoundingClientRect();
            const tr=today?.getBoundingClientRect();
            return {pane:body.clientWidth, overflow:board.scrollWidth-board.clientWidth, page:body.scrollWidth-body.clientWidth,
              rail:rail.getBoundingClientRect().width>0, todayIn:!tr||(tr.left>=br.left-1&&tr.left<br.right-40)};`);
          out.push(r);
          assert(r.page <= 1, `page scrolls sideways at ${r.pane}px: ${JSON.stringify(r)}`);
          if (r.pane >= 1050) assert(r.overflow <= 1 && !r.rail, `week does not fit at ${r.pane}px: ${JSON.stringify(r)}`);
          else if (r.pane >= 900) assert(r.overflow <= 1 && r.rail, `rail missing at ${r.pane}px: ${JSON.stringify(r)}`);
          else assert(r.todayIn, `today is not in view at ${r.pane}px: ${JSON.stringify(r)}`);
        }
        // The rail opens the backlog as an overlay and Escape closes it again.
        await setViewport(ctx.c, { width: 1050, height: 800 });
        await ev(ctx, `app.workspace.leftSplit.collapse(); await sleep(300);`);
        await tab(ctx, "plan");
        await clickIn(ctx, ".ql-backlog-rail");
        const open = await ev(ctx, `const c=R().querySelector(".ql-col-backlog"); return {open:c.classList.contains("is-open"), focus:document.activeElement?.classList.contains("ql-search-input")}`);
        assert(open.open && open.focus, `overlay: ${JSON.stringify(open)}`);
        await ctx.shot("plan-board-fit-overlay");
        await ev(ctx, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); await sleep(200);`);
        const closed = await ev(ctx, `return !R().querySelector(".ql-col-backlog").classList.contains("is-open") && document.activeElement?.classList.contains("ql-backlog-rail")`);
        assert(closed, "Escape does not close the overlay back to the rail");
      } finally {
        await setViewport(ctx.c, { width: ctx.size.width, height: ctx.size.height });
      }
    },
  },
  {
    name: "plan-backlog-search",
    issue: "#27",
    each: true,
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        const long = "Collect every source for the Lisbon chapter: the tram timetable of 1931, the harbour letters, the café menus, the two interviews and the photographs from the archive in Belém";
        await ev(ctx, `const q=P.store.quests.find(x=>x.name==="Travel book"); await P.store.addTaskTo(q, ${JSON.stringify(long)}, null, "bottom"); await sleep(600);`);
        await tab(ctx, "plan");
        await ev(ctx, `const r=R().querySelector(".ql-backlog-rail"); if (r.getBoundingClientRect().width>0) { r.click(); await sleep(300); }`);
        // A long backlog is folded on narrow panes; unfold it first.
        await ev(ctx, `const f=R().querySelector(".ql-backlog-fold[aria-expanded=false]"); if (f) { f.click(); await sleep(400); }`);
        // Search: typing keeps the focus and hides rows only.
        const r = await ev(ctx, String.raw`
          const v=R(), s=v.querySelector(".ql-search-input"); s.focus();
          const total=v.querySelectorAll(".ql-col-backlog .ql-task").length;
          s.value="lisbon"; s.dispatchEvent(new Event("input",{bubbles:true})); await sleep(300);
          const shown=[...v.querySelectorAll(".ql-col-backlog .ql-task")].filter(e=>!e.hidden).length;
          return {total, shown, focus:document.activeElement===s, count:v.querySelector(".ql-col-backlog .ql-col-meta").textContent};`);
        assert(r.focus, "the search field lost its focus while typing");
        assert(r.shown >= 1 && r.shown < r.total && /\d+ (of|von) \d+/.test(r.count), `search: ${JSON.stringify(r)}`);
        // Clear, then a quest chip.
        await clickIn(ctx, ".ql-search-clear");
        await clickIn(ctx, ".ql-backlog-chip", /Travel book/);
        const c = await ev(ctx, String.raw`
          const v=R(); const chip=[...v.querySelectorAll(".ql-backlog-chip")].find(b=>/Travel book/.test(b.textContent));
          const heads=[...v.querySelectorAll(".ql-col-backlog .ql-group-head")].filter(h=>!h.hidden).map(h=>h.textContent);
          return {pressed:chip.getAttribute("aria-pressed"), heads, count:v.querySelector(".ql-col-backlog .ql-col-meta").textContent};`);
        assert(c.pressed === "true" && c.heads.length === 1 && /of|von/.test(c.count), `chip: ${JSON.stringify(c)}`);
        // The long card is clamped and opens with its button.
        const e = await ev(ctx, String.raw`
          await sleep(200);
          const row=[...R().querySelectorAll(".ql-col-backlog .ql-task")].find(x=>/tram timetable/.test(x.textContent));
          const text=row.querySelector(".ql-task-text"), btn=row.querySelector(".ql-task-expand");
          const before=text.clientHeight; const visible=!btn.hidden; btn.click(); await sleep(100);
          return {visible, grew:text.clientHeight>before, expanded:btn.getAttribute("aria-expanded")};`);
        assert(e.visible && e.grew && e.expanded === "true", `long card: ${JSON.stringify(e)}`);
        await clickIn(ctx, ".ql-backlog-chip", /^(All|Alle)/);
      } finally {
        await ev(ctx, `const v=app.workspace.getLeavesOfType("questlog-view")[0]?.view; if (v) { v.state.backlogQuery=""; v.state.backlogQuest=null; v.state.backlogOpen=false; }`);
        await restore(ctx, snap);
      }
    },
  },
  {
    name: "calendar-day-view",
    issue: "calendar",
    each: true,
    run: async (ctx) => {
      try {
        await ev(ctx, `P.settings.calendarView="auto"; await P.saveSettings();`);
        await tab(ctx, "calendar");
        const auto = await ev(ctx, `return {day:!!R().querySelector(".ql-cal-day"), narrow:R().classList.contains("ql-w-narrow")}`);
        assert(auto.day === auto.narrow, `auto layout: ${JSON.stringify(auto)}`);
        await clickIn(ctx, ".ql-cal-switch .ql-seg-btn", /^(Day|Tag)/);
        const d = await ev(ctx, String.raw`
          const v=R(), body=v.querySelector(".ql-body");
          return {day:!!v.querySelector(".ql-cal-day"), strip:v.querySelectorAll(".ql-cal-strip-day").length,
            pressed:v.querySelectorAll('.ql-cal-strip-day[aria-pressed="true"]').length, cols:v.querySelectorAll(".ql-tl-col, .ql-tl-day").length,
            list:!!v.querySelector(".ql-cal-daylist"), overflow:body.scrollWidth-body.clientWidth, saved:P.settings.calendarView};`);
        assert(d.day && d.strip === 7 && d.pressed === 1 && d.list && d.saved === "day", `day view: ${JSON.stringify(d)}`);
        assert(d.overflow <= 1, `day view scrolls sideways by ${d.overflow}px`);
        // Another day of the strip, then the arrows step a single day.
        const before = await ev(ctx, `return R().querySelector(".ql-page-head h2, .ql-page-title")?.textContent`);
        await ev(ctx, `const b=[...R().querySelectorAll('.ql-cal-strip-day[aria-pressed="false"]')][0]; b.click(); await sleep(400);`);
        const after = await ev(ctx, `return R().querySelector(".ql-page-head h2, .ql-page-title")?.textContent`);
        assert(before !== after, "the strip does not change the day");
        // A logged session shows in the list and opens its dialog.
        const snap = await snapshot(ctx);
        try {
          await ev(ctx, String.raw`
            const v=app.workspace.getLeavesOfType("questlog-view")[0].view, day=v.state.calendarDay;
            const q=P.store.quests.find(x=>x.name==="Travel book");
            await P.store.addSession({day, start:9*60, end:10*60+15, quest:q.name, taskText:"", taskId:"", note:"smoke"}); await sleep(600);`);
          await wait(ctx, `R().querySelector(".ql-cal-session")`, "the session in the day list");
          await clickIn(ctx, ".ql-cal-session");
          assert((await modalCount(ctx)) === 1, "the session dialog did not open");
        } finally {
          await resetState(ctx);
          await restore(ctx, snap);
        }
        await tab(ctx, "calendar");
        await clickIn(ctx, ".ql-cal-switch .ql-seg-btn", /^(Week|Woche)/);
        const w = await ev(ctx, `return {day:!!R().querySelector(".ql-cal-day"), saved:P.settings.calendarView}`);
        assert(!w.day && w.saved === "week", `week view: ${JSON.stringify(w)}`);
      } finally {
        await ev(ctx, `P.settings.calendarView="auto"; await P.saveSettings();`);
      }
    },
  },
  {
    name: "capture-bar",
    issue: "#28",
    each: true,
    run: async (ctx) => {
      await tab(ctx, "home");
      const r = await ev(ctx, String.raw`
        const v=R(), bar=v.querySelector(".ql-capturebar");
        if (!bar) return {bar:false};
        // Right above Obsidian's floating phone navbar, or at the bottom of the view without one.
        const nb=document.querySelector(".mobile-navbar")?.getBoundingClientRect();
        const b=bar.getBoundingClientRect(), floor=nb&&nb.height?nb.top:v.getBoundingClientRect().bottom;
        return {bar:true, buttons:bar.querySelectorAll("button").length, gap:Math.round(floor-b.bottom),
          small:[...bar.querySelectorAll("button")].filter(x=>x.getBoundingClientRect().height<44).length};`);
      if (!ctx.size.phone) {
        assert(!r.bar, "the capture bar shows outside a phone");
        return;
      }
      assert(r.bar && r.buttons === 3 && r.small === 0, `capture bar: ${JSON.stringify(r)}`);
      assert(r.gap >= 0 && r.gap <= 16, `the bar is not at the bottom: ${JSON.stringify(r)}`);
      await ctx.shot("capture-bar-home");
      // Add opens the box with the quest row; picking a quest changes where the task goes.
      await clickIn(ctx, ".ql-capture-btn.is-add");
      await wait(ctx, `document.querySelector(".ql-sb-questbtn")`, "the quest row");
      const k = await ev(ctx, `const i=document.querySelector(".prompt-input"); return {hint:i.getAttribute("enterkeyhint"), cap:i.getAttribute("autocapitalize")}`);
      assert(k.hint === "go" && k.cap === "sentences", `keyboard hints: ${JSON.stringify(k)}`);
      await ev(ctx, `document.querySelector(".ql-sb-questbtn").click(); await sleep(400);`);
      assert((await modalCount(ctx)) === 2, "the quest picker did not open");
      await ev(ctx, String.raw`const ms=document.querySelectorAll(".modal-container"); const it=[...ms[ms.length-1].querySelectorAll(".suggestion-item")].find(x=>/Garden/.test(x.textContent)); it.click(); await sleep(400);`);
      const label = await ev(ctx, `return document.querySelector(".ql-sb-questbtn").textContent`);
      assert(/Garden/.test(label), `quest row after picking: ${label}`);
      await ev(ctx, `const i=document.querySelector(".prompt-input"); i.value="Mulch the beds"; i.dispatchEvent(new Event("input")); await sleep(300);`);
      const first = await ev(ctx, `return document.querySelector(".suggestion-item")?.textContent`);
      assert(/Garden/.test(first ?? ""), `first row after picking: ${first}`);
      await ctx.shot("capture-bar-startbox");
      await resetState(ctx);
      // Not on Focus, and not while a timer runs.
      await tab(ctx, "focus");
      assert(!(await ev(ctx, `return !!R().querySelector(".ql-capturebar")`)), "the capture bar shows on Focus");
    },
  },
  {
    name: "phone-fit",
    issue: "#29",
    each: true,
    shot: false,
    timeout: 90000,
    run: async (ctx) => {
      if (!ctx.size.phone) return;
      const bad = [];
      try {
        for (const width of [420, 320]) {
          await setViewport(ctx.c, { width, height: 800 });
          for (const id of TABS) {
            await tab(ctx, id);
            const r = await ev(ctx, String.raw`
              const v=R(), body=v.querySelector(".ql-body");
              const vis=(e)=>{const b=e.getBoundingClientRect(); return b.width>0&&b.height>0&&!e.closest("[hidden]")};
              const name=(e)=>(e.className||e.tagName).toString().split(" ")[0]+":"+(e.getAttribute("aria-label")||e.textContent).trim().slice(0,24);
              const small=[...v.querySelectorAll("button, [role=button], select, input[type=checkbox]")].filter(vis)
                .filter(e=>{const b=(e.matches("input")&&e.closest("label")||e).getBoundingClientRect(); return b.height<43.5 || b.width<43.5}).map(name);
              const tiny=[...v.querySelectorAll("input:not([type=checkbox]):not([type=radio]), textarea, select")].filter(vis)
                .filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).map(name);
              const edge=body.getBoundingClientRect().right+1;
              const wide=[...body.querySelectorAll("*")].filter(e=>vis(e)&&e.getBoundingClientRect().right>edge&&!e.closest(".ql-ytable-wrap,.ql-cal-strip")).slice(-2).map(name);
              return {overflow:body.scrollWidth-body.clientWidth, wide, small:[...new Set(small)], tiny:[...new Set(tiny)]};`);
            if (r.overflow > 1) bad.push(`${id}@${width}: scrolls sideways by ${r.overflow}px (${r.wide.join(", ")})`);
            if (r.small.length) bad.push(`${id}@${width}: small targets ${r.small.slice(0, 8).join(", ")}`);
            if (r.tiny.length) bad.push(`${id}@${width}: text under 16px ${r.tiny.slice(0, 5).join(", ")}`);
          }
          await ctx.shot(`phone-fit-${width}`);
        }
      } finally {
        await setViewport(ctx.c, { width: ctx.size.width, height: ctx.size.height });
      }
      assert(!bad.length, bad.join(" | "));
    },
  },
  // ---------------------------------------------------------------- plan day view
  {
    name: "plan-day-view",
    issue: "plan-day",
    each: true,
    run: async (ctx) => {
      const snap = await snapshot(ctx);
      try {
        await ev(ctx, `P.settings.planView="auto"; await P.saveSettings();`);
        await tab(ctx, "plan");
        const auto = await ev(ctx, `return {day:!!R().querySelector(".ql-dayboard"), narrow:R().classList.contains("ql-w-narrow")}`);
        assert(auto.day === auto.narrow, `auto layout: ${JSON.stringify(auto)}`);
        // Week view: backlog tasks have a one-click "plan for today" button.
        if (!auto.day) assert(await ev(ctx, `return !!R().querySelector(".ql-board .ql-col-backlog .ql-task-plan")`), "no sun button in the week backlog");
        await clickIn(ctx, ".ql-cal-switch .ql-seg-btn", /^(Day|Tag)/);
        const d = await ev(ctx, String.raw`
          const v=R(), body=v.querySelector(".ql-body"), board=v.querySelector(".ql-dayboard");
          return {board:!!board, strip:v.querySelectorAll(".ql-plan-strip .ql-cal-strip-day").length,
            pressed:v.querySelectorAll('.ql-plan-strip [aria-pressed="true"]').length,
            backlog:!!board?.querySelector(".ql-col-backlog"), days:board?.querySelectorAll(".ql-col-day").length,
            overflow:body.scrollWidth-body.clientWidth, saved:P.settings.planView};`);
        assert(d.board && d.strip === 7 && d.pressed === 1 && d.backlog && d.days === 1 && d.saved === "day", `day view: ${JSON.stringify(d)}`);
        assert(d.overflow <= 1, `day view scrolls sideways by ${d.overflow}px`);
        // The sun button plans a backlog task for today.
        await ev(ctx, `const f=R().querySelector(".ql-backlog-fold[aria-expanded=false]"); if (f) { f.click(); await sleep(400); }`);
        const key = await ev(ctx, `const row=R().querySelector(".ql-col-backlog .ql-task"); const b=row?.querySelector(".ql-task-plan"); if(!b) return null; b.click(); return row.dataset.key;`);
        assert(key, "no backlog task with a sun button");
        await wait(ctx, `(()=>{const today=window.moment().format("YYYY-MM-DD"); const x=P.store.allTasks().find(t=>(t.id||t.questPath+"#"+t.line)===${JSON.stringify(key)}); return x && P.store.scheduledDay(x,today)===today})()`, "the task to be planned for today");
        await wait(ctx, `[...R().querySelectorAll(".ql-col-day .ql-task")].some(e=>e.dataset.key===${JSON.stringify(key)})`, "the task in the day column");
        await ctx.shot("plan-day-view-day");
        // Dropping a backlog task on a later day of the strip plans it there.
        const drop = await ev(ctx, String.raw`
          const v=R(); const target=[...v.querySelectorAll(".ql-plan-strip .ql-cal-strip-day:not(.is-past):not(.is-active)")][0];
          const row=v.querySelector(".ql-col-backlog .ql-task.is-draggable");
          if(!target||!row) return {skip:true};
          const dt=new DataTransfer(); row.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));
          target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt}));
          const lit=target.classList.contains("is-drop");
          target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));
          row.dispatchEvent(new DragEvent("dragend",{bubbles:true}));
          const i=[...v.querySelectorAll(".ql-plan-strip .ql-cal-strip-day")].indexOf(target);
          return {key:row.dataset.key, lit, i};`);
        if (!drop.skip) {
          assert(drop.lit, "the strip day does not light up on drag over");
          const vday = await ev(ctx, `return app.workspace.getLeavesOfType("questlog-view")[0].view.state.planDay`);
          await wait(ctx, `(()=>{const x=P.store.allTasks().find(t=>(t.id||t.questPath+"#"+t.line)===${JSON.stringify(drop.key)}); const d=x&&P.store.scheduledDay(x,${JSON.stringify(vday)}); return d && d>${JSON.stringify(vday)}})()`, "the dropped task on a later day");
        }
        // Back to the week board.
        await clickIn(ctx, ".ql-cal-switch .ql-seg-btn", /^(Week|Woche)/);
        const w = await ev(ctx, `return {board:!!R().querySelector(".ql-board"), day:!!R().querySelector(".ql-dayboard"), saved:P.settings.planView}`);
        assert(w.board && !w.day && w.saved === "week", `week view: ${JSON.stringify(w)}`);
      } finally {
        await ev(ctx, `P.settings.planView="auto"; await P.saveSettings(); const v=app.workspace.getLeavesOfType("questlog-view")[0]?.view; if (v) v.state.planDay=window.moment().format("YYYY-MM-DD");`);
        await restore(ctx, snap);
      }
    },
  },
];
