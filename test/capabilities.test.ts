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
  "ANTHROPIC_API_KEY",
  "LULU_CLIENT_KEY",
  "LULU_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
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

describe("a capability that needs another one", () => {
  /**
   * B724 — the dependency is a field on `Requirement`, so `/api/health`
   * reports a missing one the same way it reports a missing environment
   * variable. It was two `if`s in the resolver before, which is where a third
   * would have gone unnoticed.
   */
  test("is off, and the reason names the switch to throw", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    writeConfig({ helper: { enabled: true }, credits: { enabled: false } });
    const helper = resolveCapabilities().helper;
    expect(helper.enabled).toBe(false);
    const reason = helper.enabled ? "" : helper.reason;
    expect(reason).toContain("features.credits is not");
    expect(reason).toContain("metered");
  });

  test("comes on once the one it needs is on", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    writeConfig({ helper: { enabled: true }, credits: { enabled: true } });
    expect(resolveCapabilities().helper.enabled).toBe(true);
  });

  /**
   * B938 — the third one, and the one that was missing.
   *
   * Everything `contacts` does ends in somebody reading a journal they were
   * let into, and being let in is a session. With `auth` off the approval
   * queue still worked, still made grants, and still mailed the newly
   * approved person a button — pointing at the journal's front page, where
   * she met the gate she had just been told she was past. That mail is the
   * only one she gets, so nothing corrected it.
   */
  test("an approval queue that cannot let anybody in does not come on", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.CONTACTS_ENCRYPTION_KEY = "a".repeat(64);
    writeConfig({ contacts: { enabled: true }, auth: { enabled: false } });
    const contacts = resolveCapabilities().contacts;
    expect(contacts.enabled).toBe(false);
    const reason = contacts.enabled ? "" : contacts.reason;
    expect(reason).toContain("features.auth is not");
    expect(reason).toContain("session");
  });

  test("the second one is data too, so both are reported the same way", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    writeConfig({ transcription: { enabled: true }, credits: { enabled: false } });
    const speech = resolveCapabilities().transcription;
    expect(speech.enabled).toBe(false);
    expect(speech.enabled ? "" : speech.reason).toContain("features.credits is not");
  });
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

  // B1113: a photobook provider carries the same live/draft distinction a
  // postcard provider does, in Gelato's own word for the not-live state.
  test("a configured photobook provider says whether it is really printing", () => {
    process.env.DATABASE_URL = "sqlite:./x.db";
    process.env.GELATO_API_KEY = "k";
    writeConfig({ photobook: { enabled: true, provider: "gelato" } });
    const state = resolveCapabilities().photobook;
    expect(state.enabled).toBe(true);
    expect(state.enabled === true && state.note).toMatch(/draft/);

    writeConfig({ photobook: { enabled: true, provider: "gelato", live: true } });
    const live = resolveCapabilities().photobook;
    expect(live.enabled === true && live.note).toMatch(/live/);
    expect(live.enabled === true && live.note).not.toMatch(/draft/);
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

// B589: the fulfilment relay's two halves, both off by default and both
// operator-only (neither is a journal's flag to flip — see
// OPERATOR_ONLY_FEATURES in lib/config.ts).
describe("fulfilment", () => {
  test("both halves are off with no config at all", () => {
    writeConfig({});
    const state = resolveCapabilities();
    expect(state.fulfilmentRelay.enabled).toBe(false);
    expect(state.fulfilmentAccept.enabled).toBe(false);
  });

  test("relay comes on once a fulfilment instance is named", () => {
    writeConfig({ fulfilmentRelay: { enabled: true, url: "https://printer.example.test" } });
    expect(isEnabled("fulfilmentRelay")).toBe(true);
  });

  test("relay enabled with no url names the missing field", () => {
    writeConfig({ fulfilmentRelay: { enabled: true } });
    const state = resolveCapabilities().fulfilmentRelay;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/fulfilmentRelay\.url/);
  });

  test("accept stays off when postcards and photobook are both off", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    writeConfig({ fulfilmentAccept: { enabled: true } });
    const state = resolveCapabilities().fulfilmentAccept;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/postcards/);
    expect(state.enabled === false && state.reason).toMatch(/photobook/);
  });

  test("accept stays off when the only enabled printer is still dry-run", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    writeConfig({
      fulfilmentAccept: { enabled: true },
      postcards: { enabled: true, provider: "dry-run" },
    });
    const state = resolveCapabilities().fulfilmentAccept;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/dry-run/);
  });

  test("a real printer with no payment method names the missing one", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.STANNP_API_KEY = "k";
    writeConfig({
      fulfilmentAccept: { enabled: true },
      postcards: { enabled: true, provider: "stannp" },
    });
    const state = resolveCapabilities().fulfilmentAccept;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toMatch(/STRIPE_SECRET_KEY/);
  });

  test("a real printer plus a configured payment method turns it on", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.STANNP_API_KEY = "k";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    writeConfig({
      fulfilmentAccept: { enabled: true },
      postcards: { enabled: true, provider: "stannp" },
    });
    expect(isEnabled("fulfilmentAccept")).toBe(true);
  });

  test("photobook alone with a real provider is enough, postcards need not be on", () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    process.env.LULU_CLIENT_KEY = "k";
    process.env.LULU_CLIENT_SECRET = "s";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    writeConfig({
      fulfilmentAccept: { enabled: true },
      photobook: { enabled: true, provider: "lulu" },
    });
    expect(isEnabled("fulfilmentAccept")).toBe(true);
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
