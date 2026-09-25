import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeTripFixture } from "./fixtures/content";
import { offlineKeepTrips } from "@/lib/studio/day";

/**
 * B2330 wave 2, D6 — `offlineKeepTrips` names the two trips the studio keeps
 * on the phone by itself: the current one and the soonest upcoming one.
 * Dates are computed from `Date.now()` rather than hard-coded, since a
 * trip's status is a calendar fact derived at read time (`lib/trips.ts`'s
 * own `deriveStatus`) — a fixed date would drift stale the day this test
 * outlives it.
 */
const OWNER = "keepy";

let dir: string;

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-offline-keep-trips-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "studio-offline-keep-trips-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Keepy",
      tagline: "t",
      owner: { name: "K", nickname: "K", email: "keepy@example.test" },
      defaultLocale: "en",
      locales: ["en"],
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

describe("offlineKeepTrips", () => {
  test("names the current trip and the soonest upcoming one, ignoring a past trip and a later upcoming one", () => {
    writeTripFixture(OWNER, { id: "old-trip", title: "Old", start: iso(-30), end: iso(-20) });
    writeTripFixture(OWNER, { id: "this-trip", title: "This", start: iso(-2), end: iso(3) });
    writeTripFixture(OWNER, { id: "far-trip", title: "Far", start: iso(60), end: iso(70) });
    writeTripFixture(OWNER, { id: "soon-trip", title: "Soon", start: iso(10), end: iso(20) });

    expect(offlineKeepTrips(OWNER)).toEqual({ current: "this-trip", nextPlanned: "soon-trip" });
  });

  test("either can be absent — a journal with nothing current, or nothing upcoming", () => {
    writeTripFixture(OWNER, { id: "old-trip", title: "Old", start: iso(-30), end: iso(-20) });
    expect(offlineKeepTrips(OWNER)).toEqual({ current: undefined, nextPlanned: undefined });

    writeTripFixture(OWNER, { id: "soon-trip", title: "Soon", start: iso(10), end: iso(20) });
    expect(offlineKeepTrips(OWNER)).toEqual({ current: undefined, nextPlanned: "soon-trip" });
  });
});
