import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
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
 * B538 was: `fillDayWeatherQuietly` ran after every v1 `PATCH`,
 * unconditionally, so a day the archive had no answer for re-fetched on
 * every subsequent edit — ten corrections to a typo made ten requests to
 * open-meteo.com for edits that never came near the weather.
 *
 * That property has no v2 counterpart to repoint onto, because the
 * mechanism it protected against is not there to protect against: v2's
 * `PUT`/`PATCH .../days/{slug}` (`app/api/v2/.../days/[slug]/route.ts`)
 * calls `weatherOffRefusal` (refusing `weather: true` outright when the
 * capability is off — B1617, this migration's own finding) and nothing
 * else weather-shaped. Neither route imports or calls
 * `fillDayWeatherQuietly`/`fillDayWeather` at all — a grep of
 * `app/api/v2/` turns up zero callers. The synchronous lookup-on-write
 * B538 was about fetching too eagerly simply is not wired into the v2 REST
 * write path; `npm run weather:update`'s nightly sweep (AGENTS.md) is the
 * only place a v2-native day's weather is ever actually looked up.
 *
 * Whether that is the intended shape of v2 (kill the on-write fetch,
 * uniformly defer to the batch job — consistent with the v2 design note
 * that duplicated, ad-hoc triggers are the thing being killed) or a gap
 * nobody has filed is a question for a person, not this repoint: it is
 * called out in B1617's own "Work" section ("which other capabilities does
 * a v2 route fail to check") without naming this one specifically. What is
 * tested below is the actual, current, honest behaviour — a v2 write never
 * calls `fetch` for weather, on create or on correction — rather than
 * B538's original claim, which presupposes a fetch this route does not
 * make.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP_ID = "alps";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.12.${calls % 250}`, ...extra };
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
    title: "Alps",
    dates: { from: "2026-08-20", to: "2026-09-10" },
    visibility: "private",
    people: [{ name: "A B", email: OWNER_EMAIL }],
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

function fullDayBody(overrides: Record<string, unknown> = {}): Record<string, unknown> & { declined: Record<string, unknown> } {
  return {
    slug: "2026-08-26-hoi-an",
    title: "Hoi An",
    date: "2026-08-26",
    content: "Erster Tag.",
    status: "draft",
    declined: {
      media: "no photographs attached to this day yet",
      costs: "nothing spent today, tracked elsewhere",
      coordinates: "no position recorded for this day",
      time: "the exact time of day was not recorded",
      timezone: "no timezone established for this leg",
      location: "no specific location named for this day",
      country: "no country named for this day entry",
      countryCode: "no country code named for this day",
      transportMode: "no transport leg happened this day",
      tags: "no tags applied to this day",
      translations: "single-language journal, nothing to translate",
      visibility: "no narrower visibility set for this day",
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

async function putDay(overrides: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const body = fullDayBody(overrides);
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-weather-refetch-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "weather-refetch-test-secret-b538";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, weather: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Ana",
    ownerEmail: OWNER_EMAIL,
    ownerName: "A B",
    ownerNickname: "A",
  });
  if (!created.ok) throw new Error(created.message);

  // The site switch alone is not enough — `isEnabled` also asks the
  // journal's own config, same as v1's fixture did.
  const userConfigPath = path.join(dir, OWNER, "config.json");
  const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8")) as Record<string, unknown>;
  userConfig.features = { ...(userConfig.features as object), weather: { enabled: true } };
  fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));
  clearUserCache();

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
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("v2's day route and weather (see the file comment: B538 has no v2 counterpart)", () => {
  test("a day asking for weather, with coordinates, is created and corrected without ever fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ daily: { time: ["2026-08-26"], temperature_2m_max: [null] } }),
    } as unknown as Response);

    const created = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: true,
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Unlike v1's create route, v2's PUT never calls `fillDayWeatherQuietly` —
    // asking for a lookup here is stored, not serviced.
    expect(fetchSpy).not.toHaveBeenCalled();

    await patchDay("2026-08-26-hoi-an", { content: "Erster Tag, korrigiert." }, created.etag ?? undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("declining weather is accepted even with the capability on, and still never fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);

    const created = await putDay({ declined: { ...fullDayBody().declined, weather: "weather was not asked for this day" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
