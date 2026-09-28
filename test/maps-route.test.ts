import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";

/**
 * B2535 — `GET /api/maps/[...path]`: 404 when the capability is off, 206 on
 * a range request, and a traversal or unsafe path never reaches the
 * filesystem outside `MAPS_DIR`.
 */

let dir: string;
let mapsDir: string;

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features,
    }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-maps-route-"));
  mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-maps-route-dir-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  fs.writeFileSync(path.join(mapsDir, "world.pmtiles"), "0123456789");
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.MAPS_DIR;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(mapsDir, { recursive: true, force: true });
});

async function get(pathSegments: string[], headers?: Record<string, string>) {
  const { GET } = await import("@/app/api/maps/[...path]/route");
  const url = `https://t.test/api/maps/${pathSegments.join("/")}`;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ path: pathSegments }) });
}

test("404 when the capability is off", async () => {
  writeConfig({});
  process.env.MAPS_DIR = mapsDir;
  const res = await get(["world.pmtiles"]);
  expect(res.status).toBe(404);
});

test("404 when the capability is on but MAPS_DIR still has no world file", async () => {
  writeConfig({ streetMaps: { enabled: true } });
  const res = await get(["world.pmtiles"]);
  expect(res.status).toBe(404);
});

test("200 with the whole file for an ordinary request", async () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  const res = await get(["world.pmtiles"]);
  expect(res.status).toBe(200);
  expect(res.headers.get("accept-ranges")).toBe("bytes");
  expect(await res.text()).toBe("0123456789");
});

test("206 for a range request", async () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  const res = await get(["world.pmtiles"], { range: "bytes=2-4" });
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
  expect(await res.text()).toBe("234");
});

test("refuses a path outside MAPS_DIR", async () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  const res = await get(["..", "..", "..", "etc", "passwd.pmtiles"]);
  expect(res.status).toBe(404);
});

test("refuses a file that doesn't exist", async () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  const res = await get(["nope.pmtiles"]);
  expect(res.status).toBe(404);
});
