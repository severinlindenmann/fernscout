import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { assertCapabilities, isEnabled, resolveCapabilities } from "@/lib/capabilities";

let dir: string;

/** Writes a config with `features` merged over the shipped defaults. */
function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test" },
      users: { reserved: [] },
      features,
    }),
  );
  clearConfigCache();
}

const TOUCHED = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "CONTACTS_ENCRYPTION_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "STANNP_API_KEY",
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-caps-"));
  process.env.CONTENT_DIR = dir;
  for (const key of TOUCHED) delete process.env[key];
  clearConfigCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  for (const key of TOUCHED) delete process.env[key];
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveCapabilities", () => {
  test("a disabled capability says so, and says why", () => {
    writeConfig({ auth: { enabled: false } });
    const state = resolveCapabilities().auth;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/not enabled on this server/);
  });

  test("enabled with everything present is enabled", () => {
    process.env.SESSION_SECRET = "s";
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ auth: { enabled: true } });
    expect(isEnabled("auth")).toBe(true);
  });

  test("enabled but missing an env var names the flag and the variable", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ auth: { enabled: true } });
    const state = resolveCapabilities().auth;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/features\.auth/);
    expect(state.enabled === false && state.reason).toMatch(/SESSION_SECRET/);
  });

  test("a capability that stores data needs DATABASE_URL", () => {
    process.env.SESSION_SECRET = "s";
    writeConfig({ auth: { enabled: true } });
    const state = resolveCapabilities().auth;
    expect(state.enabled === false && state.reason).toMatch(/DATABASE_URL/);
  });

  test("the file mail transport needs no credentials at all", () => {
    writeConfig({ mail: { enabled: true, transport: "file" } });
    expect(isEnabled("mail")).toBe(true);
  });

  test("the smtp transport names every missing credential", () => {
    writeConfig({ mail: { enabled: true, transport: "smtp" } });
    const state = resolveCapabilities().mail;
    expect(state.enabled === false && state.reason).toMatch(/SMTP_HOST/);
    expect(state.enabled === false && state.reason).toMatch(/MAIL_FROM/);
  });

  test("an unknown transport is rejected, not silently accepted", () => {
    writeConfig({ mail: { enabled: true, transport: "carrier-pigeon" } });
    const state = resolveCapabilities().mail;
    expect(state.enabled === false && state.reason).toMatch(/carrier-pigeon/);
  });

  test("the dry-run print provider needs no account", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ postcards: { enabled: true, provider: "dry-run" } });
    expect(isEnabled("postcards")).toBe(true);
  });

  test("a real print provider needs its key", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ postcards: { enabled: true, provider: "stannp" } });
    const state = resolveCapabilities().postcards;
    expect(state.enabled === false && state.reason).toMatch(/STANNP_API_KEY/);
  });
});

describe("assertCapabilities", () => {
  test("passes when everything enabled is configured", () => {
    writeConfig({ reactions: { enabled: true }, mail: { enabled: true, transport: "file" } });
    expect(() => assertCapabilities()).not.toThrow();
  });

  test("passes when nothing optional is enabled", () => {
    writeConfig({});
    expect(() => assertCapabilities()).not.toThrow();
  });

  test("fails loudly when a flag is on but unconfigured", () => {
    writeConfig({ auth: { enabled: true } });
    expect(() => assertCapabilities()).toThrow(/SESSION_SECRET|DATABASE_URL/);
  });

  test("reports every broken capability at once", () => {
    writeConfig({
      auth: { enabled: true },
      mail: { enabled: true, transport: "smtp" },
    });
    try {
      assertCapabilities();
      throw new Error("expected assertCapabilities to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/features\.auth/);
      expect(message).toMatch(/features\.mail/);
    }
  });
});
