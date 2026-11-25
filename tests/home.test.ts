import { describe, expect, it } from "vitest";
import { nextTaskFor } from "../src/data/home";
import type { Task } from "../src/data/model";

const t = (id: string, done = false): Task => ({ id, text: id, done, doneDate: null, line: 0, questPath: "Q.md", stage: null, stageIndex: null });

describe("nextTaskFor", () => {
  it("today's task first", () => {
    expect(nextTaskFor([t("s")], [t("d")])?.id).toBe("d");
  });
  it("falls back to the first open stage task", () => {
    expect(nextTaskFor([t("s0", true), t("s1")], [])?.id).toBe("s1");
  });
  it("nothing open gives null, done tasks never returned", () => {
    expect(nextTaskFor([t("s", true)], [t("d", true)])).toBeNull();
    expect(nextTaskFor([], [])).toBeNull();
  });
});
