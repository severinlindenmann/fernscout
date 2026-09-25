import { describe, expect, test } from "vitest";
import { splitOnWord } from "@/components/extract/CheckWording";

/**
 * S7b — "Check the wording" — B1803 Task 3.4, fix round 2.
 *
 * `splitOnWord` is the whole of how the screen locates its own highlight: a
 * substring search in the real transcript, driven by which *occurrence* of
 * the flagged word `leastConfidentWord` actually meant — never a rejoin of
 * tokens that could reintroduce spacing Deepgram's own `smart_format` never
 * put there, and never just the first occurrence of the word regardless of
 * which one the provider was actually unsure about (the bug fix round 1
 * shipped and round 2 exists to close). The screen-level behaviour this
 * backs — highlight and tip panel present only when the server actually
 * flagged a word, silent otherwise — is exercised in
 * `test/helper-transcribe.test.ts` for the data it depends on; this file is
 * the pure function underneath it.
 */
describe("splitOnWord — the check-the-wording screen's own highlight", () => {
  test("slices the transcript around the flagged word, punctuation and all", () => {
    const text = "That yellow wall is the place we kept going back to — Ban Mi Fuong, I think it was.";
    const split = splitOnWord(text, { word: "Ban Mi Fuong,", occurrence: 0 });
    expect(split).not.toBeNull();
    expect(split!.pre).toBe("That yellow wall is the place we kept going back to — ");
    expect(split!.word).toBe("Ban Mi Fuong,");
    expect(split!.post).toBe(" I think it was.");
    // Rejoining pre + word + post must reproduce the original exactly —
    // the whole reason this is a substring slice and not a token rejoin.
    expect(split!.pre + split!.word + split!.post).toBe(text);
  });

  test("a word said twice highlights the SECOND occurrence when that is the flagged one", () => {
    // "Fuong" appears twice — once confidently, once as the word Deepgram
    // itself was unsure about. Round 1's bug always grabbed the first.
    const text = "We think it was Fuong, or maybe not Fuong at all.";
    const split = splitOnWord(text, { word: "Fuong", occurrence: 1 });
    expect(split).not.toBeNull();
    expect(split!.pre).toBe("We think it was Fuong, or maybe not ");
    expect(split!.word).toBe("Fuong");
    expect(split!.post).toBe(" at all.");
    expect(split!.pre + split!.word + split!.post).toBe(text);
  });

  test("the punctuated form is what gets highlighted, not the bare word", () => {
    // `smart_format` gives `punctuated_word`; the transcript itself carries
    // the punctuation, so the flagged word must too or it will not be found.
    const text = "That yellow wall is the place — Ban Mi Fuong, I think it was.";
    const split = splitOnWord(text, { word: "Fuong,", occurrence: 0 });
    expect(split).not.toBeNull();
    expect(split!.word).toBe("Fuong,");
    expect(split!.pre + split!.word + split!.post).toBe(text);
  });

  test("is null for an empty transcript", () => {
    expect(splitOnWord("", { word: "Fuong", occurrence: 0 })).toBeNull();
  });

  test("is null with no word to flag — a plain transcript, not a guessed highlight", () => {
    expect(splitOnWord("Nothing uncertain here.", undefined)).toBeNull();
  });

  test("is null when the flagged word cannot actually be found in the text at all", () => {
    expect(splitOnWord("We walked to the market.", { word: "Fuong", occurrence: 0 })).toBeNull();
  });

  test("is null when the flagged occurrence does not exist even though the word does", () => {
    // The word is said once, but the flag claims a second occurrence.
    expect(splitOnWord("We think it was Fuong.", { word: "Fuong", occurrence: 1 })).toBeNull();
  });
});
