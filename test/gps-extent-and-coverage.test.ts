import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importGps, discardImportedHistory, purgeGpsHistory } from "@/lib/gps/api";
import { appendFixes, gpsDir, readRange } from "@/lib/gps/store";

/**
 * B1937 — the peek screen's own promise: an extent, never a route.
 *
 * `importGps`'s outcome is the only place a position-bearing file's contents
 * ever reach an API route (`app/api/helper/[user]/import/route.ts`), so this
 * is where "never a route" has to be true or it is not true anywhere.
 *
 * Coordinates below are invented, mid-Atlantic.
 */

const USER = "ana";
let dir: string;

/** `[epochSeconds, lat, lon]`, one per minute, going somewhere. */
function fixesJsonl(count: number, day: string, lat0: number, lon0: number): string {
  const start = Date.parse(`${day}T08:00:00Z`) / 1000;
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify([start + i * 60, Number((lat0 + i * 0.001).toFixed(5)), Number((lon0 + i * 0.001).toFixed(5))]),
  ).join("\n");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-extent-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("the peek shows an extent, never a route", () => {
  test("a dry run's outcome carries a bounding box and no list of positions", () => {
    const text = fixesJsonl(50, "2026-06-22", 10, -30);
    const result = importGps(USER, text, "walk.jsonl", { format: "fixes", dryRun: true });
    if ("refusal" in result) throw new Error("unexpected refusal");

    expect(result.extent).toEqual({
      minLat: 10,
      maxLat: 10.049,
      minLon: -30,
      maxLon: -29.951,
    });

    // The one property allowed to carry coordinates is `extent`, and it is
    // four scalar numbers — not an array. Nothing else in the outcome may be
    // an array of two-element tuples (an ordered line) or objects with lat/
    // lon fields (a list of positions).
    const { extent, ...rest } = result;
    void extent;
    const serialised = JSON.stringify(rest);
    expect(serialised).not.toMatch(/\[\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*\]/);
    expect(serialised).not.toContain("lat");
    expect(serialised).not.toContain("lon");
    expect(result.stored).toBeUndefined(); // dry run: nothing written either.
  });

  test("nothing was written to the store by a dry run", () => {
    const text = fixesJsonl(10, "2026-06-22", 10, -30);
    importGps(USER, text, "walk.jsonl", { format: "fixes", dryRun: true });
    expect(fs.existsSync(gpsDir(USER))).toBe(false);
  });
});

describe("coverage — a day count, never a position", () => {
  test("counts distinct days inside each trip's own dates, and nothing outside them", () => {
    // Three distinct UTC days, only two of them inside the trip.
    const text = [
      fixesJsonl(3, "2026-06-21", 10, -30), // before the trip
      fixesJsonl(3, "2026-06-22", 10, -30),
      fixesJsonl(3, "2026-06-23", 10, -30),
    ].join("\n");
    const result = importGps(USER, text, "walk.jsonl", {
      format: "fixes",
      dryRun: true,
      trips: [
        { id: "the-trip", start: "2026-06-22", end: "2026-06-24" },
        { id: "another-trip", start: "2029-01-01", end: "2029-01-03" },
      ],
    });
    if ("refusal" in result) throw new Error("unexpected refusal");
    expect(result.coverage).toEqual([
      { tripId: "the-trip", days: 2, tripDays: 3 },
      { tripId: "another-trip", days: 0, tripDays: 3 },
    ]);
  });
});

describe("discard — D7's other card", () => {
  test("deletes only the months an import touched", () => {
    // Pre-existing history in May, untouched by the June import below.
    importGps(USER, fixesJsonl(5, "2026-05-10", 20, 20), "old.jsonl", { format: "fixes" });
    const june = importGps(USER, fixesJsonl(5, "2026-06-22", 10, -30), "walk.jsonl", { format: "fixes" });
    if ("refusal" in june) throw new Error("unexpected refusal");

    expect(june.stored?.months).toEqual(["2026-06"]);
    // B1843 addendum — precise to the imported file's own dates, not the
    // whole month, but with nothing else in June this still empties it.
    discardImportedHistory(USER, { from: Date.parse(june.from!), to: Date.parse(june.to!) });

    expect(fs.existsSync(path.join(gpsDir(USER), "2026-06.jsonl"))).toBe(false);
    // May's own history — a separate import, a separate month — survives.
    expect(
      readRange(USER, Date.parse("2026-05-01T00:00:00Z"), Date.parse("2026-05-31T23:59:59Z")).length,
    ).toBeGreaterThan(0);
  });
});

describe("purgeGpsHistory reports what was actually removed — security review, 2026-09-24", () => {
  test("a month asked for that this journal never held is not reported as deleted", () => {
    appendFixes(USER, [{ t: Date.parse("2026-06-15T10:00:00Z"), lat: 47, lon: 8 }]);
    const result = purgeGpsHistory(USER, { months: ["2026-06", "2019-01"] });
    // The result names what actually existed and was removed, not the whole
    // ask — "2019-01" was never held, so it is not a real deletion and
    // claiming it was would be a purge result that lies about its own effect.
    expect(result.monthsDeleted).toEqual(["2026-06"]);
    expect(result.monthsHeld).toEqual([]);
  });

  test("everything held is what `{all: true}` actually reports, never more", () => {
    appendFixes(USER, [{ t: Date.parse("2026-06-15T10:00:00Z"), lat: 47, lon: 8 }]);
    const result = purgeGpsHistory(USER, { all: true });
    expect(result.monthsDeleted).toEqual(["2026-06"]);
    expect(result.monthsHeld).toEqual([]);
  });
});
