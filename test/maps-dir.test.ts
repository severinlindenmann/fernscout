import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { primaryStreetMap, resolveMapsFile, tripMapRegions } from "@/lib/maps/dir";

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
