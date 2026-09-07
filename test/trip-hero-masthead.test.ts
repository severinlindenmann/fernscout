import { describe, expect, test } from "vitest";
import fs from "node:fs";

/**
 * B765 — the masthead names the trip, on every URL that renders it.
 *
 * This asserts on the source rather than on a render: `TripHero` pulls in
 * `motion/react`, `next/image` and a `ResizeObserver`, and nothing in `test/`
 * stubs those, so mounting it here would be testing the stubs. What can be
 * checked cheaply is the thing that actually regressed — the conditional that
 * swapped the trip's title for the journal's whenever the trip happened to be
 * the most recent one.
 */
const SOURCE = fs.readFileSync("components/TripHero.tsx", "utf8");

describe("the trip masthead — B765", () => {
  test("the heading is the trip's title, with no isCurrent branch", () => {
    expect(SOURCE).toMatch(/const heading = localized\.title;/);
    // The exact shape of the bug: the journal's title winning on a current trip.
    expect(SOURCE).not.toMatch(/const heading = active\.isCurrent \? site\.title/);
  });

  test("a trip with no tagline still falls back to the journal's", () => {
    expect(SOURCE).toMatch(/const subheading = localized\.tagline \?\? site\.tagline;/);
  });

  test("the journal's own name is still rendered, by PageHeader", () => {
    // Removing it from the hero is only correct because it is already above.
    expect(fs.readFileSync("components/PageHeader.tsx", "utf8")).toMatch(/site\.title/);
  });
});
