import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { isEnabled } from "@/lib/capabilities";
import { setJournalFeatures } from "@/lib/journals";

/**
 * B182 — a journal's capabilities after the day it was created, at the
 * `setJournalFeatures` layer.
 *
 * B1632 retired `PATCH /api/v1/{user}/config` — the whole per-journal
 * `features` block is instance-only in v2 and unwritable by any journal
 * there (00-decisions.md, decision 5) — and with it the route-level tests
 * this file used to carry: `GET`/`PATCH .../config`'s own field-by-field
 * behaviour (title, tagline, locales, visibility, manualRates, media,
 * owner.email, baseCurrency, mixed_change) and the journal's own default
 * party (`.../travellers`, B1526 — the figure library replaced the inline
 * block, see `PUT /api/v2/{user}/figures/{id}`). None of those routes
 * exist any more; `PATCH /api/v2/{user}` (`test/api-v2-journal.test.ts`)
 * covers the surviving profile-field writes in v2's own document shape,
 * and the figure library has its own coverage (`test/api-v2-figures.test.ts`).
 *
 * What is left here is `setJournalFeatures` itself, called directly rather
 * than through a route: `channels` (kept, `app/api/v2/[user]/channels/
 * route.ts`, reached from a browser through the cookie proxy
 * `app/api/web/[user]/channels/route.ts`) still calls it for
 * `mail`/`whatsapp`, and helper journal tools call it too, so the function is
 * not dead even though its general-purpose door is gone. What must stay
 * true, and is what these are for:
 *
 *  - the server is still a ceiling, and a journal cannot climb over it;
 *  - nothing else in config.json is touched, including keys this code has
 *    never heard of.
 */

const SITE = "https://features.test";

let dir: string;

/** `site/config.json` — what this server is able to offer. */
function writeServerConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: SITE, defaultUser: "ana" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, ...features },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeUserConfig(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(dir, "ana", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify(
      {
        title: "Ana",
        tagline: "one slow loop",
        owner: { name: "Ana Meyer", nickname: "Ana", email: "ana@example.test" },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        features: { reactions: { enabled: true } },
        ...extra,
      },
      null,
      2,
    ),
  );
  clearConfigCache();
  clearUserCache();
}

function rawConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, "ana", "config.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-features-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "features.db")}`;
  process.env.SESSION_SECRET = "features-test-secret-features-te";
  process.env.AUTH_DEV_CODE = "123456";
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);

  writeServerConfig({ contacts: { enabled: true } });
  writeUserConfig();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_DEV_CODE;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("switching a capability on", () => {
  // `whatsappInbound` is the surviving opt-in shape: off by default
  // (`DEFAULT_FEATURES.whatsappInbound`, lib/config.ts) and switched on per
  // journal — from onboarding (`lib/whatsapp/onboarding.ts`) and from the
  // inbox itself (`lib/whatsapp/dispatch.ts`) — never from a bare `true` the
  // server has not also allowed.
  function allowWhatsappInbound() {
    writeServerConfig({ whatsappInbound: { enabled: true } });
    process.env.WHATSAPP_APP_SECRET = "secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "token";
  }

  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  test("an existing journal can reach whatsappInbound without anybody touching the server", () => {
    allowWhatsappInbound();
    expect(isEnabled("whatsappInbound", "ana")).toBe(false);

    const result = setJournalFeatures("ana", { whatsappInbound: true });
    expect(result).toMatchObject({ ok: true, changed: ["whatsappInbound"] });
    expect(isEnabled("whatsappInbound", "ana")).toBe(true);
  });

  test("saying the same thing twice changes nothing and is not an error", () => {
    allowWhatsappInbound();
    setJournalFeatures("ana", { whatsappInbound: true });
    const again = setJournalFeatures("ana", { whatsappInbound: true });
    expect(again).toMatchObject({ ok: true, changed: [] });
  });
});

