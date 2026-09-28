import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendFixes } from "@/lib/gps/store";
import { deriveTripTrack } from "@/lib/gps/api";
import { getDays } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { getTrip } from "@/lib/trips";
import { buildStoryProps } from "@/lib/tripView";
import { recordedFrom } from "@/lib/map/tripCard";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";
import type { Fix } from "@/importers/gps/schema";

/**
 * B2449 — the trip page's map card used to draw stop-to-stop hops only, even
 * when a real route had been recorded. This proves the card's own loader
 * (`recordedFrom`, lib/map/tripCard.ts — built on the same `readerTrack` the
 * map page already goes through, lib/gps/track.ts) gets the reader-filtered
 * track, never the raw file: a draft day's segment must not reach a public
 * reader here either. B2538 moved this loader from `tripTrackFor`
 * (lib/tripView.ts) into the card builder; the guarantee is unchanged.
 */

const OWNER = "ana";
const TRIP = "algarve-2026";

let dir: string;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-view-track-"));
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

describe("recordedFrom — B2449", () => {
  test("a public reader gets the recorded line, filtered, not the raw file", () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      start: "2026-06-22",
      end: "2026-06-23",
      visibility: "public",
      listed: true,
      intro: "x",
    });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" }); // published
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-2", date: "2026-06-23", status: "draft" });
    appendFixes(OWNER, [...walk("2026-06-22", 37.1), ...walk("2026-06-23", 37.5)]);
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-23" });

    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const index = getDays(trip.ref, { includeDrafts: false, reader: "public" });
    const recorded = recordedFrom(trip, index);
    const points = recorded.flatMap((s) => s.points);

    // The published day's line is there.
    expect(points.some((p) => Math.abs(p.lat - 37.1) < 0.01)).toBe(true);
    // The draft day's line is not — same guarantee `readerTrack` gives the
    // map page, not a second, looser one written for this call site.
    expect(points.some((p) => Math.abs(p.lat - 37.5) < 0.01)).toBe(false);
  });

  test("no track.json is unchanged: an empty array, not an error", () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      start: "2026-06-22",
      end: "2026-06-22",
      visibility: "public",
      listed: true,
      intro: "x",
    });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });

    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const index = getDays(trip.ref, { includeDrafts: false, reader: "public" });
    expect(recordedFrom(trip, index)).toEqual([]);
  });

  test("buildStoryProps' own index is what the filter uses — a draft stays out even via the full page path", () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      start: "2026-06-22",
      end: "2026-06-23",
      visibility: "public",
      listed: true,
      intro: "x",
    });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22" });
    writeDayFixture(dir, OWNER, TRIP, { slug: "day-2", date: "2026-06-23", status: "draft" });
    appendFixes(OWNER, [...walk("2026-06-22", 37.1), ...walk("2026-06-23", 37.5)]);
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-23" });

    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, { includeDrafts: false, reader: "public" });
    const points = recordedFrom(trip, index).flatMap((s) => s.points);
    expect(points.some((p) => Math.abs(p.lat - 37.5) < 0.01)).toBe(false);
  });
});
