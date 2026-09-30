import { expect, test } from "vitest";
import { warmupUrls } from "@/lib/map/tileWarmup";

// B2603 — a trip area's tiles, two zoom levels ahead, capped.
const alps: [[number, number], [number, number]] = [[8.2, 46.1], [8.6, 46.8]];
const T = "/api/maps/tiles/planet.pmtiles/{z}/{x}/{y}?v=1";

test("covers the area at the next two zoom levels, shallow first", () => {
  const urls = warmupUrls(T, alps, 9.4);
  expect(urls[0]).toMatch(/\/10\/\d+\/\d+\?v=1$/);
  expect(urls.some((u) => u.includes("/11/"))).toBe(true);
  expect(urls.some((u) => u.includes("/12/"))).toBe(false);
  // Meiringen-ish (8.40, 46.50) sits in z10 tile x=535, y=362.
  expect(urls).toContain("/api/maps/tiles/planet.pmtiles/10/535/362?v=1");
});

test("never more than 150 tiles and never past z14", () => {
  expect(warmupUrls(T, [[-10, 35], [30, 60]], 8).length).toBe(150);
  expect(warmupUrls(T, alps, 14)).toEqual([]);
  expect(warmupUrls(T, alps, 13).every((u) => u.includes("/14/"))).toBe(true);
});

test("stops once 6 MB of tiles have come in", async () => {
  const { warmTiles } = await import("@/lib/map/tileWarmup");
  let calls = 0;
  const fetchMock = async () => {
    calls++;
    return new Response(new Uint8Array(1_000_000));
  };
  const real = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    await warmTiles(Array.from({ length: 50 }, (_, i) => `/t/${i}`), new AbortController().signal);
  } finally {
    globalThis.fetch = real;
  }
  expect(calls).toBe(6);
});
