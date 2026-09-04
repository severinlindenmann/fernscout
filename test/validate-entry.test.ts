import { describe, expect, test } from "vitest";
import { validateEntry, TAG_MAX_LENGTH, type Problem } from "@/lib/validate/entry";

/**
 * What an agent is told when it gets an entry wrong.
 *
 * These assert the *message*, not just the rejection. The reader of a
 * validation error is a program trying to fix its own payload without asking
 * a person, and "invalid entry" sends it guessing — field, what arrived, and
 * what was expected is the difference between one round trip and five.
 */

/** A payload with nothing wrong with it, to vary one field at a time. */
const ok = { date: "2026-08-26", content: "The old town hangs with lanterns." };

function fieldsOf(problems: Problem[]): string[] {
  return problems.map((p) => p.field);
}

function only(input: Record<string, unknown>): Problem {
  const problems = validateEntry({ ...ok, ...input });
  expect(problems, `expected exactly one problem, got ${JSON.stringify(problems)}`).toHaveLength(1);
  return problems[0];
}

describe("a valid entry", () => {
  test("passes with the bare minimum", () => {
    expect(validateEntry(ok)).toEqual([]);
  });

  test("passes with every optional field filled in", () => {
    expect(
      validateEntry({
        ...ok,
        time: "16:45",
        lat: 15.8801,
        lng: 108.338,
        transportMode: "bus",
        costs: [{ label: "Dinner", amount: 180000, category: "food", currency: "VND" }],
        tags: ["vietnam", "hoi-an"],
      }),
    ).toEqual([]);
  });
});

describe("dates", () => {
  test("a date that is not a date is refused", () => {
    expect(only({ date: "26-08-2026" })).toMatchObject({
      field: "date",
      got: '"26-08-2026"',
      expected: "a real calendar date, as YYYY-MM-DD",
    });
  });

  /** The one a pattern alone lets through, and the reason the check parses. */
  test("the 30th of February is well-formed and still not a date", () => {
    expect(only({ date: "2026-02-30" }).field).toBe("date");
    expect(validateEntry({ ...ok, date: "2026-02-28" })).toEqual([]);
  });

  test("a missing date is refused", () => {
    expect(only({ date: undefined })).toMatchObject({ field: "date", got: "nothing" });
  });

  test("time must be a 24-hour clock", () => {
    expect(only({ time: "4:45pm" }).expected).toBe("HH:mm, 00:00 to 23:59");
    expect(only({ time: "24:00" }).field).toBe("time");
    expect(validateEntry({ ...ok, time: "00:00" })).toEqual([]);
    expect(validateEntry({ ...ok, time: "23:59" })).toEqual([]);
  });
});

describe("coordinates", () => {
  test("out of range is refused, with the range", () => {
    expect(only({ lat: 195, lng: 10 })).toMatchObject({ field: "lat", got: "195", expected: "-90 to 90" });
    expect(only({ lat: 10, lng: -400 })).toMatchObject({ field: "lng", expected: "-180 to 180" });
  });

  /** Half a coordinate is not a place — it is a typo waiting to be plotted
   * at 0,0, in the Gulf of Guinea. */
  test("one without the other is refused", () => {
    expect(only({ lat: 15.88 })).toMatchObject({ field: "lng", got: "nothing" });
    expect(only({ lng: 108.3 })).toMatchObject({ field: "lat", got: "nothing" });
  });

  test("a string that looks like a number is still not one", () => {
    expect(only({ lat: "15.88", lng: 108.3 })).toMatchObject({ field: "lat", got: '"15.88"' });
  });
});

describe("transport", () => {
  test("an unknown mode is refused, and the message lists the known ones", () => {
    const problem = only({ transportMode: "teleport" });
    expect(problem.field).toBe("transportMode");
    expect(problem.expected).toContain("flight");
    expect(problem.expected).toContain("walk");
  });

  test("every documented mode is accepted", () => {
    for (const mode of ["flight", "train", "bus", "motorbike", "boat", "car", "walk"]) {
      expect(validateEntry({ ...ok, transportMode: mode }), mode).toEqual([]);
    }
  });
});

describe("travelScene", () => {
  test("every documented variant is accepted", () => {
    for (const variant of ["default", "quick", "skip"]) {
      expect(validateEntry({ ...ok, travelScene: variant }), variant).toEqual([]);
    }
  });

  test("a non-string is refused", () => {
    expect(only({ travelScene: 3 })).toMatchObject({ field: "travelScene", got: "3" });
  });

  test("an unrecognised string is accepted — unlike transportMode, a typo here is not a 400", () => {
    // It still has to round-trip and fall back at render time, which is
    // lib/entries.ts's job (parseTravelSceneVariant) and not this module's.
    expect(validateEntry({ ...ok, travelScene: "epic-flyover" })).toEqual([]);
  });
});

describe("costs", () => {
  test("the problem names which item, not just 'costs'", () => {
    const problems = validateEntry({
      ...ok,
      costs: [{ label: "Fine", amount: 12 }, { label: "Dinner", amount: "twelve" }],
    });
    expect(fieldsOf(problems)).toEqual(["costs[1].amount"]);
    expect(problems[0].got).toBe('"twelve"');
    expect(problems[0].expected).toBe("a number");
  });

  test("a missing label is refused", () => {
    expect(only({ costs: [{ amount: 12 }] }).field).toBe("costs[0].label");
  });

  test("an unknown category is refused", () => {
    expect(only({ costs: [{ label: "x", amount: 1, category: "snacks" }] }).field).toBe(
      "costs[0].category",
    );
  });

  test("costs that are not a list at all", () => {
    expect(only({ costs: "some money" })).toMatchObject({ field: "costs" });
  });
});

describe("tags", () => {
  test("a tag with spaces or capitals is refused", () => {
    expect(only({ tags: ["Hoi An"] }).field).toBe("tags[0]");
    expect(only({ tags: ["Vietnam"] }).field).toBe("tags[0]");
  });

  test("a tag longer than the limit is refused", () => {
    expect(validateEntry({ ...ok, tags: ["a".repeat(TAG_MAX_LENGTH)] })).toEqual([]);
    expect(only({ tags: ["a".repeat(TAG_MAX_LENGTH + 1)] }).field).toBe("tags[0]");
  });
});

describe("the body", () => {
  test("empty prose is refused — a day with no words is not a day", () => {
    expect(only({ content: "" }).field).toBe("content");
    expect(only({ content: "   \n  " }).field).toBe("content");
    expect(only({ content: undefined }).field).toBe("content");
  });
});

/**
 * The property the whole module exists for: one round trip, not five.
 */
describe("everything at once", () => {
  test("reports every problem, not the first", () => {
    const problems = validateEntry({
      date: "26-08-2026",
      time: "nope",
      lat: 999,
      lng: 10,
      transportMode: "teleport",
      costs: [{ label: "", amount: "lots" }],
      tags: ["Not A Tag"],
      content: "",
    });
    expect(fieldsOf(problems).sort()).toEqual(
      [
        "content",
        "costs[0].amount",
        "costs[0].label",
        "date",
        "lat",
        "tags[0]",
        "time",
        "transportMode",
      ].sort(),
    );
  });
});
