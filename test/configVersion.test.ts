import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CURRENT_CONFIG_VERSION,
  assertConfigVersion,
  checkConfigVersion,
} from "@/lib/configVersion";

/**
 * M12 — a `git pull` that outgrows a self-hoster's config.json must fail with
 * a clear message, not a crash somewhere downstream in lib/config.ts.
 */

let dir: string;

function writeServerConfig(extra: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" }, ...extra }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cv-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("checkConfigVersion", () => {
  test("a file with no configVersion at all is read as version 1 and passes", () => {
    writeServerConfig({});
    expect(checkConfigVersion()).toEqual({ ok: true, version: 1 });
  });

  test("a matching version passes", () => {
    writeServerConfig({ configVersion: CURRENT_CONFIG_VERSION });
    expect(checkConfigVersion()).toEqual({ ok: true, version: CURRENT_CONFIG_VERSION });
  });

  test("an older version fails with an upgrade message, not a throw", () => {
    writeServerConfig({ configVersion: 0 });
    const result = checkConfigVersion();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/configVersion.*0/);
      expect(result.message).toMatch(/config-upgrades\.md/);
    }
  });

  test("a newer version (config ahead of this build) also fails clearly", () => {
    writeServerConfig({ configVersion: CURRENT_CONFIG_VERSION + 1 });
    const result = checkConfigVersion();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/update the app/i);
    }
  });

  test("a missing or unreadable config.json is not this module's problem to report", () => {
    // No file written at all — readRawConfigVersion tolerates it and falls
    // back to version 1, matching CURRENT_CONFIG_VERSION, so this reports ok.
    // The missing file itself is reported by lib/config.ts's own ConfigError
    // wherever that module is actually asked to load it.
    expect(checkConfigVersion()).toEqual({ ok: true, version: 1 });
  });
});

describe("assertConfigVersion", () => {
  test("throws with the same message checkConfigVersion reports", () => {
    writeServerConfig({ configVersion: 0 });
    expect(() => assertConfigVersion()).toThrow(/configVersion.*0/);
  });

  test("does not throw when the version matches", () => {
    writeServerConfig({ configVersion: CURRENT_CONFIG_VERSION });
    expect(() => assertConfigVersion()).not.toThrow();
  });
});
