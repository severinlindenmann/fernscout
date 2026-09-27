import { describe, expect, test } from "vitest";
import { autoSaveTargets } from "@/lib/offlineTrips";

/**
 * B2463 — "Save recent trips automatically" keeps upcoming and current
 * trips plus the two most recently finished ones, and nothing else. Pure
 * function so the selection is provable without a worker, a cache or a
 * clock — `lib/offlineTrips.ts`'s own reasoning for keeping it pure.
 */
describe("autoSaveTargets (B2463)", () => {
  test("upcoming and current trips are always kept", () => {
    const trips = [
      { id: "next-year", status: "upcoming" as const, end: "2027-06-01" },
      { id: "this-one", status: "current" as const, end: "2026-10-01" },
    ];
    expect(autoSaveTargets(trips).sort()).toEqual(["next-year", "this-one"]);
  });

  test("only the two most recently finished past trips are kept", () => {
    const trips = [
      { id: "oldest", status: "past" as const, end: "2020-01-01" },
      { id: "middle", status: "past" as const, end: "2023-01-01" },
      { id: "newest", status: "past" as const, end: "2026-01-01" },
      { id: "second-newest", status: "past" as const, end: "2025-01-01" },
    ];
    expect(autoSaveTargets(trips)).toEqual(["newest", "second-newest"]);
  });

  test("upcoming, current and the two most recent past trips together, in one trip list", () => {
    const trips = [
      { id: "old-trip", status: "past" as const, end: "2018-01-01" },
      { id: "recent-trip-1", status: "past" as const, end: "2026-08-01" },
      { id: "recent-trip-2", status: "past" as const, end: "2026-06-01" },
      { id: "current-trip", status: "current" as const, end: "2026-10-01" },
      { id: "upcoming-trip", status: "upcoming" as const, end: "2027-01-01" },
    ];
    expect(new Set(autoSaveTargets(trips))).toEqual(
      new Set(["current-trip", "upcoming-trip", "recent-trip-1", "recent-trip-2"]),
    );
    expect(autoSaveTargets(trips)).not.toContain("old-trip");
  });

  test("no past trips at all is not an error", () => {
    const trips = [{ id: "upcoming-trip", status: "upcoming" as const, end: "2027-01-01" }];
    expect(autoSaveTargets(trips)).toEqual(["upcoming-trip"]);
  });

  test("an empty trip list keeps nothing", () => {
    expect(autoSaveTargets([])).toEqual([]);
  });
});
