import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { POST as createDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { PATCH as editDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";

/**
 * B538 — a day the archive has no answer for re-fetches on every PATCH.
 *
 * `fillDayWeatherQuietly` ran after every `PATCH`, unconditionally. A day
 * that asked for weather, has coordinates, and got no answer from the
 * provider (a date the archive has no row for, a coordinate over open water,
 * an outage) never short-circuits on any of `fillDayWeather`'s four checks —
 * so it fetched again on every subsequent edit, for as long as the answer
 * stayed missing. An agent correcting a typo ten times made ten requests to
 * open-meteo.com for edits that never came near the weather.
 */

let dir: string;
const OWNER_EMAIL = "ana@example.test";

async function token(): Promise<string> {
  const { code } = await issueCode("ana", OWNER_EMAIL, "agent");
  const verified = await verifyCode("ana", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function trip() {
  return createTripRoute(
    new Request("https://t.test/api/v1/ana/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "alps", title: "Alps", start: "2026-08-20", end: "2026-09-10" }),
    }),
    { params: Promise.resolve({ user: "ana" }) },
  );
}

async function day(body: unknown) {
  const response = await createDayRoute(
    new Request("https://t.test/api/v1/ana/trips/alps/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "ana", trip: "alps" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function patch(slug: string, body: unknown) {
  const response = await editDayRoute(
    new Request(`https://t.test/api/v1/ana/trips/alps/days/${slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "ana", trip: "alps", slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Ana",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { weather: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await trip();
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

test("a PATCH touching only unrelated fields does not re-fetch weather the provider has already answered nothing for", async () => {
  // The provider answers nothing, for every call — the "no row yet" shape.
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ daily: { time: ["2026-08-26"], temperature_2m_max: [null] } }),
  } as unknown as Response);

  const created = await day({
    title: "Hoi An",
    date: "2026-08-26",
    content: "Erster Tag.",
    lat: 15.88,
    lng: 108.34,
    weather: true,
    costs: false,
  });
  expect(created.status).toBe(201);
  const slug = created.body.slug as string;

  // The create call itself fetches once (no_answer) — this is the ticket's
  // baseline, not the thing under test.
  const fetchSpy = vi.mocked(globalThis.fetch);
  expect(fetchSpy).toHaveBeenCalledTimes(1);

  // Two PATCHes, neither naming weather, lat, lng or date.
  await patch(slug, { content: "Erster Tag, korrigiert." });
  await patch(slug, { content: "Erster Tag, nochmals korrigiert." });

  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("a PATCH that adds coordinates to a day asking for weather still fetches", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ daily: { time: ["2026-08-26"], temperature_2m_max: [null] } }),
  } as unknown as Response);

  const created = await day({
    title: "Hoi An",
    date: "2026-08-26",
    content: "Erster Tag.",
    weather: true,
    costs: false,
    coordinates: false,
  });
  expect(created.status).toBe(201);
  const slug = created.body.slug as string;

  const fetchSpy = vi.mocked(globalThis.fetch);
  // No coordinates yet — the create call cannot fetch at all.
  expect(fetchSpy).not.toHaveBeenCalled();

  await patch(slug, { lat: 15.88, lng: 108.34 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
