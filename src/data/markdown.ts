// Pure Markdown reading/writing for quest notes, day logs and reviews. No Obsidian imports, so it is unit-testable.
import { fmtClock, parseClock } from "./dates";
import type { Session, Task } from "./model";

const TASK_RE = /^(\s*)([-*+]) \[(.)\] (.*)$/;
const ID_RE = /\s*🆔\s*([\w-]+)/;
const DONE_RE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/;
const SESSION_RE = /^[-*] (\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2}) (.*) · \[\[([^\]|#]+)(?:[|#][^\]]*)?\]\](?:\s*🆔\s*([\w-]+))?(?:\s+—\s+(.*?))?\s*$/;

export function newId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

function lines(content: string): string[] {
  return content.split("\n");
}

/** Line index where the body starts (after YAML frontmatter). */
function bodyStart(ls: string[]): number {
  if (ls[0] !== "---") return 0;
  for (let i = 1; i < ls.length; i++) if (ls[i] === "---") return i + 1;
  return 0;
}

// ---------------------------------------------------------------- tasks

export function parseTasks(content: string, questPath: string): Task[] {
  const out: Task[] = [];
  const ls = lines(content);
  let inCode = false;
  for (let i = bodyStart(ls); i < ls.length; i++) {
    const l = ls[i] ?? "";
    if (/^\s*(```|~~~)/.test(l)) inCode = !inCode;
    if (inCode) continue;
    const m = TASK_RE.exec(l);
    if (!m) continue;
    const status = m[3] ?? " ";
    if (status === "-") continue; // cancelled
    const rest = m[4] ?? "";
    const id = ID_RE.exec(rest)?.[1] ?? "";
    const doneDate = DONE_RE.exec(rest)?.[1] ?? null;
    const text = rest.replace(ID_RE, "").replace(DONE_RE, "").replace(/\s*\^[\w-]+\s*$/, "").trim();
    out.push({ id, text, done: status !== " ", doneDate, line: i, questPath });
  }
  return out;
}

/** Find the current line of a task: by id first, then by the remembered line if its text still matches. */
export function locateTask(content: string, task: Pick<Task, "id" | "line" | "text">): number {
  const tasks = parseTasks(content, "");
  if (task.id) {
    const byId = tasks.find((t) => t.id === task.id);
    if (byId) return byId.line;
  }
  const byLine = tasks.find((t) => t.line === task.line && t.text === task.text);
  if (byLine) return byLine.line;
  return tasks.find((t) => t.text === task.text)?.line ?? -1;
}

function editLine(content: string, line: number, fn: (l: string) => string): string {
  const ls = lines(content);
  if (line < 0 || line >= ls.length) return content;
  ls[line] = fn(ls[line] ?? "");
  return ls.join("\n");
}

export function setTaskDone(content: string, line: number, done: boolean, today: string): string {
  return editLine(content, line, (l) => {
    const m = TASK_RE.exec(l);
    if (!m) return l;
    let rest = (m[4] ?? "").replace(DONE_RE, "");
    if (done) {
      // keep the id at the end, the done date before it
      const id = ID_RE.exec(rest)?.[0] ?? "";
      rest = `${rest.replace(ID_RE, "").trimEnd()} ✅ ${today}${id}`;
    }
    return `${m[1]}${m[2]} [${done ? "x" : " "}] ${rest}`;
  });
}

export function setTaskId(content: string, line: number, id: string): string {
  return editLine(content, line, (l) => (TASK_RE.test(l) && !ID_RE.test(l) ? `${l.trimEnd()} 🆔 ${id}` : l));
}

export function setTaskText(content: string, line: number, text: string): string {
  return editLine(content, line, (l) => {
    const m = TASK_RE.exec(l);
    if (!m) return l;
    const rest = m[4] ?? "";
    const tail = [DONE_RE.exec(rest)?.[0] ?? "", ID_RE.exec(rest)?.[0] ?? ""].join("");
    return `${m[1]}${m[2]} [${m[3]}] ${text.trim()}${tail}`;
  });
}

export function isSessionLine(l: string): boolean {
  return SESSION_RE.test(l.trim());
}

export function deleteLine(content: string, line: number): string {
  const ls = lines(content);
  if (line < 0 || line >= ls.length) return content;
  ls.splice(line, 1);
  return ls.join("\n");
}

/** Insert `newLine` at the end of the section under `heading` (## level), creating the section if missing. */
export function appendToSection(content: string, heading: string, newLine: string): string {
  const ls = lines(content);
  const start = bodyStart(ls);
  const h = ls.findIndex((l, i) => i >= start && l.trim() === `## ${heading}`);
  if (h === -1) {
    const trimmed = content.replace(/\s*$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}## ${heading}\n${newLine}\n`;
  }
  let end = ls.length;
  for (let i = h + 1; i < ls.length; i++) {
    if (/^#{1,2} /.test(ls[i] ?? "")) {
      end = i;
      break;
    }
  }
  // insert after the last non-empty line of the section
  let at = end;
  while (at > h + 1 && (ls[at - 1] ?? "").trim() === "") at--;
  ls.splice(at, 0, newLine);
  return ls.join("\n");
}

export function taskLine(text: string, id: string): string {
  return `- [ ] ${text.trim()} 🆔 ${id}`;
}

// ---------------------------------------------------------------- sessions

export function parseSessions(content: string, day: string): Session[] {
  const out: Session[] = [];
  lines(content).forEach((l, i) => {
    const m = SESSION_RE.exec(l.trim());
    if (!m) return;
    const start = parseClock(m[1] ?? "");
    const end = parseClock(m[2] ?? "");
    if (start === null || end === null || end <= start) return;
    out.push({ day, start, end, taskText: (m[3] ?? "").trim(), quest: (m[4] ?? "").trim(), taskId: m[5] ?? "", note: (m[6] ?? "").trim(), line: i });
  });
  return out;
}

export function sessionLine(s: Pick<Session, "start" | "end" | "taskText" | "quest" | "taskId"> & { note?: string }): string {
  const text = s.taskText.replace(/\s*·\s*$/, "").trim() || "—";
  const note = (s.note ?? "").replace(/\s+/g, " ").trim();
  return `- ${fmtClock(s.start)}–${fmtClock(s.end)} ${text} · [[${s.quest}]]${s.taskId ? ` 🆔 ${s.taskId}` : ""}${note ? ` — ${note}` : ""}`;
}

/** Add a session to the sessions section, keeping it sorted by start time. */
export function insertSession(content: string, heading: string, s: Parameters<typeof sessionLine>[0]): string {
  const existing = parseSessions(content, "");
  const after = existing.filter((e) => e.start <= s.start).pop();
  if (after) {
    const ls = lines(content);
    ls.splice(after.line + 1, 0, sessionLine(s));
    return ls.join("\n");
  }
  const first = existing[0];
  if (first) {
    const ls = lines(content);
    ls.splice(first.line, 0, sessionLine(s));
    return ls.join("\n");
  }
  return appendToSection(content, heading, sessionLine(s));
}

export function replaceSession(content: string, heading: string, line: number, s: Parameters<typeof sessionLine>[0]): string {
  const ls = lines(content);
  if (!SESSION_RE.test((ls[line] ?? "").trim())) return content;
  ls.splice(line, 1);
  return insertSession(ls.join("\n"), heading, s);
}

// ---------------------------------------------------------------- free-text sections (reflection, review)

/** Read "### question" sub-sections under "## parent" into a map. */
export function readAnswers(content: string, parent: string): Record<string, string> {
  const ls = lines(content);
  const out: Record<string, string> = {};
  const p = ls.findIndex((l) => l.trim() === `## ${parent}`);
  if (p === -1) return out;
  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (key !== null) out[key] = buf.join("\n").trim();
  };
  for (let i = p + 1; i < ls.length; i++) {
    const l = ls[i] ?? "";
    if (/^#{1,2} /.test(l)) break;
    const h = /^### (.*)$/.exec(l);
    if (h) {
      flush();
      key = (h[1] ?? "").trim();
      buf = [];
    } else if (key !== null) buf.push(l);
  }
  flush();
  return out;
}

/** Replace the "## parent" section with the given question/answer pairs (in order). */
export function writeAnswers(content: string, parent: string, answers: [string, string][]): string {
  const block = [`## ${parent}`, ""];
  for (const [q, a] of answers) block.push(`### ${q}`, a.trim(), "");
  const ls = lines(content);
  const p = ls.findIndex((l) => l.trim() === `## ${parent}`);
  if (p === -1) {
    const trimmed = content.replace(/\s*$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}${block.join("\n").trimEnd()}\n`;
  }
  let end = ls.length;
  for (let i = p + 1; i < ls.length; i++) {
    if (/^#{1,2} /.test(ls[i] ?? "")) {
      end = i;
      break;
    }
  }
  const tail = ls.slice(end);
  return [...ls.slice(0, p), ...block, ...(tail.length ? tail : [])].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}
