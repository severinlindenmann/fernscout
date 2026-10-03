import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * "Share it as a story" after publishing — B2665, moved by B2678 off the old
 * done screen's own What-next cards onto `PublishedDay.tsx` (Preview's own
 * success state, since B2677 moved publishing itself off `PublishDayFlow`):
 * the story card leads, then one card of three action rows, never loose
 * underlined links (the owner's own objection the ticket names).
 *
 * Source-level, like `test/owner-tools.test.ts`'s own keepers: the thing
 * worth pinning is that it is there and first, not the exact JSX shape.
 */
const root = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("PublishedDay — B2678", () => {
  test("Share as a story leads, before the three-row action card", () => {
    const source = read("components/studio/day/PublishedDay.tsx");
    expect(source).toContain("studio/day/share?trip=");
    expect(source).toContain('t("studio.share.title")');
    // Compared within the actual markup (`return (`), not the `rows` array
    // literal declared above it, which names `sendLink` first for unrelated
    // reasons (it is simply the first row).
    const markup = source.slice(source.indexOf("return (\n    <div"));
    expect(markup.indexOf("studio.share.title")).toBeLessThan(markup.indexOf('rows.map'));
  });

  test("the action card is three rows sharing one target size, not loose links", () => {
    const source = read("components/studio/day/PublishedDay.tsx");
    expect(source).toContain("studio.published.sendLink");
    expect(source).toContain("studio.published.nextDay");
    expect(source).toContain("studio.published.addPhotos");
    // Every row shares one 64px-ish target and a hairline divider between
    // them, inside one bordered card — `min-h-16`/`divide-y`/one
    // `rounded-2xl border` wrapper around all three, not three separate
    // underlined links loose in the page.
    expect(source).toContain("min-h-14 w-full"); // B2765: 56px rows with 18px vertical padding, text wraps freely
    expect(source).toContain("divide-y divide-line-faint overflow-hidden rounded-2xl border");
  });

  test("what happened comes straight from the publish response, in a green band", () => {
    const source = read("components/studio/day/PublishedDay.tsx");
    expect(source).toContain("readerLine");
    expect(source).toContain("bg-green-100");
  });

  test("PublishDayFlow no longer carries a publish done screen — B2677 moved it to Preview", () => {
    const source = read("components/studio/day/PublishDayFlow.tsx");
    expect(source).not.toContain("studio.share.title");
    expect(source).not.toContain("studio.publish.done\"");
  });
});
