import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { resolveCapabilities } from "@/lib/capabilities";

/**
 * B2535 — `streetMaps` is off by default, and on only once `MAPS_DIR` is set
 * *and* it holds a readable `world.pmtiles` (`npm run maps:world`'s output).
 * Neither half is a secret, so both are safe to say out loud on
 * `/api/health` — see the reasons this asserts.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-streetmaps-cap-"));
  mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-streetmaps-dir-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.MAPS_DIR;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(mapsDir, { recursive: true, force: true });
});

test("off by default", () => {
  writeConfig({});
  const state = resolveCapabilities().streetMaps;
  expect(state).toEqual({ name: "streetMaps", enabled: false, reason: "not enabled on this server" });
});

test("enabled but MAPS_DIR unset is refused, and says which var", () => {
  writeConfig({ streetMaps: { enabled: true } });
  const state = resolveCapabilities().streetMaps;
  expect(state.enabled).toBe(false);
  expect(!state.enabled && state.reason).toMatch(/MAPS_DIR/);
});

test("enabled with MAPS_DIR set but no world.pmtiles is refused, and says how to fix it", () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  const state = resolveCapabilities().streetMaps;
  expect(state.enabled).toBe(false);
  expect(!state.enabled && state.reason).toMatch(/world\.pmtiles/);
  expect(!state.enabled && state.reason).toMatch(/npm run maps:world/);
});

test("enabled with a readable world.pmtiles is on", () => {
  writeConfig({ streetMaps: { enabled: true } });
  process.env.MAPS_DIR = mapsDir;
  fs.writeFileSync(path.join(mapsDir, "world.pmtiles"), "fake-tiles");
  const state = resolveCapabilities().streetMaps;
  expect(state).toEqual({ name: "streetMaps", enabled: true });
});
