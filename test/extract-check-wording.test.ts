import { describe, expect, test } from "vitest";
import { splitOnWord } from "@/components/extract/CheckWording";

/**
 * S7b — "Check the wording" — B1803 Task 3.4.
 *
 * `splitOnWord` is the whole of how the screen locates its own highlight: a
 * substring search in the real transcript, never a rejoin of tokens that
 * could reintroduce spacing Deepgram's own `smart_format` never put there.
 * The screen-level behaviour this backs — highlight and tip panel present
 * only when the server actually flagged a word, silent otherwise — is
 * exercised in `test/helper-transcribe.test.ts` for the data it depends on;
 * this file is the pure function underneath it.
 */
describe("splitOnWord — the check-the-wording screen's own highlight", () => {
  test("slices the transcript around the flagged word, punctuation and all", () => {
    const text = "That yellow wall is the place we kept going back to — Ban Mi Fuong, I think it was.";
    const split = splitOnWord(text, "Ban Mi Fuong,");
    expect(split).not.toBeNull();
    expect(split!.pre).toBe("That yellow wall is the place we kept going back to — ");
    expect(split!.word).toBe("Ban Mi Fuong,");
    expect(split!.post).toBe(" I think it was.");
    // Rejoining pre + word + post must reproduce the original exactly —
    // the whole reason this is a substring slice and not a token rejoin.
    expect(split!.pre + split!.word + split!.post).toBe(text);
  });

  test("is null with no word to flag — a plain transcript, not a guessed highlight", () => {
    expect(splitOnWord("Nothing uncertain here.", undefined)).toBeNull();
  });

  test("is null when the flagged word cannot actually be found in the text", () => {
    expect(splitOnWord("We walked to the market.", "Fuong")).toBeNull();
  });
});
