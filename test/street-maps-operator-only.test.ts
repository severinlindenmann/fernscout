import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Street maps are the operator's: they build the tiles, a journal has no
// switch for them. While the flag was per-journal, the day and trip cards
// (which ask `isEnabled("streetMaps", user)`) drew no streets for any
// journal on fernscout.ch, while the map page (asking the server) did.

let dir: string;
let maps: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-street-"));
  maps = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-street-maps-"));
  fs.writeFileSync(path.join(maps, "world.pmtiles"), "");
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: { streetMaps: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "ana"));
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "T",
      owner: { name: "Ana Meyer", nickname: "Ana", email: "ana@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  process.env.CONTENT_DIR = dir;
  process.env.MAPS_DIR = maps;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.MAPS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(maps, { recursive: true, force: true });
});

test("a journal that never mentions street maps gets the server's answer", async () => {
  const { isEnabled } = await import("@/lib/capabilities");
  expect(isEnabled("streetMaps")).toBe(true);
  expect(isEnabled("streetMaps", "ana")).toBe(true);
});
