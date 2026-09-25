import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { attachGallery } from "@/lib/api/entries";
import { getEntryBySlug, AS_AUTHOR } from "@/lib/entries";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1564 — `attach_files` (and every other caller of `attachGallery`) filled
 * a day's gallery without retracting a stale `declined.media`, so a day
 * could say both "here are the photos" and "nobody knows whether there were
 * any" at once. `appendGallery` (lib/ingest/entry.ts) and v2's
 * `attachDayMedia` (lib/api/v2/days.ts) already retract it; this is the same
 * rule applied to v1's `attachGallery`.
 */

const OWNER = "ana";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";
const REF = `${OWNER}/${TRIP}`;

let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-attach-gallery-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.MEDIA_ORIGINALS_DIR;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "ana@example.test" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "A trip",
    start: "2026-01-01",
    end: "2026-01-05",
    status: "past",
    visibility: "private",
  });

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("attachGallery retracts a stale declined.media once a photograph arrives", () => {
  writeDayFixture(dir, OWNER, TRIP, {
    slug: DAY,
    date: "2026-01-02",
    status: "draft",
    declined: { media: "nobody knows whether there were photos" },
  });

  const result = attachGallery(REF, DAY, [
    { src: `${TRIP}/entries/${DAY}/01.jpg`, type: "image", width: 10, height: 10 },
  ]);
  expect(result.ok).toBe(true);

  const entry = getEntryBySlug(REF, DAY, AS_AUTHOR);
  expect(entry?.gallery.length).toBe(1);
  // The old failure: this stayed "photos" even though the gallery was full.
  expect(entry?.unrecorded).not.toContain("photos");
  expect(entry?.without).not.toContain("photos");
});
