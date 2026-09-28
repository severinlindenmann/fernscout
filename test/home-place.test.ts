import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AS_AUTHOR, getPlaces } from "@/lib/entries";
import { isHomePlace } from "@/lib/gps/enrich";
import { getMapDays } from "@/lib/map/mapDays";
import { buildStoryProps } from "@/lib/tripView";
import { getTrip, tripRef } from "@/lib/trips";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2543 — `lib/map/tripFrame.ts` names any place flagged `home: true` as
 * "Home" and never by its own name, but no reader-facing caller could set
 * the flag: the home zone (`content/<user>/gps/exclude.json`,
 * `lib/gps/enrich.ts`'s `readExcludeZones`) was owner-only and never reached
 * trip rendering. `isHomePlace` is the yes/no signal that closes that gap —
 * `getPlaces`, `getMapDays` and `buildStoryProps`' own index all apply it for
 * a reader (`ReadOptions.reader !== "person"`), the same boundary B2544's
 * hidden-spot check already draws. The owner's own studio always gets the
 * real name.
 */

const OWNER = "hp";
const TRIP = "home-place-trip";
const HOME = { lat: 47.3769, lng: 8.5417 }; // Zürich
const AWAY = { lat: 41.1231, lng: 20.8016 }; // Ohrid
const RADIUS_M = 300;

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-home-place-"));
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
    slug: "at-home",
    date: "2026-09-01",
    location: "Zürich",
    country: "Switzerland",
    coordinates: HOME,
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "elsewhere",
    date: "2026-09-02",
    location: "Ohrid",
    country: "North Macedonia",
    coordinates: AWAY,
  });

  // The shape `docs/gps.md` documents, written directly.
  fs.mkdirSync(path.join(dir, OWNER, "gps"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "gps", "exclude.json"),
    JSON.stringify([{ label: "home", lat: HOME.lat, lon: HOME.lng, radiusM: RADIUS_M }]),
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isHomePlace", () => {
  test("true inside the zone, false outside it", () => {
    expect(isHomePlace(OWNER, { lat: HOME.lat, lon: HOME.lng })).toBe(true);
    expect(isHomePlace(OWNER, { lat: AWAY.lat, lon: AWAY.lng })).toBe(false);
  });

  test("fails closed on an unreadable zones file — no crash, no name change", () => {
    fs.writeFileSync(path.join(dir, OWNER, "gps", "exclude.json"), "{ not json");
    expect(() => isHomePlace(OWNER, { lat: HOME.lat, lon: HOME.lng })).not.toThrow();
    expect(isHomePlace(OWNER, { lat: HOME.lat, lon: HOME.lng })).toBe(false);
  });
});

describe("getPlaces — B2543", () => {
  test("a reader never sees the home town's own name, and gets home: true", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, { includeDrafts: false, reader: "public" });
    const home = places.find((p) => p.firstDate === "2026-09-01")!;
    expect(home.location).toBe("Home");
    expect(home.country).toBe("Home");
    expect(home.countryCode).toBeUndefined();
    expect(home.home).toBe(true);
    // Coordinates stay real, so the frame rules can still treat it as home.
    expect(home.lat).toBeCloseTo(HOME.lat);
    expect(home.lng).toBeCloseTo(HOME.lng);
    // The key never leaks the real name either — it is transmitted to the
    // client the same as every other field.
    expect(home.key).not.toContain("Zürich");
    const away = places.find((p) => p.firstDate === "2026-09-02")!;
    expect(away.location).toBe("Ohrid");
    expect(away.home).toBeUndefined();
  });

  test("the owner's own studio sees the real name", () => {
    const ref = tripRef(OWNER, TRIP);
    const places = getPlaces(ref, AS_AUTHOR);
    const home = places.find((p) => p.firstDate === "2026-09-01")!;
    expect(home.location).toBe("Zürich");
    expect(home.home).toBeUndefined();
  });
});

describe("getMapDays — B2543", () => {
  test("a reader's day list never carries the home town's own name", () => {
    const ref = tripRef(OWNER, TRIP);
    const days = getMapDays(ref, { includeDrafts: false, reader: "public" });
    const home = days.find((d) => d.date === "2026-09-01")!;
    expect(home.location).toBe("Home");
    expect(home.country).toBe("Home");
    expect(home.countryCode).toBeUndefined();
    expect(home.home).toBe(true);
    // Still plottable — home is drawn, just never named.
    expect(home.hasPlace).toBe(true);
    expect(Number.isFinite(home.lat)).toBe(true);
  });

  test("the owner's own studio sees the real name", () => {
    const ref = tripRef(OWNER, TRIP);
    const days = getMapDays(ref, AS_AUTHOR);
    const home = days.find((d) => d.date === "2026-09-01")!;
    expect(home.location).toBe("Zürich");
    expect(home.home).toBeUndefined();
  });
});

describe("buildStoryProps' own index — B2543", () => {
  test("a reader's story index never carries the home town's own name", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, { includeDrafts: false, reader: "public" });
    const home = index.find((d) => d.date === "2026-09-01")!;
    expect(home.location).toBe("Home");
    expect(home.country).toBe("Home");
    expect(home.countryCode).toBeUndefined();
    expect(home.home).toBe(true);
    expect(home.lat).toBeCloseTo(HOME.lat);
  });

  test("the owner's own view keeps the real name", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, AS_AUTHOR);
    const home = index.find((d) => d.date === "2026-09-01")!;
    expect(home.location).toBe("Zürich");
    expect(home.home).toBeUndefined();
  });

  test("no reader response contains the zone's centre or radius", () => {
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const { index } = buildStoryProps(trip.ref, { includeDrafts: false, reader: "public" });
    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain(String(RADIUS_M));
    expect(serialized).not.toContain("exclude.json");
  });
});
