// Smoke test: builds the plugin, starts its OWN Obsidian on a generated demo vault and drives it over CDP.
//   npm run smoke [-- --keep] [-- --only <text>[,<text>…]] [-- --lang en|de] [-- --no-build] [-- --fail-test]
// Safety: demo vault and profile live in a new folder in the system's temp directory, on an own debugging port; never
// attaches to a port it did not open, refuses a work folder outside the temp directory, and only ever stops the process
// it spawned itself (child handle). Report and screenshots go to .smoke/out/ in the repo.
import { execFile, execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertInside, writeDemoVault } from "./smoke/demo-vault.mjs";
import { clearViewport, connect, endpointUp, setViewport, sleep } from "./smoke/cdp.mjs";
import { enablePlugin, resetState, setLanguage, setPhone, steps as allSteps } from "./smoke/steps.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow", width: 700, height: 800 },
  { name: "phone", width: 420, height: 900, phone: true },
];
const LANGS = opt("lang") ? [opt("lang")] : ["en", "de"];
const SCALE = Number(process.env.SMOKE_SCALE || 1);

function fail(msg) {
  console.error(`smoke: ${msg}`);
  process.exit(2);
}

// ------------------------------------------------------------------ checks before anything starts
if (process.platform !== "darwin") fail("only macOS is supported");
if (Number(process.versions.node.split(".")[0]) < 22) fail(`Node 22 or newer needed (this is ${process.version})`);
const bin = process.env.OBSIDIAN_BIN || "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
if (!existsSync(bin)) fail(`Obsidian not found at ${bin}. Set OBSIDIAN_BIN to the Obsidian binary.`);

const portFree = (port) =>
  new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
async function pickPort() {
  if (process.env.SMOKE_PORT) {
    const p = Number(process.env.SMOKE_PORT);
    if (!(await portFree(p)) || (await endpointUp(p))) fail(`SMOKE_PORT ${p} is in use; refusing to use a port this script did not open`);
    return p;
  }
  for (let i = 0; i < 20; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if ((await portFree(p)) && !(await endpointUp(p))) return p;
  }
  return fail("no free debugging port found");
}

// ------------------------------------------------------------------ folders (work in the temp directory, output in .smoke/)
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const temp = realpathSync(tmpdir());
let parent = temp;
try {
  // SMOKE_DIR: another parent folder for the work folder, inside the temp directory.
  if (process.env.SMOKE_DIR) parent = assertInside(temp, existsSync(process.env.SMOKE_DIR) ? realpathSync(process.env.SMOKE_DIR) : process.env.SMOKE_DIR);
} catch (e) {
  fail(e.message);
}
mkdirSync(parent, { recursive: true });
const work = assertInside(temp, mkdtempSync(join(parent, "questlog-smoke-")));
const vault = assertInside(work, join(work, "vault"));
const profile = assertInside(work, join(work, "profile"));
const smokeRoot = join(repo, ".smoke");
const outDir = assertInside(smokeRoot, join(smokeRoot, "out", stamp));
mkdirSync(profile, { recursive: true });
mkdirSync(outDir, { recursive: true });

if (!flag("no-build")) execFileSync("npm", ["run", "build"], { cwd: repo, stdio: "inherit" });
writeDemoVault(vault, { pluginDir: repo });
writeFileSync(
  join(profile, "obsidian.json"),
  JSON.stringify({ vaults: { smokedemo0001: { path: vault, ts: Date.now(), open: true } } }),
);

// ------------------------------------------------------------------ start our own Obsidian
const port = await pickPort();
const logFd = openSync(join(work, "obsidian.log"), "w");
// A covered window must not slow its timers down: the steps wait in real time.
const child = spawn(bin, [`--user-data-dir=${profile}`, "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", `--remote-debugging-port=${port}`], { stdio: ["ignore", logFd, logFd] });
closeSync(logFd);
let exited = false;
child.on("exit", () => (exited = true));
console.log(`smoke: started own Obsidian pid ${child.pid} on port ${port}, vault ${vault}`);

/** Stop only the process we spawned: close politely over CDP, then signal the child handle. */
async function stopApp(c) {
  try {
    await c?.send("Browser.close", {}, 3000);
  } catch {
    // The app may already be gone.
  }
  for (let i = 0; i < 40 && !exited; i++) await sleep(250);
  if (!exited) child.kill("SIGTERM");
  for (let i = 0; i < 20 && !exited; i++) await sleep(250);
  if (!exited) child.kill("SIGKILL");
  for (let i = 0; i < 20 && !exited; i++) await sleep(250);
}
process.on("SIGINT", () => {
  child.kill("SIGTERM");
  process.exit(130);
});

