import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { getEntryBySlug } from "@/lib/entries";
import { POST as writeDay } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { PATCH as editDay } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";

/**
 * B294 — a day carries its prose in every language its journal declares.
 *
 * The complaint that opened it: a journal with `locales: ["de","en","hu"]`
 * gave a reader who switched to English an English switcher, an English trip
 * title, and German prose. `translations` existed for a trip's title and
 * tagline and for nothing else, so there was no call that could put a day's
 * words in a second language.
 *
 * The owner's decision was to require them rather than to trim the promise,
 * and these tests are mostly about the refusal — because B263 and B277 each
 * shipped a field an agent was asked to send and allowed to omit, and both
 * were omitted.
 */

let dir: string;
const OWNER_EMAIL = "viki@example.test";

function writeJournal(locales: string[], defaultLocale: string) {
  fs.mkdirSync(path.join(dir, "viki", "trips", "asien", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "viki", "config.json"),
    JSON.stringify({
      title: "Vikis Reisen",
      tagline: "t",
      owner: { name: "V L", nickname: "Viki", email: OWNER_EMAIL },
      locales,
      defaultLocale,
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
}

async function token(): Promise<string> {
  const { code } = await issueCode("viki", OWNER_EMAIL, "agent");
  const verified = await verifyCode("viki", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`no token: ${verified.reason}`);
  return verified.token;
}

type Problem = { field: string; got: string; expected: string; hint?: string };

async function post(body: unknown) {
  const response = await writeDay(
    new Request("https://t.test/api/v1/viki/trips/asien/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "viki", trip: "asien" }) },
  );
  return { status: response.status, body: (await response.json()) as { problems?: Problem[]; slug?: string } };
}

async function patch(slug: string, body: unknown) {
  const response = await editDay(
    new Request(`https://t.test/api/v1/viki/trips/asien/days/${slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "viki", trip: "asien", slug }) },
  );
  return { status: response.status, body: (await response.json()) as { problems?: Problem[] } };
}

const GERMAN = {
  title: "Ankunft in Bangkok",
  date: "2026-09-01",
  content: "Um halb sechs aufgewacht und nicht mehr eingeschlafen.",
};

const OTHERS = {
  en: { title: "Arriving in Bangkok", content: "Woke at half five and could not get back to sleep." },
  hu: { title: "Megérkezés Bangkokba", content: "Fél hatkor felkeltem és nem tudtam visszaaludni." },
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-translations-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-translations-secret-day-translations";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
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
  beforeEach(() => writeJournal(["de", "en", "hu"], "de"));

  test("refuses a day with no translations, and names the languages it owes", async () => {
    const { status, body } = await post(GERMAN);
    expect(status).toBe(400);
    const problem = body.problems?.find((p) => p.field === "translations");
    expect(problem).toBeDefined();
    // The two it does not have, named — not "incomplete", which would send an
    // agent guessing at the very field where guessing means invention.
    expect(problem?.expected).toContain("en");
    expect(problem?.expected).toContain("hu");
    // Never the language the prose is already in.
    expect(problem?.expected).not.toMatch(/\bde, en, hu as well\b/);
    // B316: the hint must not read as an absolute ban — it permits translating
    // when the owner asks, and only forbids doing so unasked.
    expect(problem?.hint).toContain("do not translate their prose yourself unless they ask");
    expect(problem?.hint).toContain("if they do, translate it and say so");
    // And the remedy is the journal's, not the day's.
    expect(problem?.hint).toContain('locales: ["de"]');
  });

  test("names only the language actually missing", async () => {
    const { status, body } = await post({ ...GERMAN, translations: { en: OTHERS.en } });
    expect(status).toBe(400);
    const problem = body.problems?.find((p) => p.field === "translations");
    expect(problem?.hint).toContain("Missing hu");
    expect(problem?.hint).not.toContain("Missing en");
  });

  test("writes a day that carries all three, and reads it back", async () => {
    const { status } = await post({ ...GERMAN, translations: OTHERS });
    expect(status).toBe(201);

    const entry = getEntryBySlug("viki/asien", "ankunft-in-bangkok", { includeDrafts: true });
    expect(entry?.title).toBe(GERMAN.title);
    expect(entry?.translations?.en?.title).toBe(OTHERS.en.title);
    expect(entry?.translations?.en?.content).toBe(OTHERS.en.content);
    expect(entry?.translations?.hu?.content).toBe(OTHERS.hu.content);
  });

  test("prose with a paragraph break survives the round trip", async () => {
    const long = { title: "Zwei Absätze", content: "Erster Absatz.\n\nZweiter Absatz." };
    const { status } = await post({
      ...GERMAN,
      title: "Absaetze",
      translations: { en: long, hu: OTHERS.hu },
    });
    expect(status).toBe(201);
    const entry = getEntryBySlug("viki/asien", "absaetze", { includeDrafts: true });
    expect(entry?.translations?.en?.content).toBe(long.content);
  });

  test("refuses a language the journal does not declare", async () => {
    const { status, body } = await post({
      ...GERMAN,
      translations: { ...OTHERS, fr: { title: "Arrivée", content: "Réveillé à cinq heures." } },
    });
    expect(status).toBe(400);
    const problem = body.problems?.find((p) => p.field === "translations.fr");
    expect(problem?.expected).toContain("de, en, hu");
    expect(problem?.hint).toContain("never reach a reader");
  });

  test("refuses a translation into the language the day is already written in", async () => {
    const { status, body } = await post({
      ...GERMAN,
      translations: { ...OTHERS, de: { title: "Nochmal", content: "Nochmal." } },
    });
    expect(status).toBe(400);
    expect(body.problems?.some((p) => p.field === "translations.de")).toBe(true);
  });

  test("refuses a translation missing its content", async () => {
    const { status, body } = await post({
      ...GERMAN,
      translations: { en: { title: OTHERS.en.title }, hu: OTHERS.hu },
    });
    expect(status).toBe(400);
    expect(body.problems?.some((p) => p.field === "translations.en.content")).toBe(true);
  });

  describe("editing one", () => {
    beforeEach(async () => {
      const { status } = await post({ ...GERMAN, translations: OTHERS });
      expect(status).toBe(201);
    });

    test("rewriting the prose without the other languages is refused", async () => {
      const { status, body } = await patch("ankunft-in-bangkok", {
        content: "Ganz anders als gedacht.",
      });
      expect(status).toBe(400);
      expect(body.problems?.some((p) => p.field === "translations")).toBe(true);
    });

    test("changing a coordinate needs no translations", async () => {
      const { status } = await patch("ankunft-in-bangkok", { lat: 13.75, lng: 100.5 });
      expect(status).toBe(200);
      const entry = getEntryBySlug("viki/asien", "ankunft-in-bangkok", { includeDrafts: true });
      // And the translations already there are untouched by an edit that did
      // not name them.
      expect(entry?.translations?.hu?.content).toBe(OTHERS.hu.content);
      expect(entry?.lat).toBe(13.75);
    });

    test("rewriting the prose in every language at once is accepted", async () => {
      const { status } = await patch("ankunft-in-bangkok", {
        content: "Ganz anders als gedacht.",
        translations: {
          en: { title: OTHERS.en.title, content: "Not at all what we expected." },
          hu: { title: OTHERS.hu.title, content: "Egészen máshogy alakult." },
        },
      });
      expect(status).toBe(200);
      const entry = getEntryBySlug("viki/asien", "ankunft-in-bangkok", { includeDrafts: true });
      expect(entry?.content).toContain("Ganz anders");
      expect(entry?.translations?.en?.content).toBe("Not at all what we expected.");
    });

    test("a hand-written comment survives an edit that replaces the block", async () => {
      const file = path.join(
        dir,
        "viki",
        "trips",
        "asien",
        "entries",
        "2026-09-01-ankunft-in-bangkok.md",
      );
      const original = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, original.replace("---\n", "---\n# written on the train\n"));

      const { status } = await patch("ankunft-in-bangkok", {
        content: "Neu.",
        translations: {
          en: { title: "New", content: "New." },
          hu: { title: "Új", content: "Új." },
        },
      });
      expect(status).toBe(200);
      const after = fs.readFileSync(file, "utf8");
      expect(after).toContain("# written on the train");
      // And the file still parses, which a mangled block scalar would not.
      expect(matter(after).data.translations.en.content).toBe("New.");
    });
  });
});

describe("a journal read in one language", () => {
  beforeEach(() => writeJournal(["de"], "de"));

  test("asks for no translations at all", async () => {
    const { status } = await post(GERMAN);
    expect(status).toBe(201);
  });

  test("still refuses one for a language it does not declare", async () => {
    const { status, body } = await post({ ...GERMAN, translations: { en: OTHERS.en } });
    expect(status).toBe(400);
    expect(body.problems?.some((p) => p.field === "translations.en")).toBe(true);
  });
});
