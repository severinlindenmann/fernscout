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
 * C7's weather clause, widened — `test/studio-add-day.test.ts`'s own C7
 * describe block already proves the title and prose halves ("an empty
 * title stays absent", "an empty body is NO_PROSE"); this is the missing
 * third, "no composed weather".
 *
 * `fillDayWeatherQuietly` is mocked so the claim under test is about
 * `createDayTransactional` itself, not about whether a real weather lookup
 * succeeds (that belongs to `lib/api/weather.ts`'s own tests). What this
 * checks is the one thing C7 actually asks: when weather is declined,
 * nothing here invents a reading; when it is requested, this function
 * writes only the pending marker (`weather: true`) and hands the real
 * answer to the existing lookup rather than composing one itself.
 */

const fillDayWeatherQuietly = vi.fn(async (_ref: string, _slug: string) => undefined);
vi.mock("@/lib/api/weather", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/weather")>();
  return { ...actual, fillDayWeatherQuietly };
});

const { createDayTransactional } = await import("@/lib/studio/createDay");
const { readDayFile } = await import("@/lib/api/v2/store");
const { NO_PROSE } = await import("@/lib/helper/draft");

const OWNER = "alex";
const TRIP_ID = "reise";
let dir: string;

beforeEach(async () => {
  fillDayWeatherQuietly.mockClear();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-add-day-weather-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "studio-add-day-weather-test-secret-b1938";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
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

describe("createDayTransactional — C7, no invented content anywhere in the write", () => {
  /**
   * The whole claim, in one day: title, prose and weather all left
   * unanswered, and nothing about any of the three is invented to fill the
   * gap. `test/studio-add-day.test.ts`'s own C7 block already proves the
   * title and prose halves in isolation; this is the manifest's single
   * proof, so it repeats both alongside the weather half this file adds,
   * rather than the claim resting on a test in a different file the
   * manifest cannot name at the same time.
   */
  test("an empty title, an empty body and declined weather: nothing composed for any of them", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-20",
      title: "",
      content: "",
      declined: { weather: "nobody looked at the sky that day" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.title).toBe("");
    expect(stored?.content).toBe(NO_PROSE);
    expect(stored?.weather).toBeUndefined();
    expect(stored?.declined?.weather).toBe("nobody looked at the sky that day");
    expect(fillDayWeatherQuietly).not.toHaveBeenCalled();
  });
});

describe("createDayTransactional — C7, weather is never composed", () => {
  test("declined weather: no weather field at all, and the lookup is never called", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-18",
      title: "A day with no weather said",
      content: "Something happened.",
      declined: { weather: "nobody looked at the sky that day" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.weather).toBeUndefined();
    expect(stored?.declined?.weather).toBe("nobody looked at the sky that day");
    expect(fillDayWeatherQuietly).not.toHaveBeenCalled();
  });

  test("requested weather: the stored day carries only the pending marker, never a composed reading", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-19",
      title: "A day the weather was asked for",
      content: "Something happened.",
      weather: true,
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    // Read back *before* the mocked lookup could ever supply a real
    // reading — `createDayTransactional` awaits it, so this is the value
    // this function itself is capable of writing: `true`, never an object
    // with invented temperature or conditions in it.
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.weather).toBe(true);
    // The real lookup is delegated to, exactly once, with this day named —
    // not answered here. The second argument is the day's *bare* slug
    // (`written.slug`, before the date prefix `v2Slug` adds to `result.slug`
    // for storage), so this checks the ref and that the full stored slug is
    // that bare slug with today's date in front of it, rather than coupling
    // to the exact title-derived string.
    expect(fillDayWeatherQuietly).toHaveBeenCalledTimes(1);
    const call = fillDayWeatherQuietly.mock.calls[0];
    expect(call[0]).toBe(`${OWNER}/${TRIP_ID}`);
    expect(result.slug).toBe(`2025-11-19-${call[1]}`);
  });
});