const report = [];
const log = (line) => {
  report.push(line);
  console.log(line);
};
let failed = 0;
let c = null;
try {
  for (let i = 0; i < 240 && !(await endpointUp(port)); i++) {
    if (exited) throw new Error(`Obsidian exited early (see ${join(work, "obsidian.log")})`);
    await sleep(250);
  }
  if (!(await endpointUp(port))) throw new Error("Debugging endpoint did not come up");
  // The port must belong to the process we started.
  const owner = await new Promise((ok) =>
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], (_e, out) => ok((out || "").split("\n").filter(Boolean).map(Number))),
  );
  if (owner.length && !owner.includes(child.pid)) throw new Error(`Port ${port} is held by pid ${owner}, not by our child ${child.pid}`);
  c = await connect(port);
  await c.waitFor(`window.app && app.workspace && app.workspace.layoutReady`, "Obsidian to load", 60000);
  const base = await c.ev(`return app.vault.adapter.basePath`);
  if (resolve(base) !== resolve(vault)) throw new Error(`Connected app has vault ${base}, expected ${vault}`);

  const ctx = {
    c,
    outDir,
    size: SIZES[0],
    lang: LANGS[0],
    step: "",
    async shot(name = this.step) {
      const file = join(outDir, `${name}-${this.size.name}-${this.lang}.png`);
      writeFileSync(file, await c.screenshot());
    },
  };
  const only = opt("only");
  let list = allSteps.filter((s) => !only || only.split(",").some((o) => s.name.includes(o)));
  if (flag("fail-test")) list = [...list, { name: "deliberately-broken", issue: "smoke", run: async () => { throw new Error("broken on purpose (--fail-test)"); } }];

  for (const lang of LANGS) {
    ctx.lang = lang;
    await setLanguage(ctx, lang);
    await enablePlugin(ctx);
    for (const size of SIZES) {
      ctx.size = size;
      await setViewport(c, { width: size.width, height: size.height, scale: SCALE });
      await setPhone(ctx, !!size.phone);
      const first = lang === LANGS[0] && size === SIZES[0];
      for (const step of list) {
        if (!step.each && !first) continue;
        ctx.step = step.name;
        await resetState(ctx);
        c.takeErrors();
        const t0 = Date.now();
        let problem = null;
        try {
          await Promise.race([
            step.run(ctx),
            sleep(step.timeout ?? 30000).then(() => {
              throw new Error(`timed out after ${(step.timeout ?? 30000) / 1000}s`);
            }),
          ]);
          const errs = c.takeErrors();
          if (errs.length) throw new Error(`console errors: ${errs.slice(0, 3).join(" | ")}`);
        } catch (e) {
          problem = e instanceof Error ? e.message : String(e);
        }
        try {
          if (problem) ctx.step = `${step.name}-FAILED`;
          if (step.shot !== false || problem) await ctx.shot();
        } catch {
          // A missing screenshot must not hide the result.
        }
        ctx.step = step.name;
        if (problem) failed++;
        log(`${problem ? "FAIL" : "PASS"}  ${step.name.padEnd(24)} ${size.name}/${lang}  ${Date.now() - t0} ms${problem ? `  ${problem}` : ""}  [${step.issue}]`);
      }
      await setPhone(ctx, false);
      await clearViewport(c);
    }
  }
  log(failed ? `\n${failed} step(s) failed` : "\nall steps passed");
} catch (e) {
  failed++;
  log(`ERROR ${e instanceof Error ? e.message : e}`);
} finally {
  await stopApp(c);
  try {
    c?.close();
  } catch {
    // Already closed.
  }
  writeFileSync(join(outDir, "report.txt"), `${report.join("\n")}\n`);
  console.log(`smoke: own Obsidian ${exited ? "stopped" : "COULD NOT BE STOPPED (pid " + child.pid + ")"}; report and screenshots in ${outDir}`);
  if (!flag("keep")) {
    assertInside(temp, work);
    rmSync(work, { recursive: true, force: true });
  } else console.log(`smoke: kept ${work}`);
}
process.exit(failed || !exited ? 1 : 0);
