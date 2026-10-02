import { describe, expect, test } from "vitest";
import { KEYTERM_MAX_CHARS, KEYTERM_MAX_COUNT, keytermsFor } from "@/lib/helper/keyterms";

/**
 * The trip's own vocabulary, built for Deepgram — B2691.
 *
 * Pure, so the cap/dedupe/no-email rules are checkable without a trip on
 * disk: `lib/entries.ts`'s `getPlaces` and a `Trip`'s own `people` are what
 * a caller (the transcribe route) passes in.
 */
describe("keytermsFor", () => {
  test("carries place names and companion names/nicknames", () => {
    const places = [{ location: "Kotor" }, { location: "Hoi An" }];
    const people = [{ name: "Maria Example", nickname: "Mia" }, { name: "Jo Example" }];
    const terms = keytermsFor(places, people);
    expect(terms).toEqual(["Kotor", "Hoi An", "Mia", "Maria Example", "Jo Example"]);
  });

  test("never an email address, even when the trip person carries one", () => {
    // The real shape a caller passes (`Trip.people`, `lib/types.ts`'s
    // `TripPerson`) always has an `email` field alongside `name`/`nickname`;
    // this asserts it never reaches the output, not just that nothing here
    // happens to read it.
    const people = [{ name: "Alex Example", nickname: "Al", email: "alex@example.test" }];
    const terms = keytermsFor([], people);
    expect(terms).toEqual(["Al", "Alex Example"]);
    expect(terms.join(" ")).not.toContain("@");
  });

  test("dedupes case-insensitively across places and people", () => {
    const places = [{ location: "Kotor" }, { location: "kotor" }];
    const people = [{ name: "Kotor" }];
    expect(keytermsFor(places, people)).toEqual(["Kotor"]);
  });

  test("drops a term longer than the per-term cap", () => {
    const tooLong = "a".repeat(KEYTERM_MAX_CHARS + 1);
    expect(keytermsFor([{ location: tooLong }], [])).toEqual([]);
    const justFits = "a".repeat(KEYTERM_MAX_CHARS);
    expect(keytermsFor([{ location: justFits }], [])).toEqual([justFits]);
  });

  test("caps the whole list at the count ceiling", () => {
    const places = Array.from({ length: KEYTERM_MAX_COUNT + 20 }, (_, i) => ({ location: `Place ${i}` }));
    const terms = keytermsFor(places, []);
    expect(terms).toHaveLength(KEYTERM_MAX_COUNT);
  });

  test("blank and whitespace-only names are skipped", () => {
    expect(keytermsFor([{ location: "  " }], [{ name: "", nickname: "   " }])).toEqual([]);
  });

  test("no trip, no error: empty in, empty out", () => {
    expect(keytermsFor([], [])).toEqual([]);
  });
});
