import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * One owner block, in one file — B877.
 *
 * The fault this closes was not a bug in any control. It was that there was
 * nowhere for a control to live: `StoryPager` and `TripStory` each grew their
 * own list, one ticket at a time (B633's notify button, B799's invite, B816's
 * correction link, B844's ask box), in sessions that could not see each other.
 * Four controls, three visual weights, two copies, no heading saying a reader
 * sees none of them.
 *
 * So the test is about *where the controls are*, which is the property that
 * actually decays: a fifth one added to a page instead of to `OwnerTools` is
 * the same mistake happening again, and it would look perfectly reasonable in
 * its own diff.
 */

const root = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const CONTROLS = ["<DayNotify", "<InviteToRead", "<AgentRow", "agent.correctDay"];

describe("the owner's block under a day", () => {
  test("holds all four controls", () => {
    const tools = read("components/OwnerTools.tsx");
    for (const control of CONTROLS) expect(tools, control).toContain(control);
  });

  test("is the only place either page reaches them", () => {
    for (const page of ["components/StoryPager.tsx", "app/TripStory.tsx"]) {
      const source = read(page);
      expect(source, `${page} renders the block`).toContain("<OwnerTools");
      for (const control of CONTROLS) {
        expect(source, `${page} must not render ${control} itself`).not.toContain(control);
      }
    }
  });

  test("says whose it is, so a reader's page and an owner's tools are told apart", () => {
    expect(read("components/OwnerTools.tsx")).toContain("owner.onlyYou");
    for (const locale of ["en", "de", "hu"]) {
      const dict = JSON.parse(read(`site/locales/${locale}.json`)) as Record<string, string>;
      expect(dict["owner.onlyYou"], locale).toBeTruthy();
      expect(dict["owner.onlyYouBody"], locale).toBeTruthy();
    }
  });

  /**
   * B1013 split the label because `EditDay` could edit and could not take a
   * day down; B980 round 3 gave it its own `.../unpublish` door and its own
   * `ConfirmPanel`, so the promise "Correct or take down" is true again on
   * both branches. Assert the route rather than the prose: if `EditDay` ever
   * stops calling it, this is what says the label needs looking at again.
   */
  test("both branches say the same thing, and both can back it up", () => {
    const tools = read("components/OwnerTools.tsx");
    const panel = tools.slice(tools.indexOf("onClick={onCorrect}"));
    expect(panel.slice(0, 200)).toContain("agent.correctDay");
    expect(tools).toContain("agent.correctDay");
    expect(read("components/EditDay.tsx")).toContain("/unpublish");
  });

  test("gives the three buttons one weight", () => {
    // Peers, not a primary and two afterthoughts — which is what three
    // separately-written button classes had made them.
    for (const file of [
      "components/OwnerTools.tsx",
      "components/DayNotify.tsx",
      "components/InviteToRead.tsx",
    ]) {
      expect(read(file), file).toContain("OWNER_TOOL");
    }
  });

  /**
   * B2309 — the owner's own call: the block is the few things there are to
   * do, not a lobby in front of a bigger room. No yellow row into the
   * studio hub, and no probe that only existed to decide whether to draw it.
   */
  test("drops the yellow row into the studio hub, and the probe that gated it", () => {
    const tools = read("components/OwnerTools.tsx");
    expect(tools, "no tone=\"yellow\" row").not.toContain('tone="yellow"');
    expect(tools, "no ask probe").not.toContain("fetch(`/api/helper");
    expect(tools, "askHereOpen went with it").not.toContain("askHereOpen");
    expect(tools, "askHereHint went with it").not.toContain("askHereHint");
  });

  /** The trip page: invite and the studio door, as two peers in the grid —
   *  no underlined text link. */
  test("the trip page offers exactly invite and the studio door, as tiles", () => {
    const tools = read("components/OwnerTools.tsx");
    expect(tools).toContain("owner.editTripInStudio");
    // The old underlined-link styling is gone; the tile is `OWNER_TOOL`.
    const editTripLine = tools.slice(
      tools.indexOf("owner.editTripInStudio") - 400,
      tools.indexOf("owner.editTripInStudio"),
    );
    expect(editTripLine, "the studio door is a grid tile, not an underlined link").toContain(
      "OWNER_TOOL",
    );
    expect(editTripLine).not.toContain("underline");
  });

  /** The day page: no invite, and Edit/Delete are tiles in the same grid as
   *  Inform — not an underlined line under a rule. */
  test("the day page drops invite and draws edit and delete as tiles", () => {
    const tools = read("components/OwnerTools.tsx");
    expect(tools).toContain("{deletable && <DeleteDay username={username} day={deletable} tile />}");
    expect(tools, "InviteToRead only renders on the trip overview").toContain("{!day && <InviteToRead");
  });
});
