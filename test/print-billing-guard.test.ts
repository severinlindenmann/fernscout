import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache, parseServerConfig } from "@/lib/config";
import { resolveCapabilities } from "@/lib/capabilities";
import { hasPaid } from "./support/openCore";

/**
 * B2713 — a peer's prod deploy shipped billing disabled while
 * `features.postcards.live` was true, so every postcard was free: nothing
 * refused a live print switch with billing off. A live print must report
 * `enabled: false` (absent, not broken) with a reason `/api/health` can
 * print, and billing on must let it through unchanged.
 */

let dir: string;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-print-billing-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test.runIf(hasPaid())("postcards.live with billing off is disabled and says why", () => {
  writeConfig({ postcards: { enabled: true, provider: "dry-run", live: true } });
  const state = resolveCapabilities().postcards;
  expect(state.enabled).toBe(false);
  expect(!state.enabled && state.reason).toMatch(/features\.billing is not enabled/);
});

test.runIf(hasPaid())("photobook.live with billing off is disabled and says why", () => {
  writeConfig({ photobook: { enabled: true, provider: "dry-run", live: true } });
  const state = resolveCapabilities().photobook;
  expect(state.enabled).toBe(false);
  expect(!state.enabled && state.reason).toMatch(/features\.billing is not enabled/);
});

test.runIf(hasPaid())("postcards.live with billing on is still enabled, and the real-provider live note still fires", () => {
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "billing-on.sqlite")}`;
  process.env.STANNP_API_KEY = "test-key";
  writeConfig({
    postcards: { enabled: true, provider: "stannp", live: true },
    billing: { enabled: true },
  });
  const state = resolveCapabilities().postcards;
  expect(state.enabled).toBe(true);
  expect(state.enabled && state.note).toMatch(/PRINTS AND POSTS real cards/);
  delete process.env.STANNP_API_KEY;
});

test.runIf(hasPaid())("postcards.live false is unaffected by billing being off (rehearsal stays on)", () => {
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "rehearsal.sqlite")}`;
  writeConfig({ postcards: { enabled: true, provider: "dry-run" } });
  const state = resolveCapabilities().postcards;
  expect(state.enabled).toBe(true);
});

describe("retired feature keys", () => {
  test("a retired features.credits key loads and builds, with a warning instead of a thrown ConfigError", () => {
    const raw = {
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { credits: { enabled: true } },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = parseServerConfig(raw);
    const calls = warn.mock.calls.map(([m]) => String(m));
    warn.mockRestore();
    expect(config).toBeTruthy();
    expect(calls.some((m) => m.includes("features.credits") && m.includes("ignored"))).toBe(true);
  });
});
