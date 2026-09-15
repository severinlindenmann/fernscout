import { describe, expect, test } from "vitest";
import { MAX_QUESTIONS_PER_DAY, questionsForDay } from "@/lib/extract/questions";

const day = { date: "2019-07-02", answered: [] };
const group = { date: "2019-07-02", photoIds: ["a", "b"], lat: 15.88, lng: 108.33, undated: false };
const photos = [
  { id: "a", filename: "a", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T10:07:00" },
  { id: "b", filename: "b", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T10:41:00" },
];

describe("the questions a day still needs", () => {
  test("the opener names the day, the place, the time and the count", () => {
    const [first] = questionsForDay(group, photos, day, "Hoi An");
    expect(first.kind).toBe("opening");
    expect(first.text).toContain("Hoi An");
    expect(first.text).toContain("Tuesday");
    expect(first.text).toContain("2 photographs");
  });

  test("a day with no coordinate asks where, and says why it does not know", () => {
    const blind = { ...group, lat: undefined, lng: undefined };
    const gap = questionsForDay(blind, photos, day).find((q) => q.fills === "location");
    expect(gap).toBeDefined();
    expect(gap!.text).toContain("don't know where");
  });

  test("an answered question is never asked again", () => {
    const first = questionsForDay(group, photos, day, "Hoi An")[0];
    const again = questionsForDay(group, photos, { ...day, answered: [first.id] }, "Hoi An");
    expect(again.map((q) => q.id)).not.toContain(first.id);
  });

  test("never more than three in one day", () => {
    expect(questionsForDay(group, photos, day, "Hoi An").length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_DAY);
  });
});
