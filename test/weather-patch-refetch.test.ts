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
 * For a while that property had no v2 counterpart, because v2's write routes
 * fetched nothing at all: they refused `weather: true` when the capability
 * was off and otherwise banked it, and the only thing that ever serviced the
 * field was a nightly sweep off the backup timer. B1713 ended that — the
 * lookup happens in the write that asks for it — so B538's question is live
 * again and this file is where it is answered.
 *
 * The rule the tests below pin, and it is the whole of it: **a lookup happens
 * when the caller asks in that call, and never otherwise.**
 *
 * - a `PUT` carrying `weather: true` fetches once, and the day comes back
 *   with the reading in the same response;
 * - a later `PATCH` of the prose does not fetch, even though the day still
 *   asks — that is B538's exact complaint, and reading the *patch* rather
 *   than the merged document is what prevents it;
 * - a `PATCH` that itself carries `weather: true` fetches, because re-asking
 *   is how a day whose lookup came back empty gets a second attempt now that
 *   no sweep comes back for it;
 * - declining weather fetches nothing, ever.
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

async function putDay(overrides: Record<string, unknown>, ifMatch?: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const body = fullDayBody(overrides);
  const slug = String(body.slug);
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers({
        authorization: `Bearer ${await token()}`,
        ...(ifMatch ? { "if-match": ifMatch } : {}),
      }),
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

describe("v2's day route and weather (see the file comment: asked in this call, or not at all)", () => {
  /** One Open-Meteo answer, and a count of how often it was asked for. */
  function archive() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-08-26"],
          temperature_2m_min: [18.4],
          temperature_2m_max: [31.2],
          weathercode: [2],
          precipitation_sum: [0],
          windspeed_10m_max: [9.1],
        },
      }),
    } as unknown as Response);
  }

  test("a PUT that asks for weather is answered with the reading, in the same response", async () => {
    const fetchSpy = archive();

    const created = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: true,
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The echo carries it, which is the point of B1713: a caller learns what
    // happened to the field it asked about, in the answer to its own write.
    const weather = created.body.weather as Record<string, unknown>;
    expect(weather, JSON.stringify(created.body)).toMatchObject({ source: "open-meteo", tempMax: 31.2 });

    // B538: correcting the prose afterwards asks for nothing. The day's
    // `weather` is a reading now, and even if it were not, this patch does
    // not mention weather.
    const corrected = await patchDay("2026-08-26-hoi-an", { content: "Erster Tag, korrigiert." }, created.etag ?? undefined);
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a day the archive cannot answer for is not re-fetched by an unrelated correction, and is by asking again", async () => {
    // No `daily` at all: `fetchDayWeather` reads this as no answer, and the
    // day keeps a bare `weather: true`.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response);

    const created = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: true,
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.weather).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Ten corrections to a typo, none of them about weather — B538's own
    // scenario, and the one this file exists for.
    let etag = created.etag ?? undefined;
    for (let i = 0; i < 3; i += 1) {
      const edit = await patchDay("2026-08-26-hoi-an", { content: `Erster Tag, Fassung ${i}.` }, etag);
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      etag = edit.etag ?? undefined;
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Asking again is how a caller retries, now that nothing sweeps.
    const reasked = await patchDay("2026-08-26-hoi-an", { weather: true }, etag);
    expect(reasked.status, JSON.stringify(reasked.body)).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  /**
   * B1732 — the day the server wrote, written back.
   *
   * The folder a client keeps is a mirror of the instance, so the ordinary
   * correction is: read the day, change one field, send it back. What comes
   * back from a `GET` carries the reading the server looked up, sourced
   * `open-meteo` — a source the write shapes refuse by name, and rightly, for
   * a caller CLAIMING it. Echoing it is not claiming it, and refusing the echo
   * made every day the server has weather for uncorrectable: 36 of the demo
   * journal's 44, all 47 of the first real migration's.
   */
  test("a day's own stored reading can be sent straight back, by PATCH and by PUT", async () => {
    const fetchSpy = archive();
    const created = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: true,
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const stored = created.body.weather as Record<string, unknown>;
    expect(stored, JSON.stringify(created.body)).toMatchObject({ source: "open-meteo" });

    // The correction a person actually makes: the whole document back, one
    // field different, the reading untouched.
    const corrected = await patchDay(
      "2026-08-26-hoi-an",
      { content: "Erster Tag, korrigiert.", weather: stored },
      created.etag ?? undefined,
    );
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.weather).toMatchObject({ source: "open-meteo", tempMax: 31.2 });
    // Echoing is not asking: no second lookup happened.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const replaced = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: stored,
      content: "Erster Tag, ganz neu geschrieben.",
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    }, corrected.etag ?? undefined);
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.weather).toMatchObject({ source: "open-meteo" });
  });

  test("but a CHANGED reading claiming the server's own source is still refused", async () => {
    archive();
    const created = await putDay({
      coordinates: { lat: 15.88, lng: 108.34 },
      weather: true,
      declined: { ...fullDayBody().declined, coordinates: undefined, weather: undefined },
    });
    const stored = created.body.weather as Record<string, unknown>;

    const lied = await patchDay(
      "2026-08-26-hoi-an",
      { weather: { ...stored, tempMax: 44.4 } },
      created.etag ?? undefined,
    );
    expect(lied.status, JSON.stringify(lied.body)).toBe(400);
    expect(JSON.stringify(lied.body)).toContain("a caller may never claim it");
  });

  test("declining weather is accepted even with the capability on, and still never fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);

    const created = await putDay({ declined: { ...fullDayBody().declined, weather: "weather was not asked for this day" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
