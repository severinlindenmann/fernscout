import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { whatsappNumberForDisplay, whatsappNumberForUrl } from "@/lib/whatsapp/settings";

/**
 * B1127 — the dialable number a `wa.me` chip needs, and nothing else: no
 * guess from the Cloud API's phone number id, which names an account and
 * not a number a person can dial.
 */

let dir: string;

function writeConfig(whatsapp: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, users: { reserved: [] }, features: { whatsapp } }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-settings-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("whatsappNumberForUrl", () => {
  test("absent when not configured", () => {
    writeConfig({ enabled: true });
    expect(whatsappNumberForUrl()).toBeUndefined();
  });

  test("the configured number, trimmed", () => {
    writeConfig({ enabled: true, number: " 41782172640 " });
    expect(whatsappNumberForUrl()).toBe("41782172640");
  });

  test("an empty string is the same as absent", () => {
    writeConfig({ enabled: true, number: "" });
    expect(whatsappNumberForUrl()).toBeUndefined();
  });

  test("a human-formatted number is normalised to bare digits", () => {
    // The live instance's own shape — typed with spaces and a leading +,
    // which a wa.me link cannot use as-is.
    writeConfig({ enabled: true, number: "+41 78 217 26 46" });
    expect(whatsappNumberForUrl()).toBe("41782172646");
    expect(whatsappNumberForDisplay()).toBe("+41782172646");
  });
});
