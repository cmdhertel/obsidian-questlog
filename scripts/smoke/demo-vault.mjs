// Generates the demo vault for the smoke test: three quests, about six weeks of sessions, planned tasks,
// one review and a vision note. All dates are relative to the run day. No real content.
// Standalone: node scripts/smoke/demo-vault.mjs <empty-directory>
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + n));
};
const clock = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** ISO week id such as 2026-W47 (same rule as the plugin). */
function isoWeek(day) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${pad(week)}`;
}

/** Small deterministic random numbers, so two runs on the same day make the same vault. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Throws unless `target` is `root` or lies inside it. Used for every path the smoke test writes or deletes. */
export function assertInside(root, target) {
  const r = resolve(root);
  const rel = relative(r, resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Refusing path outside ${r}: ${target}`);
  return resolve(target);
}

const QUESTS = [
  {
    name: "Travel book",
    color: "#e0884a",
    icon: "book-open",
    why: "A small book about the trip to Lisbon.",
    weekly: 5,
    order: 1,
    stages: [
      {
        name: "Research",
        start: -40,
        reached: -20,
        tasks: [
          ["Read three travel guides", -33],
          ["List the places to visit", -24],
          ["Interview a local guide", -21],
        ],
      },
      {
        name: "Drafting",
        start: -19,
        target: 25,
        tasks: [
          ["Outline the chapters", -15],
          ["Write the Lisbon chapter", -6],
          ["Write the Alfama chapter", null],
          ["Collect photos for chapter two", null],
        ],
      },
      { name: "Editing", tasks: [["Read the draft aloud", null], ["Fix the map captions", null]] },
    ],
    loose: [["Choose a working title", null]],
  },
  {
    name: "Spanish B2",
    color: "#5a8fd6",
    icon: "languages",
    why: "Talk freely on the next trip.",
    weekly: 4,
    order: 2,
    stages: [
      {
        name: "Grammar",
        start: -42,
        reached: -12,
        tasks: [
          ["Finish the subjunctive chapter", -30],
          ["Review irregular verbs", -18],
        ],
      },
      {
        name: "Speaking",
        start: -11,
        target: 40,
        tasks: [
          ["Book a weekly conversation slot", -9],
          ["Prepare five questions for the next talk", null],
          ["Shadow one podcast episode", null],
          ["Learn thirty words about travelling", null],
        ],
      },
    ],
    loose: [],
  },
  {
    name: "Garden",
    color: "#5fa86a",
    icon: "sprout",
    why: "Fresh tomatoes in July.",
    weekly: 2,
    order: 3,
    stages: [
      {
        name: "Beds",
        start: -35,
        target: 20,
        tasks: [
          ["Clear the old raised bed", -28],
          ["Order compost", -14],
          ["Build the second raised bed", null],
          ["Sow tomatoes indoors", null],
        ],
      },
    ],
    loose: [["Fix the water barrel", null]],
  },
];

