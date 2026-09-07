import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes, gpsDir } from "@/lib/gps/store";
import { deriveTrack, readExcludeZones, excludeFile, trackForTrip } from "@/lib/gps/enrich";
import { readTrack, trackFile, trackPointCount, writeTrack } from "@/lib/gps/track";
import type { Fix } from "@/importers/gps/schema";

/**
 * B665 — the derived half.
 *
 * Three of these are privacy properties rather than drawing ones: what is
 * outside the trip's dates is not in the file, what is inside a private zone
 * is not in the file, and the file survives the store being deleted. The last
 * is why there are two files at all.
 */

const USER = "ana";
const TRIP = "algarve";
let dir: string;

const on = (day: string, hour: number, lat: number, lon: number): Fix => ({
  t: Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`),
  lat,
  lon,
});

const DATES = { start: "2026-06-22", end: "2026-06-24" };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-track-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, USER, "trips", TRIP), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("deriving a trip's line", () => {
  test("keeps nothing outside the trip's dates", () => {
    const track = deriveTrack(
      [
        on("2026-06-21", 22, 47, 8),
        on("2026-06-21", 23, 47.01, 8),
        on("2026-06-22", 9, 37, -8),
        on("2026-06-22", 10, 37.01, -8),
        on("2026-06-25", 9, 47, 8),
        on("2026-06-25", 10, 47.01, 8),
      ],
      DATES,
    );
    const points = track.segments.flatMap((s) => s.points);
    expect(points.every(([lat]) => lat < 40)).toBe(true);
    expect(points).toHaveLength(2);
  });

  test("drops every fix inside a private zone, and cuts the line there", () => {
    const home = { lat: 47.38564, lon: 8.21819, radiusM: 500 };
    const track = deriveTrack(
      [
        on("2026-06-22", 8, 47.38564, 8.21819),
        on("2026-06-22", 9, 47.38601, 8.21901),
        on("2026-06-22", 10, 47.5, 8.6),
        on("2026-06-22", 11, 47.6, 8.7),
      ],
      { ...DATES, zones: [home] },
    );
    const points = track.segments.flatMap((s) => s.points);
    expect(points).toEqual([
      [47.5, 8.6],
      [47.6, 8.7],
    ]);
  });

  test("breaks the line at a gap rather than drawing through it", () => {
    // Zurich in the morning, the Algarve in the evening. Joining these two
    // runs would draw a straight line across France and call it a route.
    const track = deriveTrack(
      [
        on("2026-06-22", 6, 47.55, 7.61),
        on("2026-06-22", 7, 47.59, 7.53),
        on("2026-06-22", 19, 37.01, -7.97),
        on("2026-06-22", 20, 37.08, -8.22),
      ],
      DATES,
    );
    expect(track.segments).toHaveLength(2);
    expect(track.segments[0].from).toBe("2026-06-22T06:00:00.000Z");
    expect(track.segments[1].points[0]).toEqual([37.01, -7.97]);
  });

  test("drops a lone fix, which is not a line", () => {
    const track = deriveTrack([on("2026-06-22", 6, 47, 8)], DATES);
    expect(track.segments).toEqual([]);
  });

  test("simplifies without moving the ends, or the corner", () => {
    // A straight run east, then a right-angle turn north. The straight part
    // collapses; the corner cannot.
    const fixes: Fix[] = [];
    for (let i = 0; i < 10; i++) fixes.push(on("2026-06-22", 6, 47, 8 + i * 0.01));
    for (let i = 1; i < 10; i++) fixes.push(on("2026-06-22", 6, 47 + i * 0.01, 8.09));
    // Every fix a minute apart, so the gap rule keeps them one segment.
    fixes.forEach((f, i) => (f.t = Date.parse("2026-06-22T06:00:00Z") + i * 60_000));

    const track = deriveTrack(fixes, DATES);
    const points = track.segments[0].points;
    expect(points.length).toBeLessThan(fixes.length);
    expect(points[0]).toEqual([47, 8]);
    expect(points[points.length - 1]).toEqual([47.09, 8.09]);
    expect(points).toContainEqual([47, 8.09]);
  });
});

describe("private zones", () => {
  test("no file means no zones", () => {
    expect(readExcludeZones(USER)).toEqual([]);
  });

  test("an unreadable list refuses rather than deriving without it", () => {
    fs.mkdirSync(gpsDir(USER), { recursive: true });
    fs.writeFileSync(excludeFile(USER), "{ not json");
    // Failing open here would put somebody's front door on a public map.
    expect(() => readExcludeZones(USER)).toThrow(/refusing/);
  });

  test("a zone without a radius is refused", () => {
    fs.mkdirSync(gpsDir(USER), { recursive: true });
    fs.writeFileSync(excludeFile(USER), JSON.stringify([{ lat: 47, lon: 8 }]));
    expect(() => readExcludeZones(USER)).toThrow(/radiusM/);
  });
});

describe("the trip owns its line", () => {
  test("deleting the whole store leaves the track exactly as it was", () => {
    appendFixes(USER, [
      on("2026-06-22", 6, 47.55, 7.61),
      on("2026-06-22", 7, 47.59, 7.53),
    ]);
    writeTrack(USER, TRIP, trackForTrip(USER, DATES));
    const before = fs.readFileSync(trackFile(USER, TRIP), "utf8");

    fs.rmSync(gpsDir(USER), { recursive: true, force: true });

    expect(fs.readFileSync(trackFile(USER, TRIP), "utf8")).toBe(before);
    expect(trackPointCount(readTrack(USER, TRIP)!)).toBe(2);
  });

  test("a trip with no track reads as undefined, not as an empty drawing", () => {
    expect(readTrack(USER, TRIP)).toBeUndefined();
  });

  test("a malformed track is ignored rather than half-drawn", () => {
    fs.writeFileSync(
      trackFile(USER, TRIP),
      JSON.stringify({ segments: [{ from: "x", points: [["north", "east"]] }] }),
    );
    expect(readTrack(USER, TRIP)).toBeUndefined();
  });
});
