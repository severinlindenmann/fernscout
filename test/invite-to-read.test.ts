import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B799 — the offer to show a day to somebody, on the day itself.
 *
 * The one property worth a test rather than a look: **this control can only
 * ever make a guest link.** A guest link belongs in a family group chat and a
 * buddy link leads to write access to a trip, which is why the two have
 * separate URLs and separate words on the contacts page. A button on a day
 * page that could hand over the wrong one by mistake would be the worst place
 * in the product for that mistake, so there is deliberately no kind to choose
 * here — the choice stays on the contacts page, where the two sit side by side
 * under the sentences that say what each does.
 *
 * Read from the source rather than rendered: the component fetches on mount to
 * decide whether to show itself at all, which `renderToStaticMarkup` never
 * runs — and what is being asserted is what it *can* ask the server for, which
 * is a fact about the file.
 */

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "components/InviteToRead.tsx"), "utf8");

describe("the share control on a day", () => {
  test("asks for a guest link and has no way to ask for a buddy one", () => {
    expect(source).toContain('kind: "guest"');
    expect(source, "no buddy link is reachable from here").not.toMatch(/"buddy"/);
    expect(source, "and no trip is named, which this route refuses anyway").not.toMatch(
      /\btrip:/,
    );
  });

  test("says what a guest link does in the contacts page's own words", () => {
    // `me.inviteGuestBody` is "…they see nothing until you say yes" — the
    // sentence that keeps this honest about granting nothing.
    expect(source).toContain("me.inviteGuestBody");
    expect(source).toContain("me.inviteGuestTitle");
  });

  test("is on the day she just published, and on the trip page", () => {
    // Both render it through `OwnerTools` since B877 — one block, so a fifth
    // control lands in one place rather than being added twice in two styles.
    const tools = fs.readFileSync(path.join(root, "components/OwnerTools.tsx"), "utf8");
    expect(tools).toContain("<InviteToRead");

    const day = fs.readFileSync(path.join(root, "components/StoryPager.tsx"), "utf8");
    const trip = fs.readFileSync(path.join(root, "app/TripStory.tsx"), "utf8");
    // Only for somebody who could have published it. `canPublish` is exactly
    // `isOwner` — see `lib/tripGate.ts`.
    expect(day).toMatch(/trip\?\.canPublish[\s\S]{0,80}<OwnerTools/);
    expect(trip).toMatch(/trip\?\.canPublish[\s\S]{0,80}<OwnerTools/);
  });
});
