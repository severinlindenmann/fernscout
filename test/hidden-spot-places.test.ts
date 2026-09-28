import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AS_AUTHOR, getPlaces } from "@/lib/entries";
import { getMapDays } from "@/lib/map/mapDays";
import { buildStoryProps } from "@/lib/tripView";
import { getTrip, tripRef } from "@/lib/trips";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2544 — a day's own typed `coordinates` is never a recorded GPS fix, so it
 * never went through `deriveTrack`'s own hidden-spot cut (`test/gps-track-edits.test.ts`
 * covers that side). A day pinned at a place the owner has since hidden must
 * still not reach a reader's map or card — the owner's own studio
 * (`ReadOptions.reader: "person"`, `AS_AUTHOR`) keeps seeing the real pin.
 */

const OWNER = "hs";
const TRIP = "hidden-spot-trip";
const HOTEL = { lat: 46.0569, lng: 14.5058 }; // Ljubljana
const ELSEWHERE = { lat: 41.1231, lng: 20.8016 }; // Ohrid

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hidden-spot-places-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Test journal",
      owner: { name: "Test Person", nickname: "Test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  writeTripFixture(OWNER, {
    id: TRIP,
    start: "2026-09-01",
    end: "2026-09-02",
    visibility: "public",
    listed: true,
    intro: "x",
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "at-the-hotel",
    date: "2026-09-01",
    location: "The Hotel",
    country: "Slovenia",
    coordinates: HOTEL,
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "elsewhere",
    date: "2026-09-02",
    location: "Ohrid",
    country: "North Macedonia",
    coordinates: ELSEWHERE,
  });

  // Hides exactly the hotel's own coordinate — the raw shape `docs/gps.md`
  // documents, written directly rather than through `writeTrackEdits`
  // (which also re-derives `track.json` from the raw fix store, nothing
  // this test needs).
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP, "track-edits.json"),
    JSON.stringify({
      hiddenSpots: [{ id: "s1", lat: HOTEL.lat, lon: HOTEL.lng, radiusM: 200 }],
      hiddenStretches: [],
      namedStretches: [],
    }),
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getPlaces — B2544", () => {
  test("a reader's places never include one inside a hidden spot", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, { includeDrafts: false, reader: "public" });
    expect(places.map((p) => p.location)).toEqual(["Ohrid"]);
  });

  test("the owner's own studio still sees the real pin", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, AS_AUTHOR);
    expect(places.map((p) => p.location).sort()).toEqual(["Ohrid", "The Hotel"]);
  });
});

describe("getMapDays — B2544", () => {
  test("the hidden day stays in the list, greyed, never plottable, for a reader", () => {
    const ref = tripRef(OWNER, TRIP);
    const days = getMapDays(ref, { includeDrafts: false, reader: "public" });
    const hotel = days.find((d) => d.date === "2026-09-01")!;
    expect(hotel.hasPlace).toBe(false);
    expect(Number.isFinite(hotel.lat)).toBe(false);
    expect(Number.isFinite(hotel.lng)).toBe(false);
    // The day's own name is not a secret — only its place on a map is.
    expect(hotel.location).toBe("The Hotel");
    const other = days.find((d) => d.date === "2026-09-02")!;
    expect(other.hasPlace).toBe(true);
  });

  test("the owner's own studio still gets a plottable pin", () => {
    const ref = tripRef(OWNER, TRIP);
    const days = getMapDays(ref, AS_AUTHOR);
    const hotel = days.find((d) => d.date === "2026-09-01")!;
    expect(hotel.hasPlace).toBe(true);
    expect(hotel.lat).toBeCloseTo(HOTEL.lat);
  });
});

describe("buildStoryProps' own index — B2544", () => {
  test("a reader's story index carries no coordinate for the hidden day", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, { includeDrafts: false, reader: "public" });
    const hotel = index.find((d) => d.date === "2026-09-01")!;
    expect(Number.isFinite(hotel.lat)).toBe(false);
    expect(Number.isFinite(hotel.lng)).toBe(false);
  });

  test("the owner's own view keeps the real coordinate", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, AS_AUTHOR);
    const hotel = index.find((d) => d.date === "2026-09-01")!;
    expect(hotel.lat).toBeCloseTo(HOTEL.lat);
  });
});
