import { describe, expect, test } from "vitest";
import { saysTheListAgain } from "@/lib/helper/model";
import type { Block } from "@/lib/helper/blocks";

/**
 * The list, said a second time — B1161.
 *
 * Live evidence, `past_conversations` on fernscout.ch: four rows a person can
 * press, and underneath them a paragraph beginning *"You have 18 earlier
 * conversations. The most recent was about making your trip visible to
 * guests. Others include renaming your journal to Reisen mit Renate…"* — the
 * same answer twice, once as controls and once as prose nobody can press.
 *
 * B1120 had already fixed it in the tool's `describe`, in words, and the words
 * did not hold. That is the third time this file has learned it (B829), and
 * this is the code guard.
 *
 * **The half worth protecting is the honest turn.** A guard that fires when
 * nothing is wrong is as serious as one that misses — being told "I would
 * rather not give you a figure" for a fair question is its own way of making
 * the software useless. So most of what is below is turns that must pass.
 */

function chooseOf(count: number): Block {
  return {
    shape: "choose",
    text: "Past conversations",
    options: Array.from({ length: count }, (_, n) => ({
      value: `s${n}`,
      label: `a conversation about something ${n}`,
      detail: "2026-09-09",
    })),
  };
}

const REPEATED =
  "You have 18 earlier conversations. The most recent was about making your " +
  "trip visible to guests. Others include renaming your journal to Reisen mit " +
  "Renate, asking what the trip cost, adding Mira to the trip, and setting a " +
  "rate for baht. Tap any of them to open it again.";

describe("a block that already lists things", () => {
  test("catches the paragraph that says the rows again", () => {
    expect(saysTheListAgain(REPEATED, [chooseOf(4)])).toBe(true);
  });

  /**
   * The reason this is a length check and not a text match, kept as a test so
   * the next person does not 'improve' it into one: the model **paraphrased**.
   * "rename my journal to Reisen mit Renate" came back as "renaming your
   * journal to Reisen mit Renate". Nothing in the answer matches a label
   * exactly, and chasing rewordings is the list that is always missing its
   * next entry.
   */
  test("the repeated paragraph shares no exact label with the block", () => {
    const labels = (chooseOf(4) as { options: { label: string }[] }).options;
    for (const option of labels) {
      expect(REPEATED.includes(option.label)).toBe(false);
    }
  });

  test("a sentence saying what the list is passes", () => {
    expect(
      saysTheListAgain("Here are your earlier conversations. Tap one to open it again.", [
        chooseOf(4),
      ]),
    ).toBe(false);
  });

  test("two sentences still pass — the threshold is generous on purpose", () => {
    const honest =
      "Here are your earlier conversations, most recent first. Tap any of them " +
      "to open it again and carry on where you left off.";
    expect(honest.length).toBeLessThan(240);
    expect(saysTheListAgain(honest, [chooseOf(4)])).toBe(false);
  });

  test("a long answer with no list beside it passes", () => {
    // The guard is about a turn that drew rows. A turn that drew none is
    // somebody being answered at length, which is allowed.
    expect(saysTheListAgain(REPEATED, [{ shape: "say", text: "" }])).toBe(false);
  });

  test("two rows are not a list, so a fuller answer about them passes", () => {
    // Three is where a list becomes a list; naming both of two is a person
    // being told what they are looking at.
    expect(saysTheListAgain(REPEATED, [chooseOf(2)])).toBe(false);
  });

  test("a files block counts too — the fault is the shape, not the tool", () => {
    const files: Block = {
      shape: "files",
      text: "Waiting",
      files: [
        { id: "a", name: "one.jpg" },
        { id: "b", name: "two.jpg" },
        { id: "c", name: "three.csv" },
      ],
    };
    expect(saysTheListAgain(REPEATED, [files])).toBe(true);
  });
});
