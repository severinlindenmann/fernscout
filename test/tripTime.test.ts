import { describe, expect, test } from "vitest";
import {
  calendarStatus,
  daysUntil,
  earliestTodayISO,
  effectiveStatus,
  hasBegun,
  hasHappened,
  isOver,
  isReaderToday,
  readerTodayISO,
} from "@/lib/tripTime";

/**
 * The cases these cover are the ones that were actually wrong, not a sweep of
 * the API: every assertion here fails against the `new Date().toISOString()`
 * arithmetic this module replaced.
 */
describe("earliestTodayISO", () => {
  test("is already tomorrow when UTC is late in the evening", () => {
    // 22:00 UTC on the 14th is 12:00 on the 15th in Kiritimati.
    expect(earliestTodayISO(new Date("2026-03-14T22:00:00Z"))).toBe("2026-03-15");
  });

  test("is UTC's own date in the small hours", () => {
    // 01:00 UTC on the 14th is 15:00 on the *same* 14th at UTC+14.
    expect(earliestTodayISO(new Date("2026-03-14T01:00:00Z"))).toBe("2026-03-14");
  });

  test("carries across a month boundary", () => {
    expect(earliestTodayISO(new Date("2026-01-31T20:00:00Z"))).toBe("2026-02-01");
  });
});

describe("hasHappened", () => {
  test("shows an entry written just after midnight in Hanoi", () => {
    // The author is at UTC+7. It is 00:30 on the 15th where they are, so they
    // date the entry the 15th — but UTC still says the 14th, and the old
    // `date <= utcToday` filter hid the entry for the next seven hours.
    const now = new Date("2026-03-14T17:30:00Z");
    expect(hasHappened("2026-03-15", now)).toBe(true);
  });

  test("still hides a day that has not begun anywhere", () => {
    const now = new Date("2026-03-14T17:30:00Z");
    expect(hasHappened("2026-03-16", now)).toBe(false);
  });

  test("a past day has always happened", () => {
    expect(hasHappened("2020-01-01", new Date("2026-03-14T00:00:00Z"))).toBe(true);
  });
});

describe("readerTodayISO / daysUntil", () => {
  test("counts in the reader's calendar, not UTC's", () => {
    // Constructed from local parts, so this is the reader's own midnight
    // wherever the test happens to run — the assertion is about the
    // arithmetic, not about the machine's zone.
    const now = new Date(2026, 2, 14, 23, 30);
    expect(readerTodayISO(now)).toBe("2026-03-14");
    expect(daysUntil("2026-03-14", now)).toBe(0);
    expect(daysUntil("2026-03-15", now)).toBe(1);
    expect(daysUntil("2026-03-21", now)).toBe(7);
  });

  test("does not shift by one late in the reader's evening", () => {
    // The bug this replaces: at 23:30 local east of UTC, `toISOString()` still
    // reports yesterday, so a trip starting tomorrow was announced as two days
    // away. Both times below are the same reader's 14th of March.
    const earlyInTheDay = new Date(2026, 2, 14, 0, 30);
    const lateInTheDay = new Date(2026, 2, 14, 23, 30);
    expect(daysUntil("2026-03-15", earlyInTheDay)).toBe(
      daysUntil("2026-03-15", lateInTheDay),
    );
  });

  test("a start date in the past reads as begun rather than negative", () => {
    expect(daysUntil("2026-03-01", new Date(2026, 2, 14, 12, 0))).toBe(0);
  });

  test("survives a malformed date rather than rendering NaN", () => {
    expect(daysUntil("not-a-date", new Date(2026, 2, 14, 12, 0))).toBe(0);
  });

  test("isReaderToday tracks the reader's own calendar", () => {
    const now = new Date(2026, 2, 14, 23, 30);
    expect(isReaderToday("2026-03-14", now)).toBe(true);
    expect(isReaderToday("2026-03-15", now)).toBe(false);
  });
});

describe("effectiveStatus", () => {
  // B72: a trip created through the write API with dates already in the past
  // took the `upcoming` default and kept it. Three published days were hidden
  // behind a countdown that could not say anything else.
  const now = new Date("2026-09-01T12:00:00Z");

  test("a trip whose start has passed is past, whatever the file says", () => {
    expect(effectiveStatus({ start: "2026-08-24", status: "upcoming" }, now)).toBe("past");
  });

  test("a trip whose start is still ahead is upcoming, whatever the file says", () => {
    expect(effectiveStatus({ start: "2027-04-02", status: "past" }, now)).toBe("upcoming");
  });

  test("current is the author's own choice and survives the calendar", () => {
    // Which trip the bare /<user> URLs serve is editorial, not arithmetic —
    // and a trip that ran long keeps its pulsing dot until somebody says
    // otherwise. `isOver` is what decides that, from the dates and the days.
    expect(effectiveStatus({ start: "2020-01-01", status: "current" }, now)).toBe("current");
    expect(effectiveStatus({ start: "2099-01-01", status: "current" }, now)).toBe("current");
  });

  test("a trip under way reads as past, the side that shows its days", () => {
    // It began yesterday and ends next week, and nobody declared it current.
    // "Past" is the wrong word for it and the right bucket: upcoming is the
    // one that hides what has been published.
    expect(effectiveStatus({ start: "2026-08-31", status: "upcoming" }, now)).toBe("past");
  });

  test("turns over in the earliest calendar, like hasHappened", () => {
    // 17:30 UTC on the 14th is already the 15th in Kiritimati, so a trip
    // starting on the 15th has begun rather than being a day away.
    const evening = new Date("2026-03-14T17:30:00Z");
    expect(calendarStatus({ start: "2026-03-15" }, evening)).toBe("past");
    expect(calendarStatus({ start: "2026-03-16" }, evening)).toBe("upcoming");
  });
});

