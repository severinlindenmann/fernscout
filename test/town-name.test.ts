import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AS_AUTHOR, getPlaces } from "@/lib/entries";
import { reverseGeocode } from "@/lib/ingest/geo";
import { getMapDays } from "@/lib/map/mapDays";
import { clearTownNameCache, townNameFor } from "@/lib/map/townName";
import { buildStoryProps } from "@/lib/tripView";
import { getTrip, tripRef } from "@/lib/trips";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2543 (extra scope, found validating fernscout.ch) — "Places and names":
 * a map draws at town level ("Bangkok"), never a district
 * ("Khlong Toei District") or the owner's own words for the day (a nature
 * reserve's full name, a single landmark inside a city). `townNameFor`
 * (`lib/map/townName.ts`) is the one place that decides this, backed by the
 * same offline index `reverseGeocode` already uses for photo captions, asked
 * for the coarser answer (`townOnly: true`). The day page and every list
 * outside the map keep the owner's own text exactly as written.
 */

// A district/town pair this repo's own offline index actually resolves —
// verified directly against `reverseGeocode` below rather than assumed.
const DISTRICT = { lat: 13.78, lng: 100.64 };

describe("reverseGeocode townOnly — B2543", () => {
  test("skips a GeoNames section in favour of its own town", () => {
    const plain = reverseGeocode(DISTRICT.lat, DISTRICT.lng);
    const town = reverseGeocode(DISTRICT.lat, DISTRICT.lng, { townOnly: true });
    expect(plain?.name).not.toBe(town?.name);
    expect(town?.name).toBeTruthy();
  });

  test("nowhere within reach stays null both ways", () => {
    expect(reverseGeocode(0, -160, { townOnly: true })).toBeNull();
  });
});

describe("townNameFor", () => {
  beforeEach(() => clearTownNameCache());

  test("returns the town, not the district, and falls back with nothing nearby", () => {
    const town = reverseGeocode(DISTRICT.lat, DISTRICT.lng, { townOnly: true })!.name;
    expect(townNameFor(DISTRICT.lat, DISTRICT.lng, "Somebody's own words")).toBe(town);
    expect(townNameFor(0, -160, "Somebody's own words")).toBe("Somebody's own words");
    expect(townNameFor(NaN, NaN, "Somebody's own words")).toBe("Somebody's own words");
  });
});

const OWNER = "tn";
const TRIP = "town-name-trip";
const OWNER_TEXT = "Bang Kapi Nature Reserve";

let dir: string;
let TOWN: string;

beforeEach(async () => {
  clearTownNameCache();
  TOWN = reverseGeocode(DISTRICT.lat, DISTRICT.lng, { townOnly: true })!.name;

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-town-name-"));
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
    end: "2026-09-01",
    visibility: "public",
    listed: true,
    intro: "x",
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "the-day",
    date: "2026-09-01",
    location: OWNER_TEXT,
    country: "Thailand",
    coordinates: { lat: DISTRICT.lat, lng: DISTRICT.lng },
  });
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getPlaces — B2543 map labels", () => {
  test("a map input shows the town, never the owner's own words", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, { includeDrafts: false, reader: "public" });
    expect(places).toHaveLength(1);
    expect(places[0].location).toBe(TOWN);
    expect(places[0].location).not.toBe(OWNER_TEXT);
  });

  test("the owner's own map view is town-level too — this is a drawing rule, not a privacy one", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, AS_AUTHOR);
    expect(places[0].location).toBe(TOWN);
  });
});

describe("getMapDays — B2543 day strip", () => {
  test("the day strip shows the town", () => {
    const ref = tripRef(OWNER, TRIP);
    const days = getMapDays(ref, { includeDrafts: false, reader: "public" });
    expect(days[0].location).toBe(TOWN);
  });
});

describe("buildStoryProps — B2543 day page keeps the owner's text", () => {
  test("the day page's own field is untouched; the card's mapName is the town", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, { includeDrafts: false, reader: "public" });
    expect(index[0].location).toBe(OWNER_TEXT);
    expect(index[0].mapName).toBe(TOWN);
  });
});
