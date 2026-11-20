import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { resolveCapabilities } from "@/lib/capabilities";
import { paperStyle } from "@/lib/map/paperFlavor";
import { OPENFREEMAP_TILEJSON, isOpenFreeMap } from "@/lib/map/openFreeMap";
import {
  coveringRegion,
  primaryStreetMap,
  streetMapRegionFiles,
  streetMapsProvider,
  tripMapRegions,
  worldStreetMapUrl,
} from "@/lib/maps/dir";

/**
 * FERN-6 — `features.streetMaps.provider: "openfreemap"` draws every map from
 * OpenFreeMap's hosted planet: no `MAPS_DIR`, no files, one region for the
 * whole world, and a Paper style written for the OpenMapTiles schema.
 */

/** The OpenMapTiles schema's vector layers (openmaptiles.org/schema). */
const OPENMAPTILES_LAYERS = new Set([
  "aerodrome_label", "aeroway", "boundary", "building", "housenumber", "landcover", "landuse",
  "mountain_peak", "park", "place", "poi", "transportation", "transportation_name", "water",
  "water_name", "waterway",
]);

let dir: string;

function writeConfig(streetMaps: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, users: { reserved: [] }, features: { streetMaps } }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-openfreemap-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  delete process.env.MAPS_DIR;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the capability", () => {
  test("openfreemap is on with no MAPS_DIR at all", () => {
    writeConfig({ enabled: true, provider: "openfreemap" });
    expect(resolveCapabilities().streetMaps).toEqual({ name: "streetMaps", enabled: true });
  });

  test("an unknown provider is refused and says which ones exist", () => {
    writeConfig({ enabled: true, provider: "mapbox" });
    const state = resolveCapabilities().streetMaps;
    expect(state.enabled).toBe(false);
    expect(!state.enabled && state.reason).toMatch(/provider "mapbox" is unknown.*local, openfreemap/);
  });

  test("no provider still means the local files", () => {
    writeConfig({ enabled: true });
    expect(streetMapsProvider()).toBe("local");
    const state = resolveCapabilities().streetMaps;
    expect(!state.enabled && state.reason).toMatch(/MAPS_DIR/);
  });
});

describe("the server's region answers", () => {
  test("every map gets the one planet source, framed by nothing but the world", () => {
    writeConfig({ enabled: true, provider: "openfreemap" });
    const planet = {
      url: OPENFREEMAP_TILEJSON,
      bounds: [[-180, -85.0511], [180, 85.0511]],
      maxZoom: 15,
    };
    expect(primaryStreetMap("alex", "alps-2024", [{ lat: 46.5, lng: 8.4 }])).toEqual(planet);
    expect(streetMapRegionFiles("alex", "alps-2024")).toEqual([planet]);
    expect(worldStreetMapUrl()).toBe(OPENFREEMAP_TILEJSON);
    // No `world: true`: that flag means the coarse z0–6 file, and turns the
    // slideshow's globe opener off.
    expect(primaryStreetMap("alex", "alps-2024")).not.toHaveProperty("world");
  });

  test("the trip card reads the planet over HTTPS, wherever the trip is", () => {
    writeConfig({ enabled: true, provider: "openfreemap" });
    expect(tripMapRegions("alex", "kyoto")).toEqual([{ file: OPENFREEMAP_TILEJSON, bbox: [-180, -85.0511, 180, 85.0511] }]);
    expect(coveringRegion("alex", "kyoto", [{ lat: 35, lng: 135.7 }])?.file).toBe(OPENFREEMAP_TILEJSON);
  });
});

describe("the OpenMapTiles Paper style", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: one OpenFreeMap source, real schema layers, no icons, no sprite`, () => {
      const style = paperStyle(OPENFREEMAP_TILEJSON, scheme, "de-CH");
      expect(Object.keys(style.sources)).toEqual(["openmaptiles"]);
      expect(style.sources.openmaptiles).toMatchObject({ type: "vector", url: OPENFREEMAP_TILEJSON });
      expect(style.sprite).toBeUndefined();
      expect(style.glyphs).toMatch(/^https:\/\/tiles\.openfreemap\.org\/fonts\//);
      const ids = style.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const layer of style.layers) {
        const sourceLayer = (layer as { "source-layer"?: string })["source-layer"];
        if (layer.type !== "background") expect(OPENMAPTILES_LAYERS).toContain(sourceLayer);
        expect(Object.keys((layer as { layout?: object }).layout ?? {}).filter((k) => k.startsWith("icon-"))).toEqual([]);
      }
      // POIs and peaks stay off, like the Protomaps flavour.
      expect(style.layers.some((l) => ["poi", "mountain_peak"].includes((l as { "source-layer"?: string })["source-layer"] ?? ""))).toBe(false);
    });
  }

  test("every label is in the reader's language, then English, then local", () => {
    const style = paperStyle(OPENFREEMAP_TILEJSON, "light", "fr-CH");
    const labels = style.layers.filter((l) => l.type === "symbol");
    expect(labels.length).toBeGreaterThan(3);
    for (const l of labels) {
      expect((l.layout as Record<string, unknown>)["text-field"]).toEqual([
        "coalesce", ["get", "name:fr"], ["get", "name:en"], ["get", "name"],
      ]);
    }
  });

  test("a local file still gets the Protomaps flavour", () => {
    expect(isOpenFreeMap("/api/maps/world.pmtiles")).toBe(false);
    const style = paperStyle("/api/maps/world.pmtiles", "light", "en");
    expect(Object.keys(style.sources)).toEqual(["world", "protomaps"]);
  });
});

describe("the server's card tiles over HTTPS", () => {
  const TEMPLATE = "https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf";
  const bbox = [8.25, 46.95, 8.45, 47.1] as const;

  async function freshModule() {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    const { streetLayersForBbox } = await import("@/lib/map/streetTiles");
    const { frameRoute } = await import("@/lib/mapFrame");
    const frame = frameRoute([{ lat: 47.05, lng: 8.3 }, { lat: 47.0, lng: 8.4 }] as never);
    return (file: string) => streetLayersForBbox(file, bbox, frame, 800);
  }

  test("a tile that fails marks the card incomplete, so it is not cached", async () => {
    const read = await freshModule();
    let tile = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === OPENFREEMAP_TILEJSON) return Response.json({ tiles: [TEMPLATE] });
      // An empty body is a valid, empty vector tile; every other one fails.
      return tile++ === 0 ? new Response(new Uint8Array()) : new Response("busy", { status: 503 });
    }));
    const out = await read(OPENFREEMAP_TILEJSON);
    expect(out?.complete).toBe(false);
  });

  test("a failed TileJSON refresh keeps drawing from the last template", async () => {
    const read = await freshModule();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn(async (url: string) =>
      url === OPENFREEMAP_TILEJSON ? Response.json({ tiles: [TEMPLATE] }) : new Response(new Uint8Array()),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await read(OPENFREEMAP_TILEJSON))?.complete).toBe(true);
    // Two hours later the TileJSON is down; the tiles still answer.
    now.mockReturnValue(1_000_000 + 2 * 60 * 60 * 1000);
    fetchMock.mockImplementation(async (url: string) =>
      url === OPENFREEMAP_TILEJSON ? new Response("down", { status: 502 }) : new Response(new Uint8Array()),
    );
    expect((await read(OPENFREEMAP_TILEJSON))?.complete).toBe(true);
    now.mockRestore();
  });
});
