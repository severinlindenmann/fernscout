import { beforeEach, expect, test, vi } from "vitest";

// B2601 — tiles looked up on the server, served as plain cacheable responses.
const getZxy = vi.fn();
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
vi.mock("@/lib/maps/dir", () => ({
  resolveMapsFile: (segs: string[]) => (segs.join("/") === "planet.pmtiles" ? "/maps/planet.pmtiles" : null),
}));
vi.mock("@/lib/maps/tiles", () => ({
  tilesFor: () => ({
    mtimeMs: 1234.9,
    tiles: {
      getZxy,
      getHeader: async () => ({ minZoom: 0, maxZoom: 15, minLon: -180, minLat: -85, maxLon: 180, maxLat: 85 }),
    },
  }),
}));

const { GET: tile } = await import("@/app/api/maps/tiles/[...path]/route");
const { GET: tilejson } = await import("@/app/api/maps/tilejson/[...path]/route");
type Handler = (request: Request, ctx: never) => Promise<Response>;
const call = (fn: Handler, url: string, path: string[]) =>
  fn(new Request(url), { params: Promise.resolve({ path }) } as never);

beforeEach(() => getZxy.mockReset());

test("the TileJSON points at the tile route and versions it by the file's mtime", async () => {
  const res = await call(tilejson as Handler, "http://x/api/maps/tilejson/planet.pmtiles", ["planet.pmtiles"]);
  const doc = await res.json();
  expect(doc.tiles).toEqual(["/api/maps/tiles/planet.pmtiles/{z}/{x}/{y}?v=1234"]);
  expect(doc.maxzoom).toBe(15);
  expect(res.headers.get("cache-control")).toBe("public, max-age=300");
});

test("a tile at the current version is a 200 cached for a year", async () => {
  getZxy.mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer });
  const res = await call(tile as Handler, "http://x/api/maps/tiles/planet.pmtiles/12/2143/1437?v=1234", ["planet.pmtiles", "12", "2143", "1437"]);
  expect(res.status).toBe(200);
  expect(getZxy).toHaveBeenCalledWith(12, 2143, 1437);
  expect(res.headers.get("content-type")).toBe("application/x-protobuf");
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test("an old or missing version is cached an hour only; an empty tile is 204", async () => {
  getZxy.mockResolvedValue(undefined);
  const res = await call(tile as Handler, "http://x/api/maps/tiles/planet.pmtiles/3/1/1?v=999", ["planet.pmtiles", "3", "1", "1"]);
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
});

test("bad coordinates and unknown files are 404", async () => {
  expect((await call(tile as Handler, "http://x/t", ["planet.pmtiles", "a", "1", "1"])).status).toBe(404);
  expect((await call(tile as Handler, "http://x/t", ["1", "1", "1"])).status).toBe(404);
  expect((await call(tile as Handler, "http://x/t", ["other.pmtiles", "1", "1", "1"])).status).toBe(404);
  expect(getZxy).not.toHaveBeenCalled();
});

test("a tile outside the zoom level's bounds is a quiet 404, never looked up", async () => {
  expect((await call(tile as Handler, "http://x/t", ["planet.pmtiles", "2", "4", "0"])).status).toBe(404);
  expect((await call(tile as Handler, "http://x/t", ["planet.pmtiles", "0", "0", "1"])).status).toBe(404);
  expect(getZxy).not.toHaveBeenCalled();
  getZxy.mockResolvedValue(undefined);
  expect((await call(tile as Handler, "http://x/t", ["planet.pmtiles", "2", "3", "3"])).status).toBe(204);
});
