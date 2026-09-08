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
   * B1013 — the tile said "Correct or take down" on both branches, and only
   * one of them can take a day down: the wizard has `takeDown()`, `EditDay`
   * has no unpublish at all. A label offering a capability that is not there
   * sends somebody looking for it.
   */
  test("only the branch that can take a day down says so", () => {
    const tools = read("components/OwnerTools.tsx");
    // The panel branch — a <button> calling onCorrect — must not promise it.
    const panel = tools.slice(tools.indexOf("onClick={onCorrect}"));
    expect(panel.slice(0, 200)).toContain("agent.editDay");
    expect(panel.slice(0, 200)).not.toContain("agent.correctDay");
    // And the wizard branch, which can, still does.
    expect(tools).toContain("agent.correctDay");
    // The claim above about EditDay is the reason for the split — its own doc
    // says "it cannot publish and it cannot unpublish", which is B28's
    // separation. Assert the route rather than the prose: if it ever calls
    // one, this test is what says the labels need looking at again.
    expect(read("components/EditDay.tsx")).not.toContain("/unpublish");
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
});
