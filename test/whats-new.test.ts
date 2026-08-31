import { describe, expect, test } from "vitest";
import {
  LEGACY_KEYS,
  lastVisitKey,
  newestDate,
  resumeKey,
  visitMark,
  visitMarkKey,
  whatsNew,
} from "@/lib/whatsNew";

/**
 * "4 new days since your last visit" — the banner on the trip hero.
 *
 * It had three faults, and none of them needed a browser to have. The sums and
 * the key names are here so they can be argued about in a test rather than in
 * a screenshot:
 *
 *  - it stayed on screen after the reader had clicked Show me and read the
 *    days, because nothing recorded that they had acted on it;
 *  - one unscoped localStorage key was shared by every trip on the instance,
 *    so opening an older trip rewound the mark and the current trip then
 *    announced its whole run as new, over and over;
 *  - a first-time reader must never see it, because "everything is new" is
 *    not news.
 */

function days(...dates: string[]) {
  return dates.map((date) => ({ date }));
}

const trip = days(
  "2026-06-03",
  "2026-06-19",
  "2026-07-28",
  "2026-08-24",
);

describe("whatsNew", () => {
  test("says nothing to a first-time reader", () => {
    expect(whatsNew(trip, null, null)).toEqual({ firstIndex: -1, count: 0 });
  });

  test("counts the days published since the stamped visit", () => {
    expect(whatsNew(trip, "2026-06-03", null)).toEqual({
      firstIndex: 1,
      count: 3,
    });
  });

  test("says nothing when the reader is up to date", () => {
    expect(whatsNew(trip, "2026-08-24", null)).toEqual({
      firstIndex: -1,
      count: 0,
    });
  });

  test("says nothing when the stamp is ahead of the trip", () => {
    // Can't happen once the key is scoped per trip, but a stamp from a
    // half-migrated browser must read as "nothing new", never as a negative
    // count or the whole trip.
    expect(whatsNew(trip, "2027-01-01", null)).toEqual({
      firstIndex: -1,
      count: 0,
    });
  });

  test("clears once the reader has reached one of the new days", () => {
    // The bug the reader actually saw: click Show me, read the day, press
    // Overview, and the banner is back offering the same three days.
    expect(whatsNew(trip, "2026-06-03", "2026-06-19")).toEqual({
      firstIndex: -1,
      count: 0,
    });
  });

  test("stays while the reader is only wandering the days they had seen", () => {
    // Paging around the old part of the trip is not reading the new part, so
    // the prompt still has a job to do.
    expect(whatsNew(trip, "2026-06-19", "2026-06-03")).toEqual({
      firstIndex: 2,
      count: 2,
    });
  });

  test("clears on the day itself, not only past it", () => {
    expect(whatsNew(trip, "2026-07-28", "2026-08-24")).toEqual({
      firstIndex: -1,
      count: 0,
    });
  });

  test("counts the new days rather than measuring from the first one", () => {
    // Subtracting the first new index from the length is the same number only
    // while the index is sorted. Two of these three are new, not three.
    const jumbled = days("2026-08-24", "2026-06-03", "2026-07-28");
    expect(whatsNew(jumbled, "2026-06-03", null)).toEqual({
      firstIndex: 0,
      count: 2,
    });
  });

  test("says nothing about an empty trip", () => {
    expect(whatsNew([], "2026-06-03", null)).toEqual({
      firstIndex: -1,
      count: 0,
    });
  });
});

describe("newestDate", () => {
  test("is the latest date, whatever the order", () => {
    expect(newestDate(days("2026-06-19", "2026-08-24", "2026-07-28"))).toBe(
      "2026-08-24",
    );
  });

  test("is empty for a trip with no days", () => {
    expect(newestDate([])).toBe("");
  });
});

describe("visitMark", () => {
  test("takes the stored mark the first time this visit looks", () => {
    expect(visitMark(null, "2026-06-03")).toBe("2026-06-03");
  });

  test("keeps what this visit already recorded, over the stamp", () => {
    // The remount case, and the whole reason the mark exists: by now
    // localStorage says 2026-08-24 because arriving stamped it there. Believing
    // that would tell the reader they are up to date with days they have not
    // opened — which is exactly what `next dev` did on every page.
    expect(visitMark("2026-06-03", "2026-08-24")).toBe("2026-06-03");
  });

  test("distinguishes a recorded absence from not having looked", () => {
    // "" means this visit looked and found no previous mark — a first-time
    // reader. It must not be mistaken for null and re-read from a localStorage
    // that has since been stamped.
    expect(visitMark("", "2026-08-24")).toBe("");
    expect(visitMark(null, null)).toBe("");
  });
});

describe("storage keys", () => {
  test("are scoped to one trip", () => {
    // The whole bug: /example and /example/trips/parks-2025 shared a stamp, so
    // reading the 2025 trip rewound the mark to 2025-09-22 and the current
    // trip then declared all four of its days new on the way back.
    expect(lastVisitKey("example/usa-2026")).not.toBe(
      lastVisitKey("example/parks-2025"),
    );
    expect(resumeKey("example/usa-2026")).not.toBe(
      resumeKey("example/parks-2025"),
    );
  });

  test("are scoped to one journal, not just one trip id", () => {
    // Trip ids are unique within a user, not across the instance.
    expect(lastVisitKey("ada/alps-2024")).not.toBe(lastVisitKey("bo/alps-2024"));
  });

  test("do not collide with each other", () => {
    const ref = "example/usa-2026";
    const keys = [lastVisitKey(ref), resumeKey(ref), visitMarkKey(ref)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("scope the visit mark per trip too", () => {
    expect(visitMarkKey("example/usa-2026")).not.toBe(
      visitMarkKey("example/parks-2025"),
    );
  });

  test("are not the unscoped names they replaced", () => {
    for (const legacy of LEGACY_KEYS) {
      expect(lastVisitKey("example/usa-2026")).not.toBe(legacy);
      expect(resumeKey("example/usa-2026")).not.toBe(legacy);
      expect(visitMarkKey("example/usa-2026")).not.toBe(legacy);
    }
  });
});
