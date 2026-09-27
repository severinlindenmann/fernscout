import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { resolveCapabilities } from "@/lib/capabilities";

/**
 * B1794 — a dev instance needs `features.sms.backend: "dry-run"` and
 * `features.whatsapp.backend: "dry-run"` to come on with no TWILIO or
 * WHATSAPP keys at all, and to say so on /api/health the same way
 * `applePushNote` already does for `features.applePush.backend`.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-dryrun-cap-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sms dry-run is on with no TWILIO_* keys, and says so", () => {
  writeConfig({ sms: { enabled: true, backend: "dry-run" } });
  const state = resolveCapabilities().sms;
  expect(state).toEqual({
    name: "sms",
    enabled: true,
    note: 'features.sms.backend is "dry-run" — the message is written under <dataDir>/sms/ and nothing reaches a phone',
  });
});

test("sms twilio is refused with no TWILIO_* keys set", () => {
  writeConfig({ sms: { enabled: true, backend: "twilio" } });
  const state = resolveCapabilities().sms;
  expect(state.enabled).toBe(false);
  expect(!state.enabled && state.reason).toMatch(/TWILIO_ACCOUNT_SID/);
});

test("whatsapp dry-run is on with no WHATSAPP_* keys, and says so", () => {
  writeConfig({ whatsapp: { enabled: true, backend: "dry-run", number: "+41 79 111 22 33" } });
  const state = resolveCapabilities().whatsapp;
  expect(state.enabled).toBe(true);
  expect(state.enabled && state.note).toMatch(/features\.whatsapp\.backend is "dry-run"/);
});
