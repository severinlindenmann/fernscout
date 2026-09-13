import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B294 — a day carries its prose in every language its journal declares.
 * Repointed onto v2's `PUT`/`PATCH .../days/{slug}` for B1612.
 *
 * The complaint that opened it: a journal with `locales: ["de","en","hu"]`
 * gave a reader who switched to English an English switcher, an English trip
 * title, and German prose. v1's answer lived in two places: `dayWrite`-level
 * "is `translations` present or declined at all" (a shape check), and a
 * second, journal-locale-AWARE check in the write route itself — which
 * locale a caller supplied, whether the journal actually declares it,
 * whether the day's OWN language was duplicated under `translations`,
 * whether every declared locale was covered — each with its own named
 * refusal (`translations.fr`, `translations.de`, "Missing hu").
 *
 * **v2 originally had only the first half**, and B1625/B1619 closed the
 * rest: a locale the journal does not declare, the day's own language
 * duplicated under `translations`, and a `translations` map covering only
 * some of what the journal is owed are all refused at the door
 * (`checkTranslations`, lib/api/v2/write.ts, called from both the trip and
 * the day route) — the first two as `invalid` (something wrong was sent),
 * the third as `incomplete` (something owed was not answered), matching the
 * full completeness contract v1 enforced — "you owe every language, named,
 * or a declined reason" — beyond "declared, or not this journal's at all".
 */

