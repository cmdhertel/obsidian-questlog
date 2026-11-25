import { describe, expect, it } from "vitest";
import { archiveVision, newVisionNote, parseVision, setVisionText } from "../src/data/vision";

const NOTE = `---
type: questlog-vision
updated: 2026-11-24
---
Write the Lisbon book, speak Spanish at B2, and keep a garden that feeds us.

## Earlier
### until 2026-10-01
Write the Lisbon book and learn Spanish.
### until 2026-05-12
Travel more.
`;
const EARLIER = NOTE.slice(NOTE.indexOf("## Earlier"));
const DE = NOTE.replace("## Earlier", "## Früher").replace(/until/g, "bis");
const crlf = (s: string) => s.replace(/\n/g, "\r\n");

describe("parseVision", () => {
  it("reads text, updated and earlier versions newest first", () => {
    expect(parseVision(NOTE)).toEqual({
      text: "Write the Lisbon book, speak Spanish at B2, and keep a garden that feeds us.",
      updated: "2026-11-24",
      earlier: [
        { until: "2026-10-01", text: "Write the Lisbon book and learn Spanish." },
        { until: "2026-05-12", text: "Travel more." },
      ],
    });
  });
  it("works without ## Earlier", () => {
    const v = parseVision("---\ntype: questlog-vision\n---\nJust this.\n");
    expect(v).toEqual({ text: "Just this.", updated: null, earlier: [] });
  });
  it("reads German headings", () => {
    const v = parseVision(DE);
    expect(v.earlier.map((e) => e.until)).toEqual(["2026-10-01", "2026-05-12"]);
    expect(v.earlier[1]!.text).toBe("Travel more.");
  });
  it("works without frontmatter", () => {
    expect(parseVision("Hello\n\n## Earlier\n### until 2026-01-01\nOld\n")).toMatchObject({ text: "Hello", earlier: [{ until: "2026-01-01", text: "Old" }] });
  });
  it("does not end the lead at ## inside a fence", () => {
    const c = "---\nupdated: 2026-01-01\n---\nA\n```\n## not a heading\n```\nB\n\n## Earlier\n";
    expect(parseVision(c).text).toBe("A\n```\n## not a heading\n```\nB");
  });
  it("matches lines without the trailing CR", () => {
    const v = parseVision(crlf(NOTE));
    expect(v.text).toBe("Write the Lisbon book, speak Spanish at B2, and keep a garden that feeds us.");
    expect(v.updated).toBe("2026-11-24");
    expect(v.earlier).toHaveLength(2);
    expect(v.earlier[0]!.text).toBe("Write the Lisbon book and learn Spanish.");
  });
  it("reads an empty vision", () => {
    expect(parseVision("---\ntype: questlog-vision\n---\n").text).toBe("");
  });
});

describe("setVisionText", () => {
  it("round-trips the text and keeps ## Earlier byte for byte", () => {
    for (const x of ["New vision.", "Two\nlines", "A\n\nB", ""]) {
      const out = setVisionText(NOTE, x);
      expect(parseVision(out).text).toBe(x);
      expect(out.slice(out.indexOf("## Earlier"))).toBe(EARLIER);
      expect(out.startsWith("---\ntype: questlog-vision\nupdated: 2026-11-24\n---\n")).toBe(true);
    }
  });
  it("escapes lines that would become headings", () => {
    const x = "# Title\n## Sub\nplain\n\\## already";
    const out = setVisionText(NOTE, x);
    expect(out).toContain("\n\\# Title\n\\## Sub\nplain\n\\\\## already\n");
    expect(parseVision(out).text).toBe(x);
    expect(parseVision(out).earlier).toHaveLength(2);
  });
  it("keeps ## inside fences as typed", () => {
    const x = "A\n```\n## code\n```";
    const out = setVisionText(NOTE, x);
    expect(out).toContain("```\n## code\n```");
    expect(parseVision(out).text).toBe(x);
    expect(parseVision(out).earlier).toHaveLength(2);
  });
  it("keeps CRLF notes in CRLF and the rest byte for byte", () => {
    const out = setVisionText(crlf(NOTE), "New\nvision");
    expect(out).toBe(crlf(NOTE).replace(/Write the Lisbon book, speak[^\r]*/, "New\r\nvision"));
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseVision(out).text).toBe("New\nvision");
  });
  it("adds the text to a note that only has frontmatter", () => {
    expect(setVisionText("---\ntype: questlog-vision\n---\n", "Hi")).toBe("---\ntype: questlog-vision\n---\nHi\n");
  });
  it("keeps a note without frontmatter and extra keys", () => {
    expect(setVisionText("Old\n", "New")).toBe("New\n");
    const fm = "---\ntags: [a]\n---\nOld\n";
    expect(setVisionText(fm, "New")).toBe("---\ntags: [a]\n---\nNew\n");
  });
  it("clears the vision with empty text", () => {
    const out = setVisionText(NOTE, "");
    expect(parseVision(out).text).toBe("");
    expect(out.slice(out.indexOf("## Earlier"))).toBe(EARLIER);
  });
});

