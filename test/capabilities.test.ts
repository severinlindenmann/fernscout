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

  // B492: a self-hoster (or anybody) turning on postcards/photobook with no
  // real printer account is left on `dry-run`, which reports `enabled: true`
  // — correctly, since orders can still be composed — but must not look like
  // a working printer button. See dryRunNote() in lib/capabilities.ts.
  test("postcards on dry-run is enabled, and says nothing will actually print", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ postcards: { enabled: true, provider: "dry-run" } });
    const state = resolveCapabilities().postcards;
    expect(state.enabled).toBe(true);
    expect(state.enabled === true && state.note).toMatch(/dry-run/);
    expect(state.enabled === true && state.note).toMatch(/nothing is actually printed or posted/);
  });

  test("postcards with no provider named defaults to dry-run's note", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ postcards: { enabled: true } });
    const state = resolveCapabilities().postcards;
    expect(state.enabled === true && state.note).toMatch(/dry-run/);
  });

  test("photobook gets the same note as postcards", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ photobook: { enabled: true, provider: "dry-run" } });
    const state = resolveCapabilities().photobook;
    expect(state.enabled === true && state.note).toMatch(/dry-run/);
  });

  // B435 changed what this test is about. A configured Stannp still posts
  // nothing until `live` is set, so "fully configured" is no longer the same
  // claim as "putting cards in the post" — and which of the two an instance is
  // doing has to be readable from /api/health rather than guessed at.
  test("a configured print provider says whether it is really posting", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    process.env.STANNP_API_KEY = "k";
    writeConfig({ postcards: { enabled: true, provider: "stannp" } });
    const state = resolveCapabilities().postcards;
    expect(state.enabled).toBe(true);
    expect(state.enabled === true && state.note).toMatch(/dispatches none of them/);

    writeConfig({ postcards: { enabled: true, provider: "stannp", live: true } });
    const live = resolveCapabilities().postcards;
    expect(live.enabled === true && live.note).toMatch(/PRINTS AND POSTS/);
  });

  test("photobook has no live switch, so a configured provider carries no note", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    process.env.LULU_CLIENT_KEY = "k";
    process.env.LULU_CLIENT_SECRET = "s";
    writeConfig({ photobook: { enabled: true, provider: "lulu" } });
    const state = resolveCapabilities().photobook;
    expect(state.enabled).toBe(true);
    expect(state.enabled === true && state.note).toBeUndefined();
  });

  test("a capability with no dry-run concept never carries a note", () => {
    process.env.SESSION_SECRET = "s";
    process.env.DATABASE_URL = "sqlite:./x.db";
    writeConfig({ auth: { enabled: true } });
    const state = resolveCapabilities().auth;
    expect(state.enabled).toBe(true);
    expect(state.enabled === true && state.note).toBeUndefined();
  });

  test("logging is off by default, like every other unmentioned capability", () => {
    writeConfig({});
    const state = resolveCapabilities().logging;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/not enabled on this server/);
  });

  test("logging needs no env and no database — turning it on is enough", () => {
    writeConfig({ logging: { enabled: true } });
    expect(isEnabled("logging")).toBe(true);
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
