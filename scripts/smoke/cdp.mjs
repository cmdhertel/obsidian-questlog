// A small Chrome DevTools Protocol client on Node's built-in fetch and WebSocket (Node 22). No dependency.
// It only ever talks to the debugging port the caller passes in; smoke.mjs opened that port itself.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Console noise of Obsidian itself that is not caused by the plugin. */
const NOISE = [/Failed to load resource/i, /ResizeObserver loop/i, /net::ERR_/i, /Autofill\./i];

async function json(url, ms = 3000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** True when the debugging endpoint on this port answers. */
export async function endpointUp(port) {
  try {
    await json(`http://127.0.0.1:${port}/json/version`, 1000);
    return true;
  } catch {
    return false;
  }
}

/** Connect to the Obsidian main window on `port` and return the client. */
export async function connect(port) {
  const targets = await json(`http://127.0.0.1:${port}/json`);
  const page = targets.find((x) => x.type === "page" && x.url.startsWith("app://obsidian.md/index.html"));
  if (!page) throw new Error("No Obsidian window among the debugging targets");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket error"));
  });
  let n = 0;
  const pending = new Map();
  let errors = [];
  const note = (text) => {
    if (text && !NOISE.some((re) => re.test(text))) errors.push(text.split("\n")[0].slice(0, 300));
  };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) {
      pending.get(d.id)?.(d);
      pending.delete(d.id);
    } else if (d.method === "Runtime.exceptionThrown") note(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") note(d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
  ws.onclose = () => {
    for (const r of pending.values()) r({ error: { message: "connection closed" } });
    pending.clear();
  };
  const send = (method, params = {}, ms = 20000) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, ms);
      pending.set(id, (d) => {
        clearTimeout(timer);
        if (d.error) reject(new Error(`CDP ${method}: ${d.error.message}`));
        else resolve(d.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");

  /** Run code in the page (async body, `return` a JSON-able value). */
  const ev = async (body, ms = 20000) => {
    const r = await send(
      "Runtime.evaluate",
      { expression: `(async()=>{${body}\n})()`, awaitPromise: true, returnByValue: true, userGesture: true },
      ms,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  /** Poll `expr` (an expression, may await) until it is truthy. */
  const waitFor = async (expr, what, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try {
        v = await ev(`return await (${expr})`);
      } catch {
        v = false;
      }
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await sleep(150);
    }
  };
  const key = async (k, code = k, vk = 0) => {
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk });
  };
  const screenshot = async () => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(r.data, "base64");
  };
  return {
    send,
    ev,
    waitFor,
    key,
    screenshot,
    takeErrors: () => {
      const e = errors;
      errors = [];
      return e;
    },
    close: () => ws.close(),
  };
}

/** Resize the Obsidian window itself (works on small displays too) and pin the viewport to the same size. */
export async function setViewport(c, { width, height, scale = 1 }) {
  try {
    const { windowId } = await c.send("Browser.getWindowForTarget");
    await c.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal", width, height } });
  } catch {
    // A window that cannot be resized is still emulated at the right size below.
  }
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await sleep(500);
}

export async function clearViewport(c) {
  await c.send("Emulation.clearDeviceMetricsOverride");
}