describe("decision 5 (B1666) — everything but a channel mute is the server's alone", () => {
  test.each([true, false])("a journal cannot switch photobook %s", (enabled) => {
    // Both directions: on would be a grant it does not have, off would be a
    // key written into the file that nothing reads.
    const result = setJournalFeatures("ana", { photobook: enabled });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("capability_not_yours");
    expect((rawConfig().features as Record<string, unknown>).photobook).toBeUndefined();
  });

  test("postcards is refused the same way, and refusing writes nothing at all", () => {
    const result = setJournalFeatures("ana", { postcards: false, whatsappInbound: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("capability_not_yours");
    // `whatsappInbound` was legitimate and is still unwritten: the refusal
    // is the whole request's, not this one key's.
    expect((rawConfig().features as Record<string, unknown>).whatsappInbound).toBeUndefined();
  });

  // The capabilities decision 5 moved into the same bucket as photobook and
  // postcards above: no v2 door ever lets a journal set one, so a journal's
  // own vote was dead weight that could only narrow it below the server's
  // answer. `resolveOne` no longer reads the per-journal flag for any of
  // these — see `OPERATOR_ONLY_FEATURES` in lib/config.ts — and this is the
  // write side of the same fact.
  test.each(["reactions", "costs", "push", "auth", "signup", "contacts", "addressLookup", "weather", "analytics"])(
    "a journal cannot switch %s on or off any more",
    (name) => {
      const result = setJournalFeatures("ana", { [name]: true });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe("capability_not_yours");
    },
  );
});

describe("the server is still the ceiling", () => {
  test("a journal cannot switch on what this server does not provide", () => {
    // whatsappInbound off on the server: no key, no server-side opt-in.
    writeServerConfig({});

    const result = setJournalFeatures("ana", { whatsappInbound: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("capability_unavailable");
    // The server's own reason, not a second implementation of the rule.
    expect(result.message).toContain("not enabled on this server");

    // And nothing was written, so the file cannot claim something untrue.
    expect((rawConfig().features as Record<string, unknown>).whatsappInbound).toBeUndefined();
  });

  test("the refusal names the missing credential when that is what is missing", () => {
    writeServerConfig({ whatsappInbound: { enabled: true } });

    const result = setJournalFeatures("ana", { whatsappInbound: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("WHATSAPP_APP_SECRET");
  });

  test("switching a channel off always works, whatever the server says", () => {
    // A journal narrowing itself asks nobody — `features.mail: false` in
    // particular is a mute button somebody must always be able to press (B60).
    writeServerConfig({});
    const result = setJournalFeatures("ana", { mail: false });
    expect(result).toMatchObject({ ok: true, changed: ["mail"] });
    expect(getUser("ana")?.features.mail.enabled).toBe(false);
  });
});

describe("what it will not touch", () => {
  test("everything else in the file survives a change", () => {
    // Including a key this code has never heard of: the file is edited, not
    // regenerated from what the parser understood.
    writeUserConfig({ somethingNobodyParsed: { keep: true } });
    setJournalFeatures("ana", { mail: false });

    const after = rawConfig();
    expect(after.title).toBe("Ana");
    expect(after.owner).toEqual({
      name: "Ana Meyer",
      nickname: "Ana",
      email: "ana@example.test",
    });
    expect(after.somethingNobodyParsed).toEqual({ keep: true });
  });

  test("a feature's other settings survive being switched off and on", () => {
    // `transport` is the operator's choice and is not this call's business.
    writeUserConfig({ features: { mail: { enabled: true, transport: "file" } } });
    setJournalFeatures("ana", { mail: false });
    expect((rawConfig().features as { mail: Record<string, unknown> }).mail).toEqual({
      enabled: false,
      transport: "file",
    });
  });

  test("a capability this server has never heard of is refused", () => {
    const result = setJournalFeatures("ana", { telepathy: true });
    expect(result).toMatchObject({ ok: false, error: "unknown_feature" });
  });

  test("a value that is not a boolean is refused", () => {
    const result = setJournalFeatures("ana", { contacts: "yes" });
    expect(result).toMatchObject({ ok: false, error: "invalid_feature" });
  });
});
