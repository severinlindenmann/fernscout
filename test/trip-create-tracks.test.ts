import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

/**
 * B540 — `tracks` reaches `createTrip` (lib/tripWrite.ts) and it wires the
 * block through correctly, but the route that turns a request body into a
 * `NewTrip` never read `body.tracks` at all: every other raw block field
 * (`people`, `travellers`, `rates`, `translations`) was forwarded and this one
 * was silently dropped, so a trip created with every track turned off came
 * back tracking everything anyway.
 *
 * B1612 repoint: v1's trip-wide `tracks: {costs, coordinates, photos}` is
 * retired. The property underneath — "a trip states what it keeps track of,
 * and a day that says nothing about a tracked fact is refused" — survives,
 * but the mechanism moved from the trip (one on/off switch for every day) to
 * each day's own `declined` map (`DAY_DECLINABLES`,
 * `lib/api/v2/schemas/day.ts`): a day silently missing `costs`, `coordinates`
 * or `media` answers `422 incomplete`, and a day that explicitly declines
 * them is created with those declines on record — the same two facts B540's
 * ticket cared about, asked per day rather than once for the whole trip.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

function fullTrip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex", email: OWNER_EMAIL }],
    teaser: true,
    declined: {
      rates: "no foreign currency tracked on this trip at all",
      costs: "no budget tracked for this trip currently",
      plan: "no planned route recorded for this trip",
      days: "no days written for this trip at create time",
      translations: "single-language journal, nothing to translate",
      accent: "default accent left as the renderer's choice",
      figures: "no walking figures drawn for this trip",
      tagline: "no one-line subtitle written for this trip",
      intro: "no opening prose written for this trip yet",
      buddies: "travelling solo, nobody else was on this trip",
    },
    ...overrides,
  };
}

function fullDayBody(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: "Erster Tag",
    date: slug.slice(0, 10),
    content: "Ankunft am Morgen.",
    status: "draft",
    declined: {
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
      translations: "single-language journal, nothing to translate",
      visibility: "no narrower visibility set for this day",
    },
    ...overrides,
  };
}

async function putTrip(body: unknown) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function putDay(slug: string, body: unknown) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}/days/${slug}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-tracks-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "trip-tracks-test-secret-b540";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
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

describe("a day silently missing what a trip used to switch off wholesale", () => {
  test("a day that declines media/costs/coordinates is created with those declines stored", async () => {
    const created = await putTrip(fullTrip());
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const day = await putDay("2026-09-01-arrival", fullDayBody("2026-09-01-arrival"));
    expect(day.status, JSON.stringify(day.body)).toBe(201);
    const declined = day.body.declined as Record<string, string>;
    expect(declined.media).toBeTruthy();
    expect(declined.costs).toBeTruthy();
    expect(declined.coordinates).toBeTruthy();
  });

  test("a day silently missing costs/coordinates/media (declining neither) is refused, not defaulted to tracking everything", async () => {
    const created = await putTrip(fullTrip());
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const { costs: _c, coordinates: _co, media: _m, ...rest } = fullDayBody("2026-09-02-quiet").declined as Record<string, string>;
    const day = await putDay("2026-09-02-quiet", { ...fullDayBody("2026-09-02-quiet"), declined: rest });
    expect(day.status, JSON.stringify(day.body)).toBe(422);
    expect(day.body.error).toBe("incomplete");
    const missing = ((day.body.details as { missing?: { field: string }[] })?.missing ?? []).map((m) => m.field);
    expect(missing.sort()).toEqual(["coordinates", "costs", "media"]);
  });
});
