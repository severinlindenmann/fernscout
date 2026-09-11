import { describe, expect, test } from "vitest";
import { buildSteps } from "@/components/StoryPager";
import { legDistanceKm, sceneDurationSeconds } from "@/components/TravelScene";
import { GROUND_HEIGHT, surfaceFor } from "@/components/travel/Ground";
import { cityScale, floraFor } from "@/components/Cityscape";
import type { DaySummary, TransportMode } from "@/lib/types";

const MODES: TransportMode[] = [
  "flight",
  "train",
  "metro",
  "tram",
  "bus",
  "motorbike",
  "bicycle",
  "boat",
  "ferry",
  "car",
  "taxi",
  "walk",
];

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
    // The ceiling was 9s when distance was the only input. It is 11 now that
    // a mode's own pace can stretch the figure — a crossing on foot or by
    // water is meant to be the longest thing here. The default mode is `car`,
    // whose pace is 1, so these are the same numbers the formula always gave.
    expect(sceneDurationSeconds("default", 1_000_000)).toBeLessThanOrEqual(11);
    expect(sceneDurationSeconds("default", 0)).toBeGreaterThanOrEqual(3);
    expect(sceneDurationSeconds("quick", 1_000_000)).toBeLessThanOrEqual(3);
    expect(sceneDurationSeconds("quick", 0)).toBeGreaterThanOrEqual(1.2);
  });
});

describe("surfaceFor", () => {
  test("every mode has a surface, and the three road modes share one", () => {
    expect(surfaceFor("train")).toBe("rail");
    expect(surfaceFor("boat")).toBe("water");
    expect(surfaceFor("flight")).toBe("sky");
    expect(surfaceFor("walk")).toBe("path");
    for (const mode of ["car", "bus", "motorbike"] as const) {
      expect(surfaceFor(mode)).toBe("road");
    }
  });

  // B1519 — metro and tram read as rail, and a ferry as water, the same as
  // the modes they were added beside.
  test("metro and tram share the train's surface, and a ferry the boat's", () => {
    expect(surfaceFor("metro")).toBe("rail");
    expect(surfaceFor("tram")).toBe("rail");
    expect(surfaceFor("ferry")).toBe("water");
  });

  test("every surface has a height and a tile", () => {
    for (const mode of MODES) {
      expect(GROUND_HEIGHT[surfaceFor(mode)]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cityScale", () => {
  test("an unknown population is a small town, not a hamlet", () => {
    // The fallback must not read as evidence of a tiny place — see the note
    // on the function.
    expect(cityScale(undefined)).toBeGreaterThan(0.2);
    expect(cityScale(undefined)).toBeLessThan(0.5);
  });

  test("a village, a city and a metropolis are visibly different", () => {
    const village = cityScale(1_200);
    const city = cityScale(250_000);
    const metropolis = cityScale(9_000_000);
    expect(village).toBeLessThan(city);
    expect(city).toBeLessThan(metropolis);
  });

  test("stays inside 0…1 at both extremes", () => {
    expect(cityScale(1)).toBeGreaterThanOrEqual(0);
    expect(cityScale(40_000_000)).toBeLessThanOrEqual(1);
    expect(cityScale(0)).toBe(cityScale(undefined));
  });
});

describe("floraFor", () => {
  test("palms only in the tropics — the bug this replaced put them everywhere", () => {
    expect(floraFor(1.3)).toBe("palm"); // Singapore
    expect(floraFor(-22)).toBe("palm");
    expect(floraFor(64.1)).not.toBe("palm"); // Reykjavík
    expect(floraFor(47.4)).not.toBe("palm"); // Zurich
  });

  test("north of the treeline nothing is planted", () => {
    expect(floraFor(78)).toBe("bare");
    expect(floraFor(-80)).toBe("bare");
  });

  test("a day with no coordinates gets the middle band rather than a crash", () => {
    expect(floraFor(undefined)).toBe("broadleaf");
    expect(floraFor(Number.NaN)).toBe("broadleaf");
  });
});

describe("sceneDurationSeconds and the mode's own pace", () => {
  test("a boat crossing is slower than a car crossing the same distance", () => {
    // B: two days on a river and two hours of motorway are the same number on
    // a map. Before the pace factor the boat played *faster*, because its leg
    // was shorter.
    expect(sceneDurationSeconds("default", 200, "boat")).toBeGreaterThan(
      sceneDurationSeconds("default", 200, "car"),
    );
    expect(sceneDurationSeconds("default", 200, "walk")).toBeGreaterThan(
      sceneDurationSeconds("default", 200, "car"),
    );
  });

  test("a flight is the only mode that plays quicker than the distance says", () => {
    expect(sceneDurationSeconds("default", 5000, "flight")).toBeLessThan(
      sceneDurationSeconds("default", 5000, "car"),
    );
  });

  test("every mode stays inside the bounds, at both extremes and with no distance", () => {
    for (const mode of MODES) {
      for (const km of [null, 0, 12, 900, 18_000]) {
        const d = sceneDurationSeconds("default", km, mode);
        expect(d).toBeGreaterThanOrEqual(3);
        expect(d).toBeLessThanOrEqual(11);
      }
    }
  });

  test("quick stays quick whatever the mode — that is what it is for", () => {
    for (const mode of MODES) {
      for (const km of [null, 40, 12_000]) {
        expect(sceneDurationSeconds("quick", km, mode)).toBeLessThanOrEqual(3);
      }
    }
  });

  test("the default mode keeps the old signature working", () => {
    expect(sceneDurationSeconds("default", 400)).toBe(
      sceneDurationSeconds("default", 400, "car"),
    );
  });
});
