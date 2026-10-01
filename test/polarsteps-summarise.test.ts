import { describe, expect, test } from "vitest";
import { discoverPolarstepsTrips, tripDateRange } from "@/lib/polarsteps/summarise";
import { readZipEntries } from "@/lib/zip/readZip";
import { buildPolarstepsExportZip } from "./fixtures/polarsteps-zip";
import { tripA, tripB } from "./fixtures/polarsteps";

/**
 * The shared discovery that both the studio's Polarsteps import flow
 * (B2662) and the public /switch preview (B2663) read — against the same
 * synthetic export B2432/B2662 already built, so a wrong count here is a
 * wrong count on both.
 */
describe("discoverPolarstepsTrips", () => {
  test("finds both trips with their step, photo, video and GPS counts", async () => {
    const buf = await buildPolarstepsExportZip();
    const file = new Blob([new Uint8Array(buf)]);
    const entries = await readZipEntries(file);
    const { trips, anyUnreadable } = await discoverPolarstepsTrips(file, entries, { countGps: true });

    expect(anyUnreadable).toBe(false);
    expect(trips).toHaveLength(2);

    const a = trips.find((t) => t.trip.id === tripA.id)!;
    const b = trips.find((t) => t.trip.id === tripB.id)!;

    // Trip A: steps A1 (1 photo), A2 (1 photo), A3 (no media) — 2 photos, 0 videos.
    expect(a.trip.all_steps).toHaveLength(3);
    expect(a.photos).toBe(1 + 1);
    expect(a.videos).toBe(0);
    expect(a.gpsPoints).toBe(3);

    // Trip B: steps B1 (1 video), B2 (no media) — 0 photos, 1 video.
    expect(b.trip.all_steps).toHaveLength(2);
    expect(b.photos).toBe(0);
    expect(b.videos).toBe(1);
    expect(b.gpsPoints).toBe(2);

    const totalSteps = trips.reduce((n, t) => n + t.trip.all_steps.length, 0);
    const totalPhotos = trips.reduce((n, t) => n + t.photos, 0);
    const totalVideos = trips.reduce((n, t) => n + t.videos, 0);
    const totalGps = trips.reduce((n, t) => n + (t.gpsPoints ?? 0), 0);
    expect(totalSteps).toBe(5);
    expect(totalPhotos).toBe(2);
    expect(totalVideos).toBe(1);
    expect(totalGps).toBe(5);
  });

  test("skips counting GPS points when not asked", async () => {
    const buf = await buildPolarstepsExportZip();
    const file = new Blob([new Uint8Array(buf)]);
    const entries = await readZipEntries(file);
    const { trips } = await discoverPolarstepsTrips(file, entries);
    expect(trips.every((t) => t.gpsPoints === undefined)).toBe(true);
  });

  test("a ZIP with no trip.json finds nothing and is not reported unreadable", async () => {
    const file = new Blob([new TextEncoder().encode("not a zip")]);
    await expect(readZipEntries(file)).rejects.toThrow();
  });
});

describe("tripDateRange", () => {
  test("derives the range from steps when start_date/end_date are absent", () => {
    expect(tripA.start_date).toBeUndefined();
    const range = tripDateRange(tripA);
    // The last step is 23:30 in New York — 2 May in UTC, 1 May where it happened.
    expect(range).toEqual({ start: "2026-04-15", end: "2026-05-01" });
  });

  test("names the local dates the import writes, not the UTC ones", () => {
    // 05:00 in Tokyo is still 10 July in UTC; the import files it on the 11th.
    expect(tripDateRange(tripB)).toEqual({ start: "2026-07-11", end: "2026-07-12" });
  });
});
