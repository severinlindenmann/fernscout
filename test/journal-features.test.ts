import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { setJournalFeatures } from "@/lib/journals";
import { callTool } from "@/lib/mcp/tools";
import { resolveSession } from "@/lib/auth";

/**
 * B182 — a journal's capabilities after the day it was created.
 *
 * `createJournal` wrote a `features` block once and nothing anywhere ever wrote
 * one again: no endpoint, no tool, no page. So every journal made before a
 * default changed was frozen as it was, and the only cure was a shell on the
 * server — for a product whose whole premise is that the owner has never seen
 * the folder. On the live instance that left eight journals with contacts off
 * and no way to turn them on, which since B39 means no way to let anybody in
 * at all.
 *
 * What must stay true, and is what these are for:
 *
 *  - the server is still a ceiling, and a journal cannot climb over it;
 *  - `owner.email` is never writable here — it is the address that decides who
 *    can obtain a token for this journal (decision 24), and a token must not
 *    be able to move the boundary that issued it;
 *  - nothing else in config.json is touched, including keys this code has
 *    never heard of.
 */

const KEY = "44".repeat(32);
const SITE = "https://features.test";

let dir: string;
let token: string;

/** `content/config.json` — what this server is able to offer. */
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

async function patch(body: unknown, bearer = token) {
  const { PATCH } = await import("@/app/api/v1/[user]/config/route");
  const response = await PATCH(
    new Request(`${SITE}/api/v1/ana/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "ana" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-features-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "features.db")}`;
  process.env.SESSION_SECRET = "features-test-secret-features-te";
  process.env.AUTH_DEV_CODE = "123456";
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;

  writeServerConfig({ contacts: { enabled: true } });
  writeUserConfig();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  await issueCode("ana", "ana@example.test", "agent");
  const verified = await verifyCode("ana", "ana@example.test", "123456", "agent");
  if (!verified.ok) throw new Error("could not mint a token");
  token = verified.token;
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
  test("an existing journal can reach contacts without anybody touching the server", () => {
    // The state B153 describes, still true for every journal already on disk.
    expect(isEnabled("contacts", "ana")).toBe(false);

    const result = setJournalFeatures("ana", { contacts: true });
    expect(result).toMatchObject({ ok: true, changed: ["contacts"] });
    expect(isEnabled("contacts", "ana")).toBe(true);
  });

  test("through the endpoint, which is the point of it", async () => {
    const { status, body } = await patch({ features: { contacts: true } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, changed: ["contacts"] });
    expect(isEnabled("contacts", "ana")).toBe(true);
  });

  test("and through MCP, because the two doors are the same operation", async () => {
    const session = await resolveSession(token, "agent");
    if (!session) throw new Error("no session");
    const result = await callTool("set_journal_features", session, {
      features: { contacts: true },
    });
    expect(result?.ok).toBe(true);
    expect(isEnabled("contacts", "ana")).toBe(true);
  });

  test("saying the same thing twice changes nothing and is not an error", async () => {
    setJournalFeatures("ana", { contacts: true });
    const again = setJournalFeatures("ana", { contacts: true });
    expect(again).toMatchObject({ ok: true, changed: [] });
  });
});

describe("the server is still the ceiling", () => {
  test("a journal cannot switch on what this server does not provide", () => {
    // Contacts off on the server: no key, no server-side opt-in.
    writeServerConfig({});
    delete process.env.CONTACTS_ENCRYPTION_KEY;

    const result = setJournalFeatures("ana", { contacts: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("capability_unavailable");
    // The server's own reason, not a second implementation of the rule.
    expect(result.message).toContain("not enabled on this server");

    // And nothing was written, so the file cannot claim something untrue.
    expect((rawConfig().features as Record<string, unknown>).contacts).toBeUndefined();
  });

  test("the refusal names the missing credential when that is what is missing", () => {
    writeServerConfig({ contacts: { enabled: true } });
    delete process.env.CONTACTS_ENCRYPTION_KEY;

    const result = setJournalFeatures("ana", { contacts: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("CONTACTS_ENCRYPTION_KEY");
  });

  test("switching something off always works, whatever the server says", () => {
    // A journal narrowing itself asks nobody — `features.mail: false` in
    // particular is a mute button somebody must always be able to press (B60).
    writeServerConfig({});
    const result = setJournalFeatures("ana", { reactions: false });
    expect(result).toMatchObject({ ok: true, changed: ["reactions"] });
    expect(getUser("ana")?.features.reactions.enabled).toBe(false);
  });
});

describe("what it will not touch", () => {
  test("owner.email is not writable through it", async () => {
    const before = rawConfig();
    const { status, body } = await patch({
      features: { contacts: true },
      owner: { email: "someone-else@example.test" },
    });

    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
    expect(String(body.message)).toContain("owner.email");
    // Refused whole: the features half did not land either, so a caller
    // cannot smuggle a change past by attaching one that is accepted.
    expect(rawConfig()).toEqual(before);
    expect(isEnabled("contacts", "ana")).toBe(false);
  });

  test("everything else in the file survives a change", () => {
    // Including a key this code has never heard of: the file is edited, not
    // regenerated from what the parser understood.
    writeUserConfig({ somethingNobodyParsed: { keep: true } });
    setJournalFeatures("ana", { contacts: true });

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

describe("who may call it", () => {
  test("a token for another journal cannot", async () => {
    fs.mkdirSync(path.join(dir, "bea", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "bea", "config.json"),
      JSON.stringify({
        title: "Bea",
        owner: { name: "Bea", nickname: "Bea", email: "bea@example.test" },
      }),
    );
    clearUserCache();
    await issueCode("bea", "bea@example.test", "agent");
    const bea = await verifyCode("bea", "bea@example.test", "123456", "agent");
    if (!bea.ok) throw new Error("no token");

    const { status } = await patch({ features: { contacts: true } }, bea.token);
    expect(status).toBe(403);
    expect(isEnabled("contacts", "ana")).toBe(false);
  });

  test("an empty body says what to send rather than reporting success", async () => {
    const { status, body } = await patch({ features: {} });
    expect(status).toBe(400);
    expect(body.error).toBe("nothing_to_change");
  });
});
