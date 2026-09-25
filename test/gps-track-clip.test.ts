import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendFixes, gpsDir, metresBetween } from "@/lib/gps/store";
import { deriveTripTrack, importGps } from "@/lib/gps/api";
import { deriveTrack } from "@/lib/gps/enrich";
import { readerTrack, readTrack, writeTrack } from "@/lib/gps/track";
import { getDays } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";
import type { Fix } from "@/importers/gps/schema";

/**
 * B2202 — reworked after review. The guarantee moved from *derivation time*
 * (only published dates ever reached `track.json`) to *serve time*
 * (`readerTrack` filters the file, which now holds every trip date, drafts
 * included, tagged with the date its segment belongs to). This file tests
 * both halves: `deriveTrack`'s own local-midnight and trim rules as a pure
 * function, and the full `deriveTripTrack` → `readerTrack` path a reader
 * actually goes through.
 */

const OWNER = "ana";
const TRIP = "algarve-2026";

let dir: string;

const on = (day: string, hour: number, lat: number, lon: number): Fix => ({
  t: Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`),
  lat,
  lon,
});

// A day's worth of real path on `day`, long enough to survive the 500 m trim.
const walk = (day: string, lat: number): Fix[] =>
  Array.from({ length: 30 }, (_, i) => ({
    t: Date.parse(`${day}T09:00:00Z`) + i * 60_000,
    lat,
    lon: -8.5 + i * 0.001,
  }));

function config() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "A B", nickname: "A", email: `${OWNER}@example.test` },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-track-clip-"));
  process.env.CONTENT_DIR = dir;
  config();
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("deriveTrack — pure rules reworked by B2202", () => {
  test("a fix is tagged with the local date of the day's own timezone, not its UTC date", () => {
    // 2026-06-23T05:00:00Z is 2026-06-22T22:00 in America/Los_Angeles (PDT,
    // UTC-7) — an evening fix whose UTC calendar date is already the next day.
    const start = Date.parse("2026-06-23T05:00:00Z");
    const fixes: Fix[] = Array.from({ length: 5 }, (_, i) => ({
      t: start + i * 60_000,
      lat: 34,
      lon: -118 + i * 0.001,
    }));
    const track = deriveTrack(fixes, {
      start: "2026-06-22",
      end: "2026-06-22",
      dayTimezones: { "2026-06-22": "America/Los_Angeles" },
    });
    expect(track.segments).toHaveLength(1);
    expect(track.segments[0].day).toBe("2026-06-22");
  });

  test("a run is broken when it crosses a private zone, not only by the gap rule", () => {
    const zone = { lat: 47.5, lon: 8.65, radiusM: 300 };
    const fixes: Fix[] = [
      on("2026-06-22", 9, 47.1, 8.1),
      on("2026-06-22", 9, 47.2, 8.2),
      // Inside the zone — dropped, and must break the run even though the
      // surrounding fixes are seconds apart.
      { t: Date.parse("2026-06-22T09:05:00Z"), lat: 47.5, lon: 8.65 },
      { t: Date.parse("2026-06-22T09:06:00Z"), lat: 47.6, lon: 8.7 },
      { t: Date.parse("2026-06-22T09:07:00Z"), lat: 47.7, lon: 8.8 },
    ];
    const track = deriveTrack(fixes, { start: "2026-06-22", end: "2026-06-22", zones: [zone] });
    expect(track.segments).toHaveLength(2);
  });

  test("GPS jitter at a hotel does not exhaust the straight-line trim the way path length did", () => {
    const hotel: Fix = { t: 0, lat: 37.1, lon: -8.5 };
    // Three hours, a fix a minute, wobbling a few metres around the hotel —
    // path length alone (jitter back and forth) would rack up hundreds of
    // metres without net displacement.
    const jitter: Fix[] = Array.from({ length: 180 }, (_, i) => ({
      t: Date.parse("2026-06-22T06:00:00Z") + i * 60_000,
      lat: hotel.lat + (i % 2 === 0 ? 0.00013 : -0.00013), // ~±15 m
      lon: hotel.lon,
    }));
    // Then a real 5 km walk east.
    const walkStart = Date.parse("2026-06-22T09:00:00Z");
    const departure: Fix[] = Array.from({ length: 50 }, (_, i) => ({
      t: walkStart + i * 60_000,
      lat: hotel.lat,
      lon: hotel.lon + i * 0.001, // ~88 m per fix, ~4.4 km total
    }));
    const track = deriveTrack([...jitter, ...departure], {
      start: "2026-06-22",
      end: "2026-06-22",
      trimMetres: 500,
    });
    expect(track.segments).toHaveLength(1);
    const first = track.segments[0].points[0];
    const distanceFromHotel = metresBetween(hotel, { t: 0, lat: first[0], lon: first[1] });
    expect(distanceFromHotel).toBeGreaterThanOrEqual(500);
  });
});

describe("a reader's track — B2202", () => {
  test("a draft day's segment is not in a public reader's track", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-23", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" }); // published
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-2", date: "2026-06-23", status: "draft" });
    appendFixes(OWNER, [...walk("2026-06-22", 37.1), ...walk("2026-06-23", 37.5)]);

    const result = deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-23" });
    expect(result.written).toBe(true);
    // The raw file now holds both dates — drafts included.
    expect(readTrack(OWNER, TRIP)!.segments.map((s) => s.day).sort()).toEqual([
      "2026-06-22",
      "2026-06-23",
    ]);

    const publicDates = new Set(
      getDays(tripRef(OWNER, TRIP), { includeDrafts: false, reader: "public" }).map((d) => d.date),
    );
    const track = readerTrack(OWNER, TRIP, publicDates)!;
    const lats = track.segments.flatMap((s) => s.points.map(([lat]) => lat));
    expect(lats.some((lat) => Math.abs(lat - 37.1) < 0.01)).toBe(true);
    expect(lats.some((lat) => Math.abs(lat - 37.5) < 0.01)).toBe(false);
  });

  test("a day held back from a reader by visibility is not drawn to that reader", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22", visibility: "guest" });
    appendFixes(OWNER, walk("2026-06-22", 37.1));

    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22" });

    const publicDates = new Set(
      getDays(tripRef(OWNER, TRIP), { includeDrafts: false, reader: "public" }).map((d) => d.date),
    );
    expect(readerTrack(OWNER, TRIP, publicDates)).toBeUndefined();

    const guestDates = new Set(
      getDays(tripRef(OWNER, TRIP), { includeDrafts: false, reader: "guest" }).map((d) => d.date),
    );
    expect(readerTrack(OWNER, TRIP, guestDates)).toBeDefined();
  });

  test("a legacy segment without day is dropped, never trusted", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    writeTrack(OWNER, TRIP, {
      generated: new Date().toISOString(),
      segments: [{ from: "2026-06-22T09:00:00.000Z", points: [[37.1, -8.5], [37.11, -8.51]] }],
    });
    const dates = new Set(["2026-06-22"]);
    expect(readerTrack(OWNER, TRIP, dates)).toBeUndefined();
  });

  test("an empty derivation deletes an existing track.json rather than leaving it stale", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    appendFixes(OWNER, walk("2026-06-22", 37.1));

    expect(deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22" }).written).toBe(true);
    expect(readTrack(OWNER, TRIP)).toBeDefined();

    // The store loses everything for this trip's dates (e.g. a purge).
    fs.rmSync(gpsDir(OWNER), { recursive: true, force: true });

    const result = deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22" });
    expect(result.written).toBe(false);
    expect(readTrack(OWNER, TRIP)).toBeUndefined();
  });

  test("a non-dry-run import re-derives every trip whose dates overlap it", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    expect(readTrack(OWNER, TRIP)).toBeUndefined();

    const text = walk("2026-06-22", 37.1)
      .map((f) => JSON.stringify([Math.round(f.t / 1000), f.lat, f.lon]))
      .join("\n");
    const result = importGps(OWNER, text, "walk.jsonl", { format: "fixes" });
    if ("refusal" in result) throw new Error("unexpected refusal");

    expect(result.rederived).toEqual([{ tripId: TRIP, ok: true }]);
    expect(readTrack(OWNER, TRIP)).toBeDefined();
  });

  test("a dry-run import never re-derives anything", () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    const text = walk("2026-06-22", 37.1)
      .map((f) => JSON.stringify([Math.round(f.t / 1000), f.lat, f.lon]))
      .join("\n");
    const result = importGps(OWNER, text, "walk.jsonl", { format: "fixes", dryRun: true });
    if ("refusal" in result) throw new Error("unexpected refusal");
    expect(result.rederived).toBeUndefined();
    expect(readTrack(OWNER, TRIP)).toBeUndefined();
  });

  test("unpublishing a day via the helper route stops it being drawn to a reader, with no file write", async () => {
    writeTripFixture(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22", visibility: "public", listed: true, intro: "x" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    appendFixes(OWNER, walk("2026-06-22", 37.1));
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-22" });

    const before = new Set(
      getDays(tripRef(OWNER, TRIP), { includeDrafts: false, reader: "public" }).map((d) => d.date),
    );
    expect(readerTrack(OWNER, TRIP, before)).toBeDefined();

    const { unpublishEntry } = await import("@/lib/api/entries");
    const taken = unpublishEntry(tripRef(OWNER, TRIP), "day-1");
    expect(taken.ok).toBe(true);

    const after = new Set(
      getDays(tripRef(OWNER, TRIP), { includeDrafts: false, reader: "public" }).map((d) => d.date),
    );
    expect(readerTrack(OWNER, TRIP, after)).toBeUndefined();
    // track.json was never touched by the unpublish — the raw file still has
    // the segment, tagged with its date; only the reader-facing set changed.
    expect(readTrack(OWNER, TRIP)!.segments.some((s) => s.day === "2026-06-22")).toBe(true);
  });

  test("a day that walks back past the hotel at noon does not draw the hotel either", () => {
    // Hotel, 1 km north, back to the door, 1 km west — one unbroken run.
    const hotel = { lat: 46.0, lon: 7.0 };
    const t0 = Date.parse("2026-06-22T07:00:00Z");
    const leg = (i: number, dLat: number, dLon: number) => ({
      t: t0 + i * 60_000,
      lat: hotel.lat + dLat,
      lon: hotel.lon + dLon,
    });
    const fixes = [
      ...Array.from({ length: 10 }, (_, i) => leg(i, (i + 1) * 0.0009, 0)),
      ...Array.from({ length: 10 }, (_, i) => leg(10 + i, (9 - i) * 0.0009, 0)),
      ...Array.from({ length: 10 }, (_, i) => leg(20 + i, 0, -(i + 1) * 0.0013)),
    ];
    const track = deriveTrack([{ t: t0 - 60_000, ...hotel }, ...fixes], {
      start: "2026-06-22",
      end: "2026-06-22",
      trimMetres: 500,
    });
    const points = track.segments.flatMap((s) => s.points);
    expect(points.length).toBeGreaterThan(0);
    for (const [lat, lon] of points) {
      expect(metresBetween({ t: 0, ...hotel }, { t: 0, lat, lon })).toBeGreaterThanOrEqual(500);
    }
  });
});
