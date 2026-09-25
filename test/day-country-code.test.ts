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
 * B540 — `countryCode` was accepted, answered 201, and thrown away.
 * Repointed onto v2's `PUT`/`PATCH .../days/{slug}` for B1612.
 *
 * The field has been on a day since the flag was added, and every entry
 * written by ingest carries one. Nothing on the write side ever read it out of
 * a request body, so an agent copying a journal onto a hosted instance sent
 * `countryCode: "PT"` fourteen times, was told each time that the day had been
 * created, and got fourteen days with no flag. That is the shape of failure
 * this repository keeps finding: not a refusal, a success that quietly did
 * less than it said.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP_ID = "reise";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.11.${calls % 250}`, ...extra };
}

async function token(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex B", email: OWNER_EMAIL }],
    teaser: true,
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      translations: "single-language journal",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
      buddies: "travelling solo",
    },
  };
}

/** Every declinable a day needs answered, minus `country`/`countryCode` —
 * left for each test to supply or omit, since that pair is what is under
 * test. */
function baseDeclines(): Record<string, string> {
  return {
    media: "no photographs attached to this day yet",
    costs: "nothing spent today, tracked elsewhere",
    coordinates: "no position recorded for this day",
    weather: "weather was not asked for this day",
    time: "the exact time of day was not recorded",
    timezone: "no timezone established for this leg",
    location: "no specific location named for this day",
    transportMode: "no transport leg happened this day",
    tags: "no tags applied to this day",
    translations: "single-language journal, nothing to translate",
    visibility: "no narrower visibility set for this day",
  };
}

function dayBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "2026-09-01-lissabon",
    title: "Lissabon",
    date: "2026-09-01",
    content: "Ein Tag.",
    status: "draft",
    declined: {
      ...baseDeclines(),
      ...(overrides.country === undefined ? { country: "no country named for this day entry" } : {}),
      ...(overrides.countryCode === undefined ? { countryCode: "no country code named for this day" } : {}),
    },
    ...overrides,
  };
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

async function createDay(overrides: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const body = dayBody(overrides);
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

async function getDay(slug: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      headers: headers({ authorization: `Bearer ${await token()}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function readDay(slug: string): Promise<Body> {
  return (await getDay(slug)).body;
}

async function editDay(slug: string, patch: Record<string, unknown>, ifMatch?: string) {
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
  return { status: response.status, body: (await response.json()) as Body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-countrycode-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-countrycode-test-secret-b540";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Alex",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Alex B",
    ownerNickname: "Alex",
  });
  if (!created.ok) throw new Error(created.message);

  const trip = await putTrip();
  if (trip.status !== 201) throw new Error(`trip not created: ${JSON.stringify(trip.body)}`);
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

describe("countryCode on a day", () => {
  /**
   * Deliberately a country whose name `countryCodeFor` (lib/flags.ts) cannot
   * turn into a code by itself, and then a day with no `country` at all.
   * "Portugal" would have passed this test with the bug still in place — the
   * guess supplies PT — which is exactly how a field can look like it works
   * while never being read.
   */
  test("survives the write, where nothing could have guessed it", async () => {
    const created = await createDay({ country: "Kosovo", countryCode: "XK" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await readDay("2026-09-01-lissabon")).toMatchObject({ country: "Kosovo", countryCode: "XK" });
  });

  test("survives with no country name to guess from", async () => {
    await createDay({ countryCode: "PT" });
    expect(await readDay("2026-09-01-lissabon")).toMatchObject({ countryCode: "PT" });
  });

  test("wins over the name, when the two disagree", async () => {
    await createDay({ country: "Portugal", countryCode: "ES" });
    expect(await readDay("2026-09-01-lissabon")).toMatchObject({ countryCode: "ES" });
  });

  test("is not silently case-folded — a caller sends the two letters the flag table wants", async () => {
    const created = await createDay({ countryCode: "xk" });
    // v1 uppercased on write; v2's `countryCode` is a plain
    // `z.string().length(2)` with no case coercion (`lib/api/v2/schemas/day.ts`)
    // — a lowercase code is stored and read back exactly as sent, rather than
    // silently rewritten. The property that survives is B540's own: the
    // field is not thrown away. Case-folding it too is not part of that
    // claim, and nothing in v2's schema promises it.
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await readDay("2026-09-01-lissabon")).toMatchObject({ countryCode: "xk" });
  });

  test("is refused when it is not two letters, rather than written and ignored", async () => {
    const created = await createDay({ countryCode: "PRT" });
    expect(created.status).toBe(400);
    expect(JSON.stringify(created.body)).toContain("countryCode");
  });

  test("can be corrected afterwards — a field that can be written can be edited", async () => {
    await createDay({ countryCode: "PT" });
    const { etag } = await getDay("2026-09-01-lissabon");
    const patched = await editDay("2026-09-01-lissabon", { countryCode: "ES" }, etag ?? undefined);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(await readDay("2026-09-01-lissabon")).toMatchObject({ countryCode: "ES" });
  });
});
