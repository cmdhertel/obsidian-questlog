import { describe, expect, it } from "vitest";
import { addDays, weekIdToDay } from "../src/data/dates";
import { buildStory, mentionsQuest, type StoryInput } from "../src/data/story";

const clock = (h: number, m = 0) => h * 60 + m;
const input = (): StoryInput => ({
  quest: {
    name: "Travel book",
    created: "2026-09-01",
    paused: null,
    finished: null,
    stages: [
      { name: "Research", started: "2026-09-01", reached: "2026-09-28" },
      { name: "Part two", started: "2026-10-20", reached: null },
    ],
    tasks: [
      { text: "Read three guides", done: true, doneDate: "2026-09-20", stage: "Research", line: 7 },
      { text: "Draft the Lisbon chapter", done: false, doneDate: null, stage: "Part two", line: 9 },
    ],
  },
  sessions: [
    { day: "2026-09-02", start: clock(9), end: clock(10), note: "Outline" },
    { day: "2026-09-03", start: clock(9), end: clock(9, 30), note: "" },
    { day: "2026-09-20", start: clock(14), end: clock(14, 45), note: "" },
  ],
  closing: [{ day: "2026-09-02", text: "Good start." }],
  reviews: [{ id: "2026-W36", lastDay: addDays(weekIdToDay("2026-W36")!, 6), answers: { "What went well?": "The [[Travel book]] outline took shape." } }],
});

describe("buildStory", () => {
  it("builds the four chapters of the example", () => {
    const s = buildStory(input());
    expect(s.map((w) => w.weekStart)).toEqual(["2026-08-31", "2026-09-14", "2026-09-28", "2026-10-19"]);
    const [a, b, c, d] = s;
    expect(a).toEqual({
      weekStart: "2026-08-31",
      minutes: 90,
      sessionCount: 2,
      marks: [
        { day: "2026-09-01", kind: "stage-started", stage: "Research" },
        { day: "2026-09-01", kind: "created" },
      ],
      done: [],
      notes: [{ day: "2026-09-02", text: "Outline" }],
      closing: [{ day: "2026-09-02", text: "Good start." }],
      reflections: [{ question: "What went well?", text: "The [[Travel book]] outline took shape." }],
    });
    expect(b).toMatchObject({ minutes: 45, sessionCount: 1, done: [{ day: "2026-09-20", text: "Read three guides", stage: "Research" }], marks: [] });
    expect(c).toMatchObject({ minutes: 0, marks: [{ day: "2026-09-28", kind: "stage-reached", stage: "Research" }] });
    expect(d).toMatchObject({ minutes: 0, marks: [{ day: "2026-10-20", kind: "stage-started", stage: "Part two" }] });
  });

  it("lists a reached stage before the next one started on the same day", () => {
    const i = input();
    i.quest.stages[1]!.started = "2026-09-28";
    expect(buildStory(i).find((w) => w.weekStart === "2026-09-28")!.marks.map((m) => m.kind)).toEqual(["stage-reached", "stage-started"]);
  });

  it("attaches a review to the week of its id", () => {
    const i = input();
    i.reviews = [{ id: "2026-W38", lastDay: addDays(weekIdToDay("2026-W38")!, 6), answers: { Q: "travel book again", Other: "nothing" } }];
    const s = buildStory(i);
    expect(s.find((w) => w.weekStart === "2026-09-14")!.reflections).toEqual([{ question: "Q", text: "travel book again" }]);
    expect(s.find((w) => w.weekStart === "2026-08-31")!.reflections).toEqual([]);
  });

  it("puts a paused mark in its week", () => {
    const i = input();
    i.quest.paused = "2026-10-02";
    expect(buildStory(i).find((w) => w.weekStart === "2026-09-28")!.marks.map((m) => m.kind)).toEqual(["stage-reached", "paused"]);
  });

  it("filters by range", () => {
    expect(buildStory(input(), { from: "2026-09-01" }).map((w) => w.weekStart)).toEqual(["2026-09-14", "2026-09-28", "2026-10-19"]);
    expect(buildStory(input(), { to: "2026-09-14" }).map((w) => w.weekStart)).toEqual(["2026-08-31", "2026-09-14"]);
  });

  it("shows closing lines only for days with time", () => {
    const i = input();
    i.closing.push({ day: "2026-09-21", text: "Rest day." });
    expect(buildStory(i).flatMap((w) => w.closing.map((c) => c.day))).toEqual(["2026-09-02"]);
  });

  it("is empty for empty input", () => {
    expect(
      buildStory({ quest: { name: "X", created: null, paused: null, finished: null, stages: [], tasks: [] }, sessions: [], closing: [], reviews: [] }),
    ).toEqual([]);
  });
});

describe("mentionsQuest", () => {
  it("follows the whole-word, link and case rules", () => {
    expect(mentionsQuest("The garden grew", "Garden")).toBe(true);
    expect(mentionsQuest("garden.", "Garden")).toBe(true);
    expect(mentionsQuest("Gardener", "Garden")).toBe(false);
    expect(mentionsQuest("[[Garden|plot]]", "Garden")).toBe(true);
    expect(mentionsQuest("[[Garden#Beds]]", "Garden")).toBe(true);
    expect(mentionsQuest("[[Garden]]", "Garden")).toBe(true);
    expect(mentionsQuest("Garden-party", "Garden")).toBe(true);
    expect(mentionsQuest("Gärtnerei", "Garden")).toBe(false);
    expect(mentionsQuest("Spanisch für Gärten", "Gärten")).toBe(true);
    expect(mentionsQuest("Ein Gartenhaus", "Garten")).toBe(false);
    expect(mentionsQuest("Garden2", "Garden")).toBe(false);
    expect(() => mentionsQuest("I like C++ a lot", "C++")).not.toThrow();
    expect(mentionsQuest("I like C++ a lot", "C++")).toBe(true);
    expect(mentionsQuest("anything", "")).toBe(false);
  });
});
