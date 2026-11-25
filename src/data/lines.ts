// Line helpers shared by the Markdown readers and writers. Pure.

/** Split on "\n". A trailing "\r" stays on the line, so untouched lines are written back byte for byte. */
export function splitLines(content: string): string[] {
  return content.split("\n");
}

/** The line without its trailing "\r"; use it for every match. */
export function bare(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Line ending of the file: CRLF when its first line break is CRLF. */
export function eolOf(content: string): "\r\n" | "\n" {
  const i = content.indexOf("\n");
  return i > 0 && content[i - 1] === "\r" ? "\r\n" : "\n";
}

/** Line index where the body starts (after YAML frontmatter). */
export function bodyStart(ls: string[]): number {
  if (bare(ls[0] ?? "") !== "---") return 0;
  for (let i = 1; i < ls.length; i++) if (bare(ls[i] ?? "") === "---") return i + 1;
  return 0;
}

/** For each line: true inside a fenced code block, fence lines included. Lines before `from` are false. */
export function codeMask(ls: string[], from = bodyStart(ls)): boolean[] {
  let inCode = false;
  return ls.map((l, i) => {
    if (i < from) return false;
    const fence = /^\s*(```|~~~)/.test(l);
    const masked = inCode || fence;
    if (fence) inCode = !inCode;
    return masked;
  });
}
