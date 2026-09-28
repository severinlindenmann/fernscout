import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { primaryStreetMap, resolveFontFile, resolveMapsFile, tripMapRegions } from "@/lib/maps/dir";

/** B2535 — the route's path safety and the index lookup `StreetMap` picks
 * a file from. */

let mapsDir: string;

beforeEach(() => {
  mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mapsdir-"));
  process.env.MAPS_DIR = mapsDir;
});

afterEach(() => {
  delete process.env.MAPS_DIR;
  fs.rmSync(mapsDir, { recursive: true, force: true });
});

test("resolves a real file under MAPS_DIR", () => {
  fs.writeFileSync(path.join(mapsDir, "world.pmtiles"), "x");
  expect(resolveMapsFile(["world.pmtiles"])).toBe(path.join(mapsDir, "world.pmtiles"));
});

test("resolves a nested file", () => {
  fs.mkdirSync(path.join(mapsDir, "trips"));
  fs.writeFileSync(path.join(mapsDir, "trips", "alex-alps-2024.pmtiles"), "x");
  expect(resolveMapsFile(["trips", "alex-alps-2024.pmtiles"])).toBe(
    path.join(mapsDir, "trips", "alex-alps-2024.pmtiles"),
  );
});

test("refuses a traversal attempt", () => {
  fs.writeFileSync(path.join(path.dirname(mapsDir), "secret.pmtiles"), "x");
  expect(resolveMapsFile(["..", "secret.pmtiles"])).toBeNull();
});

test("refuses an unsafe character", () => {
  fs.writeFileSync(path.join(mapsDir, "world.pmtiles"), "x");
  expect(resolveMapsFile(["world .pmtiles"])).toBeNull();
  expect(resolveMapsFile(["World.pmtiles"])).toBeNull();
});

test("refuses a non-.pmtiles file even when it exists", () => {
  fs.writeFileSync(path.join(mapsDir, "index.json"), "{}");
  expect(resolveMapsFile(["index.json"])).toBeNull();
});

test("refuses a missing file", () => {
  expect(resolveMapsFile(["nope.pmtiles"])).toBeNull();
});

test("refuses everything when MAPS_DIR is unset", () => {
  delete process.env.MAPS_DIR;
  expect(resolveMapsFile(["world.pmtiles"])).toBeNull();
});

test("tripMapRegions and primaryStreetMap read the index", () => {
  fs.writeFileSync(
    path.join(mapsDir, "index.json"),
    JSON.stringify({
      trips: {
        "alex/alps-2024": [{ file: "trips/alex-alps-2024.pmtiles", bbox: [8.1, 46.0, 8.7, 46.9] }],
      },
    }),
  );
  expect(tripMapRegions("alex", "alps-2024")).toEqual([
    { file: "trips/alex-alps-2024.pmtiles", bbox: [8.1, 46.0, 8.7, 46.9] },
  ]);
  expect(primaryStreetMap("alex", "alps-2024")).toEqual({
    url: "/api/maps/trips/alex-alps-2024.pmtiles",
    bounds: [
      [8.1, 46.0],
      [8.7, 46.9],
    ],
  });
});

test("tripMapRegions is undefined for a trip with no entry, or with no index at all", () => {
  expect(tripMapRegions("alex", "alps-2024")).toBeUndefined();
  fs.writeFileSync(path.join(mapsDir, "index.json"), JSON.stringify({ trips: {} }));
  expect(tripMapRegions("alex", "alps-2024")).toBeUndefined();
  expect(primaryStreetMap("alex", "alps-2024")).toBeUndefined();
});

test("primaryStreetMap picks the file covering the main region's day places, not the first-listed one", () => {
  // Shaped after the real prod index (B2560): a home-zone (Basel) region file
  // listed first, then the trip's own Algarve region — the trip's main-region
  // day places (`framePoints`, in Algarve) must pick the second file.
  fs.writeFileSync(
    path.join(mapsDir, "index.json"),
    JSON.stringify({
      trips: {
        "severin/algarve-2026": [
          { file: "severin-algarve-2026-1.pmtiles", bbox: [7.42, 47.42, 7.82, 47.69] },
          { file: "severin-algarve-2026-2.pmtiles", bbox: [-9.16, 36.89, -7.96, 37.25] },
        ],
      },
    }),
  );
  const algarvePlaces = [
    { lat: 37.0, lng: -8.5 },
    { lat: 37.1, lng: -8.6 },
  ];
  expect(primaryStreetMap("severin", "algarve-2026", algarvePlaces)).toEqual({
    url: "/api/maps/severin-algarve-2026-2.pmtiles",
    bounds: [
      [-9.16, 36.89],
      [-7.96, 37.25],
    ],
  });
  // No points given at all keeps the previous, first-listed behaviour — the
  // only sane default for a caller with nothing to check bboxes against.
  expect(primaryStreetMap("severin", "algarve-2026")).toEqual({
    url: "/api/maps/severin-algarve-2026-1.pmtiles",
    bounds: [
      [7.42, 47.42],
      [7.82, 47.69],
    ],
  });
});

test("resolveFontFile prefers MAPS_DIR/fonts, falls back to public/fonts, and refuses an unsafe name", () => {
  fs.mkdirSync(path.join(mapsDir, "fonts", "Noto Sans Regular"), { recursive: true });
  fs.writeFileSync(path.join(mapsDir, "fonts", "Noto Sans Regular", "1024-1279.pbf"), "x");
  expect(resolveFontFile("Noto Sans Regular", "1024-1279")).toBe(
    path.join(mapsDir, "fonts", "Noto Sans Regular", "1024-1279.pbf"),
  );
  // Not on MAPS_DIR at all — falls back to the repo's own baked range.
  expect(resolveFontFile("Noto Sans Regular", "0-255")).toMatch(/public[/\\]fonts[/\\]Noto Sans Regular[/\\]0-255\.pbf$/);
  // Neither has it.
  expect(resolveFontFile("Noto Sans Regular", "65280-65535")).toBeNull();
  // A traversal attempt, or a malformed range, is refused outright.
  expect(resolveFontFile("../../etc", "0-255")).toBeNull();
  expect(resolveFontFile("Noto Sans Regular", "not-a-range")).toBeNull();
});