describe("isOver", () => {
  test("a trip marked past is over, whatever its end date says", () => {
    // The status a `Trip` carries has already been through `effectiveStatus`,
    // so `past` here means the calendar's answer or a demoted rival for
    // `current` — either way, not the trip under way, and not something to
    // second-guess with arithmetic about `end`.
    const trip = { end: "2099-01-01", status: "past" as const };
    expect(isOver(trip, [], new Date("2026-03-14T00:00:00Z"))).toBe(true);
  });

  test("an upcoming trip is never over", () => {
    // A trip that hasn't started can't have its end date "happen" for this
    // purpose — an author who pre-dates a countdown page shouldn't see it
    // flip to "over" because of a stray `end:` in the past.
    const trip = { end: "2020-01-01", status: "upcoming" as const };
    expect(isOver(trip, [], new Date("2026-03-14T00:00:00Z"))).toBe(false);
  });

  test("a current trip is not over while its end date is still ahead", () => {
    const trip = { end: "2026-03-20", status: "current" as const };
    const days = [{ date: "2026-03-14" }];
    expect(isOver(trip, days, new Date("2026-03-14T12:00:00Z"))).toBe(false);
  });

  test("errs early, in the earliest calendar, the same direction as hasHappened", () => {
    // Same case as the hasHappened test above: it is already the 15th in
    // Kiritimati while UTC still says the 14th. A trip ending on the 15th
    // should already read as over rather than waiting for every reader's
    // own midnight — the whole point of matching hasHappened's calendar.
    const trip = { end: "2026-03-15", status: "current" as const };
    const days = [{ date: "2026-03-14" }];
    const now = new Date("2026-03-14T17:30:00Z");
    expect(isOver(trip, days, now)).toBe(true);
  });

  test("an author who kept writing past their own end date is still travelling", () => {
    // Guards against a stale `end:` in trip.md prematurely declaring the
    // trip over while fresh entries keep arriving after it.
    const trip = { end: "2026-03-10", status: "current" as const };
    const days = [{ date: "2026-03-10" }, { date: "2026-03-15" }];
    expect(isOver(trip, days, new Date("2026-03-16T00:00:00Z"))).toBe(false);
  });

  test("a current trip with nothing written yet is over once its end date has passed", () => {
    const trip = { end: "2026-03-10", status: "current" as const };
    expect(isOver(trip, [], new Date("2026-03-16T00:00:00Z"))).toBe(true);
  });
});

/**
 * B19 — the other end of `isOver`.
 *
 * Everything phrased as "so far" needs this answered first: spend per day,
 * pace against a budget, a projected total. The costs page asked none of it
 * and computed all of it anyway, over an empty set.
 */
describe("hasBegun", () => {
  test("a trip whose start is still ahead has not begun", () => {
    const trip = { start: "2027-04-02", status: "upcoming" as const };
    expect(hasBegun(trip, [], new Date("2026-06-01T00:00:00Z"))).toBe(false);
  });

  test("a trip whose start has come has begun, whatever its frontmatter says", () => {
    // The B72 case, asked the other way round: `status: upcoming` left in a
    // trip.md nobody has edited since the trip was created.
    const trip = { start: "2026-08-24", status: "upcoming" as const };
    expect(hasBegun(trip, [], new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });

  test("the trip under way has begun, and its dates are not consulted", () => {
    const trip = { start: "2099-01-01", status: "current" as const };
    expect(hasBegun(trip, [], new Date("2026-03-14T00:00:00Z"))).toBe(true);
  });

  test("a finished trip has begun", () => {
    const trip = { start: "2023-05-01", status: "past" as const };
    expect(hasBegun(trip, [], new Date("2026-03-14T00:00:00Z"))).toBe(true);
  });

  test("a day already written and already happened settles it", () => {
    // The mirror of the guard in `isOver`: the flight moved forward, the trip
    // started a week early, and nobody edited `start:`.
    const trip = { start: "2026-03-20", status: "upcoming" as const };
    const days = [{ date: "2026-03-13" }];
    expect(hasBegun(trip, days, new Date("2026-03-14T00:00:00Z"))).toBe(true);
  });

  test("a day dated ahead of today is still a plan", () => {
    const trip = { start: "2027-04-02", status: "upcoming" as const };
    const days = [{ date: "2027-04-14" }];
    expect(hasBegun(trip, days, new Date("2026-06-01T00:00:00Z"))).toBe(false);
  });

  test("turns over in the earliest calendar, like hasHappened", () => {
    // 17:30 UTC on the 14th is already the 15th in Kiritimati.
    const now = new Date("2026-03-14T17:30:00Z");
    expect(hasBegun({ start: "2026-03-15", status: "upcoming" }, [], now)).toBe(true);
    expect(hasBegun({ start: "2026-03-16", status: "upcoming" }, [], now)).toBe(false);
  });
});
