import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * "Share it as a story" on the done screen after publishing — B2665,
 * decision: the first What-next card, deep-linking into the share page
 * with the just-published day already chosen. Take-down keeps its own two
 * cards unchanged (there is nothing to share once a day is off the site).
 *
 * Source-level, like `test/owner-tools.test.ts`'s own keepers: the thing
 * worth pinning is that it is there and first, not the exact JSX shape.
 */
const root = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("PublishDayFlow's done screen", () => {
  test("offers Share as a story as the first card, after a real publish", () => {
    const source = read("components/studio/day/PublishDayFlow.tsx");
    const doneBlock = source.slice(source.indexOf("if (done) {"), source.indexOf("if (chosen) {"));
    expect(doneBlock).toContain("studio/day/share?trip=");
    expect(doneBlock).toContain('t("studio.share.title")');
    // "First" — the share card's own object literal appears in the source
    // before the "open the published day" card's.
    expect(doneBlock.indexOf("studio.share.title")).toBeLessThan(doneBlock.indexOf("dayHref(done)"));
    // Never offered on the take-down screen — nothing to share once a day
    // is off the site, and `takeDown` branches the `next` array for exactly
    // that reason.
    expect(doneBlock).toContain("takeDown\n            ?");
  });

  test("still carries the three cards' own cap (at most three)", () => {
    const source = read("components/studio/DoneScreen.tsx");
    expect(source).toContain("[DoneNext] | [DoneNext, DoneNext] | [DoneNext, DoneNext, DoneNext]");
  });
});
