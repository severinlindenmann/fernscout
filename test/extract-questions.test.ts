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

  test("the opener reads the first photograph by capture time, not upload order", () => {
    // Uploaded out of order: the evening photo arrives first in `photos`,
    // but it was taken after the morning one — the opener must still speak
    // of the morning, because that is when the day began.
    const outOfOrder = [
      { id: "b", filename: "b", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T19:41:00" },
      { id: "a", filename: "a", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T10:07:00" },
    ];
    const [first] = questionsForDay(group, outOfOrder, day, "Hoi An");
    expect(first.text).toContain("morning");
    expect(first.text).not.toContain("evening");
  });

  test("an undated group asks when before it asks what, with no broken grammar", () => {
    const undated = { date: "", photoIds: ["a", "b"], undated: true };
    const undatedDay = { date: "", answered: [] };
    const undatedPhotos = [
      { id: "a", filename: "a", bytes: 1, kind: "image" as const },
      { id: "b", filename: "b", bytes: 1, kind: "image" as const },
    ];

    const withPlace = questionsForDay(undated, undatedPhotos, undatedDay, "Hoi An");
    expect(withPlace[0].fills).toBe("date");
    expect(withPlace[0].text).toContain("don't carry a date");
    expect(withPlace[1].kind).toBe("opening");
    expect(withPlace[1].text).toBe("You took 2 photographs in Hoi An. What were you doing?");
    for (const q of withPlace) expect(q.text).not.toMatch(/ {2}/);

    const withoutPlace = questionsForDay(undated, undatedPhotos, undatedDay);
    expect(withoutPlace[1].text).toBe("You took 2 photographs. What were you doing?");
    for (const q of withoutPlace) expect(q.text).not.toMatch(/ {2}/);
  });

  test("a dated day never gets asked when it happened", () => {
    const dated = questionsForDay(group, photos, day, "Hoi An");
    expect(dated.some((q) => q.fills === "date")).toBe(false);
  });
});