describe("archiveVision", () => {
  it("inserts the entry at the top of ## Earlier", () => {
    const out = archiveVision(NOTE, "Old one.", "2026-11-25");
    expect(parseVision(out).earlier.map((e) => [e.until, e.text])).toEqual([
      ["2026-11-25", "Old one."],
      ["2026-10-01", "Write the Lisbon book and learn Spanish."],
      ["2026-05-12", "Travel more."],
    ]);
    expect(out.startsWith(NOTE.slice(0, NOTE.indexOf("### until 2026-10-01")))).toBe(true);
    expect(out.endsWith(NOTE.slice(NOTE.indexOf("### until 2026-10-01")))).toBe(true);
  });
  it("creates the section when missing", () => {
    const base = "---\ntype: questlog-vision\n---\nNow.\n";
    expect(archiveVision(base, "Then.", "2026-11-25")).toBe(`${base}\n## Earlier\n### until 2026-11-25\nThen.\n`);
    expect(archiveVision(base.trimEnd(), "Then.", "2026-11-25")).toContain("Now.\n\n## Earlier\n### until 2026-11-25\nThen.\n");
  });
  it("writes the heading words it is given", () => {
    const out = archiveVision("---\n---\nNow.\n", "Then.", "2026-11-25", { earlier: "Früher", until: "bis" });
    expect(out).toContain("## Früher\n### bis 2026-11-25\nThen.");
    expect(parseVision(out).earlier[0]).toEqual({ until: "2026-11-25", text: "Then." });
  });
  it("adds to a German section", () => {
    const out = archiveVision(DE, "Old.", "2026-11-25", { earlier: "Früher", until: "bis" });
    expect(parseVision(out).earlier).toHaveLength(3);
    expect(out.match(/## Früher/g)).toHaveLength(1);
  });
  it("skips empty old text", () => {
    expect(archiveVision(NOTE, "  \n", "2026-11-25")).toBe(NOTE);
  });
  it("two edits on one day give two entries, newest on top", () => {
    let c = archiveVision(NOTE, "First.", "2026-11-25");
    c = archiveVision(c, "Second.", "2026-11-25");
    expect(parseVision(c).earlier.slice(0, 2).map((e) => e.text)).toEqual(["Second.", "First."]);
  });
  it("escapes heading-like lines in old text and restores them", () => {
    const out = archiveVision(NOTE, "## Goal\n### x\nrest", "2026-11-25");
    expect(parseVision(out).earlier[0]!.text).toBe("## Goal\n### x\nrest");
    expect(parseVision(out).earlier).toHaveLength(3);
  });
  it("works on CRLF notes", () => {
    const out = archiveVision(crlf(NOTE), "Old\nlines", "2026-11-25");
    expect(parseVision(out).earlier[0]).toEqual({ until: "2026-11-25", text: "Old\nlines" });
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    const bare = archiveVision(crlf("---\n---\nNow.\n"), "Then.", "2026-11-25");
    expect(bare.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseVision(bare).earlier).toHaveLength(1);
  });
});

describe("newVisionNote", () => {
  it("builds the note", () => {
    expect(newVisionNote("North star.", "2026-11-25")).toBe("---\ntype: questlog-vision\nupdated: 2026-11-25\n---\nNorth star.\n");
    expect(parseVision(newVisionNote("North star.", "2026-11-25"))).toEqual({ text: "North star.", updated: "2026-11-25", earlier: [] });
  });
});
