import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";
import { createDraft } from "@/lib/api/entries";
import { GET as textsRoute } from "@/app/api/v1/[user]/postcards/texts/route";

// No browser here: every caller below arrives as an agent bearer token, which
// is the other door `isOwner` opens. Without this the cookie jar throws for
// being outside a request scope.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B478 — the words the composer offers, per day and per language.
 *
 * The property under test is the mapping, because it is the one thing here a
 * reader cannot check by looking: the journal's *written* language comes from
 * the entry's own prose and every other language from `translations:`, and a
 * language a day was never translated into is **absent** rather than quietly
 * falling back. The select is how somebody says what language the card is in,
 * and offering German under "Magyar" would make the order's `locale` a lie.
 */

let dir: string;
const REF = "viki/asien";
const OWNER_EMAIL = "viki@example.test";

const DAY = {
  title: "Erster Tag",
  date: "2026-09-01",
  location: "Hanoi",
  country: "Vietnam",
  content: "Ankunft am Morgen.",
  translations: {
    en: { title: "First day", content: "Arrived in the morning." },
    hu: { title: "Első nap", content: "Reggel érkeztünk." },
  },
};

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("viki", OWNER_EMAIL, "agent");
  const verified = await verifyCode("viki", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function texts(token: string | null, trip = "asien") {
  const response = await textsRoute(
    new Request(`https://t.test/api/v1/viki/postcards/texts?trip=${trip}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ user: "viki" }) },
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      writtenLocale?: string;
      locales?: string[];
      days?: { slug: string; date: string; title: string; texts: Record<string, string> }[];
    },
  };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-texts-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "postcard-texts-test-secret-postcard-texts";
  process.env.CONTACTS_ENCRYPTION_KEY = "22".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        contacts: { enabled: true },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, "viki", "trips", "asien", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "viki", "config.json"),
    JSON.stringify({
      title: "Vikis Reisen",
      tagline: "t",
      owner: { name: "V L", nickname: "Viki", email: OWNER_EMAIL },
      locales: ["de", "en", "hu"],
      defaultLocale: "de",
      features: { postcards: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "viki", "trips", "asien", "trip.md"),
    [
      "---",
      "id: asien",
      'title: "Asien"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET .../postcards/texts", () => {
  test("each language comes from where that language actually lives", async () => {
    createDraft(REF, DAY);
    const { status, body } = await texts(await ownerToken());
    expect(status).toBe(200);
    expect(body.writtenLocale).toBe("de");
    expect(body.days).toHaveLength(1);
    expect(body.days![0].texts).toEqual({
      de: "Ankunft am Morgen.",
      en: "Arrived in the morning.",
      hu: "Reggel érkeztünk.",
    });
  });

  test("a language the day was never translated into is absent, not the German", async () => {
    createDraft(REF, { ...DAY, translations: { en: { title: "First day", content: "Arrived." } } });
    const { body } = await texts(await ownerToken());
    expect(Object.keys(body.days![0].texts).sort()).toEqual(["de", "en"]);
  });

  test("a draft is offered — the owner composing a card may quote their own unpublished day", async () => {
    createDraft(REF, DAY);
    const { body } = await texts(await ownerToken());
    expect(body.days!.map((d) => d.slug)).toEqual(["erster-tag"]);
  });

  test("nobody who is not the owner is answered", async () => {
    createDraft(REF, DAY);
    expect((await texts(null)).status).toBe(403);
  });

  test("a trip that is not there is 404, and so is no trip at all", async () => {
    const token = await ownerToken();
    expect((await texts(token, "nowhere")).status).toBe(404);
    expect((await texts(token, "")).status).toBe(404);
  });
});
