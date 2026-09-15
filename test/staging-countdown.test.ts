import { describe, expect, test } from "vitest";
import { countdownFor, tickIntervalFor } from "@/lib/staging/countdown";

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
