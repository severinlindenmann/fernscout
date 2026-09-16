import { describe, expect, test } from "vitest";
import { suggestCompanion } from "@/lib/extract/companion";
import type { RunManifest } from "@/lib/staging/manifest";

function manifest(days: RunManifest["days"]): RunManifest {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days,
  };
}

describe("suggestCompanion", () => {
  test("names the word the person actually wrote, on the real days they wrote it", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "We had breakfast with Nora before the market." },
        { date: "2026-06-04", answered: [], words: "Nora wanted to see the temple again." },
      ]),
      "en",
    );
    expect(result).toEqual({ name: "Nora", dates: ["2026-06-02", "2026-06-04"] });
  });

  test("a name mentioned on only one day is not suggested — one mention proves nothing", () => {
    const result = suggestCompanion(
      manifest([{ date: "2026-06-02", answered: [], words: "We had breakfast with Nora before the market." }]),
      "en",
    );
    expect(result).toBeNull();
  });

  test("no answers at all suggests nothing, never a placeholder", () => {
    expect(suggestCompanion(manifest([]), "en")).toBeNull();
  });

  test("a place the person named in their own location answer is never offered back as a person", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "We walked around Hoi An all afternoon.", location: "Hoi An" },
        { date: "2026-06-03", answered: [], words: "Back in Hoi An for the lanterns.", location: "Hoi An" },
      ]),
      "en",
    );
    expect(result).toBeNull();
  });

  test("two equally-mentioned candidates are ambiguous and neither is guessed at", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-01", answered: [], words: "We saw Nora and Severin at the market." },
        { date: "2026-06-02", answered: [], words: "Nora and Severin walked back together." },
      ]),
      "en",
    );
    expect(result).toBeNull();
  });

  test("a sentence-initial capital is not mistaken for a name", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-01", answered: [], words: "Wonderful day. Wonderful food too." },
        { date: "2026-06-02", answered: [], words: "Wonderful again, honestly." },
      ]),
      "en",
    );
    expect(result).toBeNull();
  });

  test("Hungarian capitalises proper nouns only, so the suggestion stands there too", () => {
    // Kept uninflected on purpose ("Nora" rather than "Norával") — this
    // heuristic matches surface tokens, not lemmas, so a real Hungarian
    // sentence carrying a case suffix would need stemming this function
    // does not do. What this test proves is narrower and still real: a
    // repeated, mid-sentence capitalised word in Hungarian prose is not
    // suppressed the way German is.
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "Én és Nora korán reggeliztünk." },
        { date: "2026-06-04", answered: [], words: "Ma reggel Nora látni akarta a templomot." },
      ]),
      "hu",
    );
    expect(result).toEqual({ name: "Nora", dates: ["2026-06-02", "2026-06-04"] });
  });

  test("German gets no suggestion at all — it capitalises every noun, not just names", () => {
    // "Strand" (the beach) is mid-sentence, repeated, on two different
    // days — every check `suggestCompanion` runs for English or Hungarian
    // would pass, and the answer would be "is 'the beach' a person?".
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "Wir gingen zum Strand und assen Eis." },
        { date: "2026-06-03", answered: [], words: "Am Strand war es heute kalt." },
      ]),
      "de",
    );
    expect(result).toBeNull();
  });

  test("German gets no suggestion even when a real name repeats exactly the way English's does", () => {
    // The same shape as the very first test above, translated — proves the
    // language check runs before either pass, not that German prose merely
    // fails to produce a candidate by chance.
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "Wir haben mit Nora gefrühstückt." },
        { date: "2026-06-04", answered: [], words: "Nora wollte den Tempel noch einmal sehen." },
      ]),
      "de",
    );
    expect(result).toBeNull();
  });
  // B1803 final review, finding 1 — the exact repro from the review. The
  // undated group's own date is `""`, and a `""` in `dates` becomes "on
  // <Invalid Date>" the moment the screen formats it. There is no "on
  // Tuesday" for a day with no date, so an undated day never contributes a
  // date at all. It can still *confirm* a word is used as a name (pass
  // one), it simply cannot be one of the two days that word has to appear
  // on, which is why one dated day plus one undated day suggests nothing.
  test("a day with no date of its own is never one of the days a name is cited on", () => {
    const result = suggestCompanion(
      manifest([
        { date: "", answered: [], words: "We met Nora at the hostel." },
        { date: "2019-07-02", answered: [], words: "Dinner with Nora again." },
      ]),
      "en",
    );
    expect(result).toBeNull();
  });

  test("two real dates still suggest, and the undated day beside them adds no empty date", () => {
    const result = suggestCompanion(
      manifest([
        { date: "", answered: [], words: "We met Nora at the hostel." },
        { date: "2019-07-02", answered: [], words: "Dinner with Nora again." },
        { date: "2019-07-03", answered: [], words: "Nora came to the market with us." },
      ]),
      "en",
    );
    expect(result).toEqual({ name: "Nora", dates: ["2019-07-02", "2019-07-03"] });
  });
});
