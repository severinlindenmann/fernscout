import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import {
  getAllEntries,
  getAllMedia,
  getDays,
  getDefaultDay,
  getEntryBySlug,
  getPlaces,
  getTripStats,
} from "@/lib/entries";

beforeEach(() => {
  process.env.CONTENT_DIR = path.join(process.cwd(), "test", "fixtures", "content");
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("trip scoping", () => {
  test("each trip sees only its own entries", () => {
    expect(getAllEntries("u/alpha-2023").map((e) => e.slug)).toEqual(["faro", "lagos"]);
    expect(getAllEntries("u/beta-2026").map((e) => e.slug)).toEqual([
      "bangkok",
      "bangkok-night",
    ]);
  });

  test("an unknown trip is empty, not an error", () => {
    expect(getAllEntries("u/no-such-trip")).toEqual([]);
    expect(getDays("u/no-such-trip")).toEqual([]);
    expect(getPlaces("u/no-such-trip")).toEqual([]);
  });

  test("a slug is looked up within its trip only", () => {
    expect(getEntryBySlug("u/alpha-2023", "faro")?.title).toBe("Faro");
    expect(getEntryBySlug("u/beta-2026", "faro")).toBeUndefined();
  });

  test("caching one trip does not serve it to another", () => {
    getAllEntries("u/alpha-2023");
    expect(getAllEntries("u/beta-2026")[0].country).toBe("Thailand");
  });
});

describe("grouping", () => {
  test("two updates on one date become one day, in time order", () => {
    const days = getDays("u/beta-2026");
    expect(days).toHaveLength(1);
    expect(days[0].entries.map((e) => e.slug)).toEqual(["bangkok", "bangkok-night"]);
    expect(days[0].lead.slug).toBe("bangkok");
  });

  test("consecutive days in different places become separate places", () => {
    expect(getPlaces("u/alpha-2023").map((p) => p.location)).toEqual(["Faro", "Lagos"]);
  });

  /**
   * B339. `location:` is optional, so a day written without one is `""` — and
   * the merge compared `"" === ""` and called it the same place. A fifteen-day
   * trip from Bangkok to Hanoi became one marker on Bangkok, the other fourteen
   * coordinates discarded, on every surface that goes through `getPlaces`.
   */
  test("days with coordinates but no place name each keep their own place", () => {
    const places = getPlaces("u/unnamed-2025");

    expect(places).toHaveLength(3);
    expect(places.map((p) => p.lat)).toEqual([13.7563, 18.7883, 21.0285]);
  });

  test("stats count that trip only", () => {
    const stats = getTripStats("u/alpha-2023");
    expect(stats.dayCount).toBe(2);
    expect(stats.tripDays).toBe(3); // 1st to 3rd inclusive
    expect(stats.countries).toBe(1);
    expect(stats.firstDate).toBe("2023-05-01");
  });

  test("the default day is the last one not in the future", () => {
    expect(getDefaultDay("u/alpha-2023")?.date).toBe("2023-05-03");
  });

  test("media is scoped too", () => {
    expect(getAllMedia("u/alpha-2023")).toHaveLength(1);
    expect(getAllMedia("u/beta-2026")).toHaveLength(0);
  });
});

/**
 * "Days on the road" is elapsed time, not how often somebody wrote.
 *
 * `getTripStats` has always had both numbers — the test above pins them at 2
 * and 3 for the same trip. The trips index was reading `dayCount` under a
 * label that says days on the road, so a fortnight with five entries read as
 * five days. These two must not be allowed to quietly become the same thing.
 */
describe("days written against days elapsed", () => {
  test("a gap between two entries still counts as time on the road", () => {
    const stats = getTripStats("u/alpha-2023");
    expect(stats.dayCount).toBe(2);
    expect(stats.tripDays).toBe(3);
    expect(stats.tripDays).toBeGreaterThan(stats.dayCount);
  });

  test("several updates on one day are one day, by both counts", () => {
    const stats = getTripStats("u/beta-2026");
    expect(stats.dayCount).toBe(1);
    expect(stats.tripDays).toBe(1);
  });
});
