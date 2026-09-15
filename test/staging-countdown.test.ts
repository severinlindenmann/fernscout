import { describe, expect, test } from "vitest";
import {
  countdownFor,
  segmentsFor,
  tickIntervalFor,
  urgencyFor,
  windowFractionFor,
} from "@/lib/staging/countdown";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function at(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe("countdownFor", () => {
  test("two days out reads as days and hours", () => {
    const tier = countdownFor(at(2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000), NOW);
    expect(tier).toEqual({ unit: "days", days: 2, hours: 3 });
  });

  test("one day out reads as one day, no hours", () => {
    const tier = countdownFor(at(24 * 60 * 60 * 1000), NOW);
    expect(tier).toEqual({ unit: "days", days: 1, hours: 0 });
  });

  test("a few hours out reads as minutes", () => {
    const tier = countdownFor(at(2 * 60 * 60 * 1000), NOW);
    expect(tier).toEqual({ unit: "minutes", minutes: 120 });
  });

  test("one minute out reads as seconds", () => {
    const tier = countdownFor(at(60 * 1000), NOW);
    expect(tier).toEqual({ unit: "seconds", seconds: 60 });
  });

  test("zero reads as now, never a negative number", () => {
    expect(countdownFor(NOW.toISOString(), NOW)).toEqual({ unit: "now" });
  });

  test("past zero — a run the sweep hasn't caught yet — still reads as now, not a stale positive figure", () => {
    const tier = countdownFor(at(-60 * 60 * 1000), NOW);
    expect(tier).toEqual({ unit: "now" });
  });

  test("the days/minutes pivot is exactly three hours", () => {
    expect(countdownFor(at(3 * 60 * 60 * 1000), NOW)).toEqual({ unit: "days", days: 0, hours: 3 });
    expect(countdownFor(at(3 * 60 * 60 * 1000 - 1), NOW)).toMatchObject({ unit: "minutes" });
  });

  test("the minutes/seconds pivot is exactly one hour", () => {
    expect(countdownFor(at(60 * 60 * 1000), NOW)).toEqual({ unit: "minutes", minutes: 60 });
    expect(countdownFor(at(60 * 60 * 1000 - 1), NOW)).toMatchObject({ unit: "seconds" });
  });

  test("extended — a later expiresAt against the same now reads the new deadline", () => {
    const before = countdownFor(at(2 * 60 * 60 * 1000), NOW);
    const after = countdownFor(at(48 * 60 * 60 * 1000), NOW);
    expect(before).toEqual({ unit: "minutes", minutes: 120 });
    expect(after).toMatchObject({ unit: "days", days: 2 });
  });
});

describe("tickIntervalFor", () => {
  test("scales down with urgency, and stops once it reads now", () => {
    expect(tickIntervalFor({ unit: "days", days: 2, hours: 0 })).toBe(60_000);
    expect(tickIntervalFor({ unit: "minutes", minutes: 90 })).toBe(30_000);
    expect(tickIntervalFor({ unit: "seconds", seconds: 30 })).toBe(1000);
    expect(tickIntervalFor({ unit: "now" })).toBe(0);
  });
});

/** B1806 — the ticker's own colour ladder, derived from the same tier
 *  `countdownFor` already sorts a run into. */
describe("urgencyFor", () => {
  test("a whole day or more left reads calm", () => {
    expect(urgencyFor({ unit: "days", days: 2, hours: 3 })).toBe("calm");
    expect(urgencyFor({ unit: "days", days: 1, hours: 0 })).toBe("calm");
  });

  test("under a day but at least an hour reads soon, from either tier that covers it", () => {
    // 3h–24h: the "days" tier with no days left.
    expect(urgencyFor({ unit: "days", days: 0, hours: 23 })).toBe("soon");
    // 1h–3h: the "minutes" tier.
    expect(urgencyFor({ unit: "minutes", minutes: 90 })).toBe("soon");
  });

  test("under an hour reads urgent", () => {
    expect(urgencyFor({ unit: "seconds", seconds: 30 })).toBe("urgent");
  });

  test("past zero reads gone", () => {
    expect(urgencyFor({ unit: "now" })).toBe("gone");
  });
});

/** B1806 — segment count follows the same tier boundaries: four while a
 *  whole day remains, three below that, two below an hour, and the past-zero
 *  shape reads as three digits pinned to zero rather than a negative or a
 *  missing box. Values are floored straight from the raw milliseconds, not
 *  read back off the tier's own rounded fields. */
describe("segmentsFor", () => {
  test("a whole day or more: four segments, days down to seconds", () => {
    const ms = 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 14 * 60 * 1000 + 7 * 1000;
    const tier = countdownFor(at(ms), NOW);
    expect(segmentsFor(tier, ms)).toEqual([
      { unit: "days", value: 2 },
      { unit: "hours", value: 3 },
      { unit: "minutes", value: 14 },
      { unit: "seconds", value: 7 },
    ]);
  });

  test("under a day, at least an hour: three segments, hours down to seconds — no days box even at exactly zero days", () => {
    const ms = 20 * 60 * 60 * 1000 + 14 * 60 * 1000 + 7 * 1000; // 20h14m07s
    const tier = countdownFor(at(ms), NOW);
    expect(tier).toMatchObject({ unit: "days", days: 0 });
    expect(segmentsFor(tier, ms)).toEqual([
      { unit: "hours", value: 20 },
      { unit: "minutes", value: 14 },
      { unit: "seconds", value: 7 },
    ]);
  });

  test("the same three-segment shape from the minutes tier (1h–3h out)", () => {
    const ms = 2 * 60 * 60 * 1000 + 5 * 60 * 1000 + 9 * 1000; // 2h05m09s
    const tier = countdownFor(at(ms), NOW);
    expect(tier).toMatchObject({ unit: "minutes" });
    expect(segmentsFor(tier, ms)).toEqual([
      { unit: "hours", value: 2 },
      { unit: "minutes", value: 5 },
      { unit: "seconds", value: 9 },
    ]);
  });

  test("under an hour: two segments, minutes and seconds only", () => {
    const ms = 43 * 1000; // 43s
    const tier = countdownFor(at(ms), NOW);
    expect(tier).toMatchObject({ unit: "seconds" });
    expect(segmentsFor(tier, ms)).toEqual([
      { unit: "minutes", value: 0 },
      { unit: "seconds", value: 43 },
    ]);
  });

  test("past zero: three segments, every one pinned at 00 — never negative", () => {
    const tier = countdownFor(NOW.toISOString(), NOW);
    expect(segmentsFor(tier, -60_000)).toEqual([
      { unit: "hours", value: 0 },
      { unit: "minutes", value: 0 },
      { unit: "seconds", value: 0 },
    ]);
  });
});

describe("windowFractionFor", () => {
  const run = { createdAt: at(0), expiresAt: at(48 * 60 * 60 * 1000) };

  test("half the initial 48-hour window left reads as one half", () => {
    expect(windowFractionFor(run, new Date(NOW.getTime() + 24 * 60 * 60 * 1000))).toBeCloseTo(0.5);
  });

  test("a fresh run reads as a full bar", () => {
    expect(windowFractionFor(run, NOW)).toBe(1);
  });

  test("past its own expiresAt reads as an empty bar, never negative", () => {
    expect(windowFractionFor(run, new Date(NOW.getTime() + 72 * 60 * 60 * 1000))).toBe(0);
  });

  test("a warning repins the window to the 24 hours it promised, not the original 48", () => {
    const warnedAt = at(30 * 60 * 60 * 1000); // warned 30h in
    const warned = { ...run, warnedAt, expiresAt: at(54 * 60 * 60 * 1000) }; // pinned to warnedAt+24h
    // Right at the warning: the new window is still full.
    expect(windowFractionFor(warned, new Date(Date.parse(warnedAt)))).toBe(1);
    // Twelve hours into the 24-hour warned window: half left.
    expect(
      windowFractionFor(warned, new Date(Date.parse(warnedAt) + 12 * 60 * 60 * 1000)),
    ).toBeCloseTo(0.5);
  });

  test("an extension refills the bar to the new 48-hour window, not the fraction of the old one", () => {
    const extendedAt = at(40 * 60 * 60 * 1000);
    const extended = {
      ...run,
      warnedAt: at(30 * 60 * 60 * 1000),
      extendedAt,
      expiresAt: new Date(Date.parse(extendedAt) + 48 * 60 * 60 * 1000).toISOString(),
    };
    expect(windowFractionFor(extended, new Date(Date.parse(extendedAt)))).toBe(1);
  });
});
