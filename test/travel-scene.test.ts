import { describe, expect, test } from "vitest";
import { buildSteps } from "@/components/StoryPager";
import { legDistanceKm, sceneDurationSeconds } from "@/components/TravelScene";
import type { DaySummary } from "@/lib/types";

/**
 * B15 — more than one travel scene, with a reason to pick each.
 *
 * These test the pure logic behind the component rather than the animation
 * itself: this repo's test environment is plain Node (no jsdom), so a real
 * DOM effect, `window.matchMedia` or `onComplete` firing cannot be driven
 * from here — see test-banner.test.tsx for how the rest of the suite copes
 * with the same limit. What can be pinned down, and is the part most likely
 * to actually break, is: does an unwanted variant still get a step in the
 * pager, and does the duration formula behave the way the ticket asks for.
 */

function day(over: Partial<DaySummary>): DaySummary {
  return {
    date: "2026-01-01",
    slug: "d",
    location: "X",
    country: "Y",
    lat: 0,
    lng: 0,
    updates: 1,
    cost: 0,
    ...over,
  };
}

describe("buildSteps and travelScene", () => {
  test("a day with no variant gets a travel step — today's exact behaviour", () => {
    const steps = buildSteps([day({ slug: "a" }), day({ slug: "b", transport: { mode: "train", from: "A", to: "B" } })]);
    expect(steps.map((s) => s.kind)).toContain("travel");
  });

  test("'skip' leaves the leg out of the pager entirely", () => {
    const steps = buildSteps([
      day({ slug: "a" }),
      day({
        slug: "b",
        transport: { mode: "train", from: "A", to: "B" },
        travelScene: "skip",
      }),
    ]);
    expect(steps.map((s) => s.kind)).not.toContain("travel");
    // The day itself is still there — only the scene is skipped.
    expect(steps.filter((s) => s.kind === "day")).toHaveLength(2);
  });

  test("'quick' and 'default' still get a step — only 'skip' removes one", () => {
    for (const travelScene of ["default", "quick", undefined] as const) {
      const steps = buildSteps([
        day({ slug: "a" }),
        day({ slug: "b", transport: { mode: "bus", from: "A", to: "B" }, travelScene }),
      ]);
      expect(steps.map((s) => s.kind), String(travelScene)).toContain("travel");
    }
  });
});

describe("legDistanceKm", () => {
  test("null when the previous day is missing", () => {
    expect(legDistanceKm(undefined, day({}))).toBeNull();
  });

  test("null when a coordinate is missing on either end", () => {
    const from = day({ lat: undefined as unknown as number, lng: 8 });
    expect(legDistanceKm(from, day({ lat: 47, lng: 8 }))).toBeNull();
  });

  test("roughly right for a known pair of cities (Zürich–Paris, ~488 km great-circle)", () => {
    const zurich = day({ lat: 47.3769, lng: 8.5417 });
    const paris = day({ lat: 48.8566, lng: 2.3522 });
    const km = legDistanceKm(zurich, paris);
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(470);
    expect(km!).toBeLessThan(510);
  });

  test("zero for two identical points", () => {
    expect(legDistanceKm(day({ lat: 10, lng: 20 }), day({ lat: 10, lng: 20 }))).toBe(0);
  });
});

describe("sceneDurationSeconds", () => {
  test("unknown distance falls back to a fixed middle value, per variant", () => {
    expect(sceneDurationSeconds("default", null)).toBe(6);
    expect(sceneDurationSeconds("quick", null)).toBeCloseTo(1.8);
  });

  test("a short hop is faster than a transoceanic leg, for both variants", () => {
    for (const variant of ["default", "quick"] as const) {
      const short = sceneDurationSeconds(variant, 20);
      const long = sceneDurationSeconds(variant, 12000);
      expect(long, variant).toBeGreaterThan(short);
    }
  });

  test("'quick' is always shorter than 'default' at the same distance", () => {
    for (const km of [0, 50, 500, 5000, 20000]) {
      expect(sceneDurationSeconds("quick", km)).toBeLessThan(sceneDurationSeconds("default", km));
    }
  });

  test("duration is clamped, however far the leg goes", () => {
    expect(sceneDurationSeconds("default", 1_000_000)).toBeLessThanOrEqual(9);
    expect(sceneDurationSeconds("default", 0)).toBeGreaterThanOrEqual(3);
    expect(sceneDurationSeconds("quick", 1_000_000)).toBeLessThanOrEqual(2.6);
    expect(sceneDurationSeconds("quick", 0)).toBeGreaterThanOrEqual(1.2);
  });
});
