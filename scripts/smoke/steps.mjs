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
import { sleep } from "./cdp.mjs";

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
    document.querySelectorAll(".modal-container").forEach((m) => m.remove());
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
  await ev(ctx, `document.querySelectorAll(".modal-container,.prompt,.notice,.tooltip").forEach(n=>n.remove()); if (timer()) await P.timer.discard(); app.workspace.getLeavesOfType("questlog-view").forEach(l=>l.detach()); await sleep(300);`);
}

/**
 * Phone emulation is a precheck only (the real phone test is #29). Obsidian's own emulation is internal, and
 * `hover: none` cannot be emulated over CDP, so the touch rules are injected as always-on styles.
 */
export async function setPhone(ctx, on) {
  await ctx.c.ev(
    `
    document.getElementById("smoke-touch")?.remove();
    if (${on}) {
      const css = await app.vault.adapter.read(app.vault.configDir + "/plugins/questlog/styles.css");
      const s = document.createElement("style"); s.id = "smoke-touch";
      s.textContent = css.replace(/@media\\s*\\(hover:\\s*none\\)/g, "@media all");
      document.head.appendChild(s);
    }
    try { app.emulateMobile?.(${on}); } catch {}
    return 1`,
  );
  await sleep(700);
}

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
];
