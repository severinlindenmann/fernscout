import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeTripFixture } from "./fixtures/content";

/**
 * B2640, follow-up — the studio's own "add a day" door
 * (`createDayTransactional`, behind `POST /api/helper/[user]/day/new`,
 * `components/studio/day/AddDayFlow.tsx`'s own write) carries a position but
 * never calls `reversePlace` itself: the place on the card came from a
 * photograph's EXIF, a route-recording suggestion, or a typed name. So the
 * region a reverse-geocode lookup would answer (Photon's own `state`) never
 * reached a day written this way, even on an instance with `addressLookup`
 * on — this is the gap the API-door route already closed for its own flow
 * (`app/api/helper/[user]/day/route.ts`), now closed here too.
 *
 * `reversePlace` is mocked the same way `test/studio-add-day-c7-weather.test.ts`
 * mocks `fillDayWeatherQuietly` — the claim under test is that
 * `createDayTransactional` asks for a region and writes what it is told,
 * never that a real Photon lookup succeeds (that is `lib/addressLookup.ts`'s
 * own test).
 */

const reversePlace = vi.fn(
  async (_lat: number, _lng: number, _locale: string) =>
    null as { location: string; country: string; countryCode: string; region?: string } | null,
);
vi.mock("@/lib/addressLookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/addressLookup")>();
  return { ...actual, reversePlace };
});

const { createDayTransactional } = await import("@/lib/studio/createDay");
const { readDayFile } = await import("@/lib/api/v2/store");

const OWNER = "alex";
const TRIP_ID = "reise";
let dir: string;

beforeEach(async () => {
  reversePlace.mockClear();
  reversePlace.mockResolvedValue(null);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-add-day-region-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "studio-add-day-region-test-secret-b2640";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      // addressLookup is OPERATOR_ONLY_FEATURES (B1666) — only this server
      // config's own flag matters, never a journal's.
      features: { auth: { enabled: true }, addressLookup: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  writeTripFixture(OWNER, {
    id: TRIP_ID,
    title: "Reise",
    start: "2025-11-01",
    end: "2025-11-30",
    status: "current",
    visibility: "public",
  });
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

describe("createDayTransactional — region, serviced quietly like weather", () => {
  test("a position and addressLookup on: the region a reverse-geocode answers lands on the day", async () => {
    reversePlace.mockResolvedValue({ location: "Zürich", country: "Switzerland", countryCode: "CH", region: "Zürich" });

    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-20",
      title: "A day with a position",
      content: "Something happened.",
      location: "Zürich",
      country: "Switzerland",
      lat: 47.3769,
      lng: 8.5417,
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");

    expect(reversePlace).toHaveBeenCalledWith(47.3769, 8.5417, "en");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.region).toBe("Zürich");
  });

  test("no position: the lookup is never called, and no region is written", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-21",
      title: "A day with no position",
      content: "Something happened.",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");

    expect(reversePlace).not.toHaveBeenCalled();
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.region).toBeUndefined();
  });

  test("the lookup answers with nothing: the day keeps no region, never a guess", async () => {
    reversePlace.mockResolvedValue({ location: "Somewhere", country: "Nowhere", countryCode: "XX" });

    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-22",
      title: "A day the lookup could not name a region for",
      content: "Something happened.",
      lat: 1,
      lng: 1,
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");

    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.region).toBeUndefined();
  });

  test("a caller that already named a region is trusted — the lookup is never asked", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-23",
      title: "A day whose region is already known",
      content: "Something happened.",
      lat: 47.3769,
      lng: 8.5417,
      region: "Zürich",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");

    expect(reversePlace).not.toHaveBeenCalled();
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.region).toBe("Zürich");
  });
});
