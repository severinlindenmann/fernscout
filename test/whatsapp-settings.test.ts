import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { whatsappDisplayNumber } from "@/lib/whatsapp/settings";

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

describe("whatsappDisplayNumber", () => {
  test("absent when not configured", () => {
    writeConfig({ enabled: true });
    expect(whatsappDisplayNumber()).toBeUndefined();
  });

  test("the configured number, trimmed", () => {
    writeConfig({ enabled: true, number: " 41782172640 " });
    expect(whatsappDisplayNumber()).toBe("41782172640");
  });

  test("an empty string is the same as absent", () => {
    writeConfig({ enabled: true, number: "" });
    expect(whatsappDisplayNumber()).toBeUndefined();
  });
});