/** Builds every file of the demo vault as { relative path: content }. Pure; nothing is written. */
export function buildVaultFiles(today = isoDay(new Date())) {
  const files = {};
  let n = 0;
  const id = () => {
    n++;
    return `q${n.toString(36).padStart(5, "0")}`;
  };

  // Tasks first, so the sessions and plans can refer to them.
  const quests = QUESTS.map((q) => {
    const stages = q.stages.map((s) => ({ ...s, tasks: s.tasks.map(([text, done]) => ({ text, doneOffset: done, id: id() })) }));
    const loose = q.loose.map(([text, done]) => ({ text, doneOffset: done, id: id() }));
    return { ...q, stages, loose };
  });
  const taskLine = (task) =>
    `- [${task.doneOffset === null ? " " : "x"}] ${task.text}${task.doneOffset === null ? "" : ` ✅ ${addDays(today, task.doneOffset)}`} 🆔 ${task.id}`;

  for (const q of quests) {
    const out = [
      "---",
      "type: quest",
      "status: active",
      `color: "${q.color}"`,
      `icon: ${q.icon}`,
      `why: ${q.why}`,
      `weekly_hours: ${q.weekly}`,
      `order: ${q.order}`,
      "---",
      "",
      "## Stages",
    ];
    for (const s of q.stages) {
      const dates = [
        s.start === undefined ? "" : ` 🛫 ${addDays(today, s.start)}`,
        s.target === undefined ? "" : ` 📅 ${addDays(today, s.target)}`,
        s.reached === undefined ? "" : ` ✅ ${addDays(today, s.reached)}`,
      ].join("");
      out.push(`### ${s.name}${dates}`);
      for (const task of s.tasks) out.push(taskLine(task));
    }
    out.push("", "## Tasks");
    for (const task of q.loose) out.push(taskLine(task));
    files[`Questlog/Quests/${q.name}.md`] = `${out.join("\n")}\n`;
  }
  files["Questlog/Other.md"] = `---\ntype: questlog-other\n---\n\n## Tasks\n- [ ] Renew the library card 🆔 ${id()}\n`;

  // Sessions: about six weeks, weekdays mostly, a few weekend hours. Today stays empty.
  const rand = rng(Number(today.replace(/-/g, "")));
  const all = quests.flatMap((q) => [...q.stages.flatMap((s) => s.tasks), ...q.loose].map((task) => ({ task, quest: q.name })));
  const days = {};
  for (let back = 42; back >= 1; back--) {
    const day = addDays(today, -back);
    const [y, m, d] = day.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const weekend = dow === 0 || dow === 6;
    if (rand() < (weekend ? 0.7 : 0.15)) continue;
    const count = weekend ? 1 : 1 + Math.floor(rand() * 3);
    let at = (weekend ? 10 : 7 + Math.floor(rand() * 3)) * 60 + Math.floor(rand() * 4) * 15;
    const sessions = [];
    for (let i = 0; i < count; i++) {
      const pick = all[Math.floor(rand() * all.length)];
      // Prefer work on tasks that were already finished by then or are still open.
      if (pick.task.doneOffset !== null && pick.task.doneOffset < -back) continue;
      const len = 25 + Math.floor(rand() * 6) * 15;
      sessions.push({ start: at, end: at + len, ...pick });
      at += len + 30 + Math.floor(rand() * 4) * 15;
    }
    if (sessions.length) days[day] = sessions;
  }
  for (const [day, sessions] of Object.entries(days)) {
    const ids = [...new Set(sessions.map((s) => s.task.id))];
    files[`Questlog/Days/${day}.md`] = [
      "---",
      "type: questlog-day",
      `date: ${day}`,
      `plan: [${ids.join(", ")}]`,
      "---",
      "",
      "## Sessions",
      ...sessions.map((s) => `- ${clock(s.start)}–${clock(s.end)} ${s.task.text} · [[${s.quest}]] 🆔 ${s.task.id}`),
      "",
    ].join("\n");
  }

  // Planned tasks: today and tomorrow, taken from the open ones.
  const open = quests.flatMap((q) => [...q.stages.flatMap((s) => s.tasks), ...q.loose]).filter((x) => x.doneOffset === null);
  const plan = (day, from, to) =>
    `---\ntype: questlog-day\ndate: ${day}\nplan: [${open.slice(from, to).map((x) => x.id).join(", ")}]\n---\n\n## Sessions\n`;
  files[`Questlog/Days/${today}.md`] = plan(today, 0, 4);
  files[`Questlog/Days/${addDays(today, 1)}.md`] = plan(addDays(today, 1), 4, 6);

  // One review, for last week.
  const lastWeek = isoWeek(addDays(today, -7));
  files[`Questlog/Reviews/${lastWeek}.md`] = [
    "---",
    "type: questlog-review",
    `week: ${lastWeek}`,
    "---",
    "",
    "## Reflection",
    "",
    "### What went well?",
    "Two long mornings on the Lisbon chapter.",
    "",
    "### What got in the way?",
    "A busy Thursday; the Spanish slot slipped.",
    "",
    "### What will I change next week?",
    "Plan the Spanish slot before noon.",
    "",
  ].join("\n");

  files["Questlog/Vision.md"] = "---\ntype: questlog-vision\n---\nA finished little book, a conversation in Spanish without notes, and a garden that feeds the table.\n";
  files[".obsidian/app.json"] = `${JSON.stringify({ alwaysUpdateLinks: true }, null, 2)}\n`;
  files[".obsidian/community-plugins.json"] = `${JSON.stringify(["questlog"])}\n`;
  return files;
}

const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

/**
 * Writes the demo vault into `dir` and copies the built plugin from `pluginDir`.
 * Every target path is checked to lie inside `dir`.
 */
export function writeDemoVault(dir, { pluginDir, today } = {}) {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).length) throw new Error(`Not empty: ${root}`);
  const written = [];
  const put = (rel, write) => {
    const target = assertInside(root, join(root, rel));
    mkdirSync(dirname(target), { recursive: true });
    write(target);
    written.push(rel);
  };
  for (const [rel, content] of Object.entries(buildVaultFiles(today))) put(rel, (t) => writeFileSync(t, content));
  if (pluginDir) {
    for (const f of PLUGIN_FILES) {
      const src = join(pluginDir, f);
      if (!existsSync(src)) throw new Error(`Missing built file ${src}; run npm run build first`);
      put(`.obsidian/plugins/questlog/${f}`, (t) => copyFileSync(src, t));
    }
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/smoke/demo-vault.mjs <empty-directory>");
    process.exit(1);
  }
  const pluginDir = PLUGIN_FILES.every((f) => existsSync(join(process.cwd(), f))) ? process.cwd() : undefined;
  const written = writeDemoVault(dir, { pluginDir });
  console.log(`Wrote ${written.length} files into ${resolve(dir)}${pluginDir ? "" : " (plugin files not copied: build first)"}`);
}