const OWNER = "viki";
const OWNER_EMAIL = "viki@example.test";
const TRIP_ID = "asien";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.13.${calls % 250}`, ...extra };
}

async function token(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`no token: ${verified.reason}`);
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Asien",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "public",
    people: [{ name: "V L", email: OWNER_EMAIL }],
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      // Deliberately NOT declined: this journal maintains three languages,
      // so the trip itself owes translations too — irrelevant to what these
      // tests are about, so declined generically here rather than modelled.
      translations: "not modelled for this fixture",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
      listed: "not advertised for this fixture",
      buddies: "travelling solo",
    },
  };
}

function baseDeclines(): Record<string, string> {
  return {
    media: "no photographs attached to this day yet",
    costs: "nothing spent today, tracked elsewhere",
    coordinates: "no position recorded for this day",
    weather: "weather was not asked for this day",
    time: "the exact time of day was not recorded",
    timezone: "no timezone established for this leg",
    location: "no specific location named for this day",
    country: "no country named for this day entry",
    countryCode: "no country code named for this day",
    transportMode: "no transport leg happened this day",
    tags: "no tags applied to this day",
    visibility: "no narrower visibility set for this day",
  };
}

const GERMAN = {
  slug: "2026-09-01-ankunft-in-bangkok",
  title: "Ankunft in Bangkok",
  date: "2026-09-01",
  content: "Um halb sechs aufgewacht und nicht mehr eingeschlafen.",
  status: "draft" as const,
};

const OTHERS = {
  en: { title: "Arriving in Bangkok", content: "Woke at half five and could not get back to sleep." },
  hu: { title: "Megérkezés Bangkokba", content: "Fél hatkor felkeltem és nem tudtam visszaaludni." },
};

async function createTheJournal(locales: string[], defaultLocale: string) {
  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Vikis Reisen",
    ownerEmail: OWNER_EMAIL,
    ownerName: "V L",
    ownerNickname: "Viki",
    locales,
    defaultLocale,
  });
  if (!created.ok) throw new Error(created.message);
}

async function putTrip() {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function putDay(overrides: Record<string, unknown> = {}) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const body = { ...GERMAN, declined: baseDeclines(), ...overrides };
  const slug = String(body.slug);
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function getDay(slug = GERMAN.slug) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      headers: headers({ authorization: `Bearer ${await token()}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchDay(slug: string, patch: Record<string, unknown>, ifMatch?: string) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PATCH",
      headers: headers({
        authorization: `Bearer ${await token()}`,
        ...(ifMatch ? { "if-match": ifMatch } : {}),
      }),
      body: JSON.stringify(patch),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-translations-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-translations-secret-day-translations";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a journal read in three languages", () => {
  beforeEach(async () => {
    await createTheJournal(["de", "en", "hu"], "de");
    const trip = await putTrip();
    if (trip.status !== 201) throw new Error(`trip not created: ${JSON.stringify(trip.body)}`);
  });

  test("writes a day that carries all three languages, and reads it back", async () => {
    const created = await putDay({ translations: OTHERS });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const { body } = await getDay();
    expect(body.title).toBe(GERMAN.title);
    const translations = body.translations as Record<string, { title: string; content: string }>;
    expect(translations.en.title).toBe(OTHERS.en.title);
    expect(translations.en.content).toBe(OTHERS.en.content);
    expect(translations.hu.content).toBe(OTHERS.hu.content);
  });

  test("prose with a paragraph break survives the round trip", async () => {
    const long = { title: "Zwei Absätze", content: "Erster Absatz.\n\nZweiter Absatz." };
    const created = await putDay({ translations: { en: long, hu: OTHERS.hu } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { body } = await getDay();
    const translations = body.translations as Record<string, { content: string }>;
    expect(translations.en.content).toBe(long.content);
  });

  test("declining translations altogether is accepted — the same as any other declinable", async () => {
    const created = await putDay({ declined: { ...baseDeclines(), translations: "not translated yet" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });

  test("rewriting the prose in every language at once, via PATCH, is accepted", async () => {
    await putDay({ translations: OTHERS });
    const { etag } = await getDay();
    const patched = await patchDay(
      GERMAN.slug,
      {
        content: "Ganz anders als gedacht.",
        translations: {
          en: { title: OTHERS.en.title, content: "Not at all what we expected." },
          hu: { title: OTHERS.hu.title, content: "Egészen máshogy alakult." },
        },
      },
      etag ?? undefined,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.content).toContain("Ganz anders");
    const translations = patched.body.translations as Record<string, { content: string }>;
    expect(translations.en.content).toBe("Not at all what we expected.");
  });

  test("changing a coordinate needs no translations, and what is already there survives untouched", async () => {
    await putDay({ translations: OTHERS });
    const { etag } = await getDay();
    const patched = await patchDay(
      GERMAN.slug,
      { coordinates: { lat: 13.75, lng: 100.5 }, declined: { coordinates: undefined } },
      etag ?? undefined,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const translations = patched.body.translations as Record<string, { content: string }>;
    expect(translations.hu.content).toBe(OTHERS.hu.content);
    expect((patched.body.coordinates as { lat: number }).lat).toBe(13.75);
  });

  /**
   * B1625 closed this one of the three gaps this file's comment lists: a
   * locale the journal does not declare is refused at the door
   * (`checkTranslations`, lib/api/v2/write.ts), on both the trip and the day
   * route. B1619 (below) closed the other two.
   */
  test("a translation for a language the journal never declared is refused", async () => {
    const refused = await putDay({
      translations: { ...OTHERS, fr: { title: "Arrivée", content: "Réveillé à cinq heures." } },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_translations");
  });

  /** B1619 closed the second of the three gaps: the day's own written
   * language duplicated under `translations` is now refused as `invalid` —
   * two answers to one question with no way to tell which wins. */
  test("the day's own language duplicated under translations is refused", async () => {
    const refused = await putDay({
      translations: { ...OTHERS, de: { title: "Nochmal", content: "Nochmal." } },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("invalid_translations");
  });

  /** B1619 closed the third gap: a translations map that covers only some of
   * what the journal is owed is now `incomplete` (422), naming the missing
   * language, rather than silently accepted. */
  test("translations covering only one of the two languages actually owed is incomplete", async () => {
    const incomplete = await putDay({ translations: { en: OTHERS.en } }); // hu missing entirely
    expect(incomplete.status, JSON.stringify(incomplete.body)).toBe(422);
    expect(incomplete.body.error).toBe("incomplete");
    const missing = (incomplete.body.details as { missing: { field: string }[] }).missing;
    expect(missing.map((m) => m.field)).toEqual(["translations.hu"]);
  });
});

describe("a journal read in one language", () => {
  beforeEach(async () => {
    await createTheJournal(["de"], "de");
    const trip = await putTrip();
    if (trip.status !== 201) throw new Error(`trip not created: ${JSON.stringify(trip.body)}`);
  });

  test("declining translations is enough — a single-language journal is exempt (per DAY_DECLINABLES' own comment)", async () => {
    const created = await putDay({ declined: { ...baseDeclines(), translations: "single-language journal" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });
});
