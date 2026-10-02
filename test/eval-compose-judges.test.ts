import { describe, expect, test } from "vitest";
import { bannedPhraseCheck, judgeRubricMarkdown } from "../scripts/eval-compose/judges";

/**
 * The one check in the eval harness that is never a judge's job —
 * `bannedPhraseCheck` just re-runs `composeGuard`'s own deterministic
 * regex, which is already proven against `composeDay`'s guard tests; this
 * only proves the eval-side wrapper calls it correctly and stays exempt
 * when the owner's own notes use the word.
 */
describe("bannedPhraseCheck", () => {
  test("flags a machine phrase the owner never wrote", () => {
    const result = bannedPhraseCheck("It was a truly unforgettable day in the old town.", ["en"], "walked around, had lunch");
    expect(result.pass).toBe(false);
    expect(result.hits).toEqual(expect.arrayContaining(["unforgettable", "truly"]));
  });

  test("is exempt when the owner's own notes used the word", () => {
    const result = bannedPhraseCheck("Unforgettable, she said.", ["en"], "unforgettable, she said, more than once");
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  test("passes plain text", () => {
    expect(bannedPhraseCheck("We walked to the station and had coffee.", ["en"], "").pass).toBe(true);
  });
});

describe("judgeRubricMarkdown", () => {
  test("names the exact verdict JSON shape and all three rubrics", () => {
    const md = judgeRubricMarkdown();
    expect(md).toContain('"caseId"');
    expect(md).toContain('"grounding"');
    expect(md).toContain('"endsWithSummingUp"');
    expect(md).toContain('"wouldPublish"');
    expect(md).toContain("UNSUPPORTED");
  });
});
