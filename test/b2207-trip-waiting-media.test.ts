import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { attachTripWaitingMedia, buildInboxHubModel, inboxSummary, tripWaitingGroups } from "@/lib/studio/inbox";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { tripRef } from "@/lib/trips";

/**
 * B2207 — a photograph filed onto a trip with a declined day
 * (`storeTripPhoto`, `lib/api/v2/media.ts`, `day` left undefined) writes
 * directly under `trips/<id>/media/`, one level above where a day's own
 * photographs live (`trips/<id>/media/<day>/`). Nothing in
 * `lib/studio/inbox.ts` read that root before this ticket, so the file sat
 * on disk, referenced by no day, and showed up nowhere in the studio.
 *
 * This drives `lib/studio/inbox.ts` directly against a plain file dropped in
 * that root — proving the listing and the attach action need no real image
 * decode (`storeTripPhoto`'s own concern, exercised elsewhere) to be
 * correct.
 */

let dir: string;
const USER = "b2207trav";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2207-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, USER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USER, "config.json"),
    JSON.stringify({
      title: "B2207 traveller",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "b2207@example.test" },
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
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A day-less trip photo the way `storeTripPhoto` leaves one — a derivative
 *  directly under the trip's `media/` root, no day subfolder. The bytes
 *  themselves are never decoded by anything under test here, so a short
 *  placeholder is enough. */
function dropWaitingPhoto(tripId: string, filename: string, bytes = "not a real jpeg"): void {
  const mediaDir = path.join(dir, USER, "trips", tripId, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, filename), bytes);
}

describe("a day-less trip photo is waiting, not invisible", () => {
  test("tripWaitingGroups finds it, and stops once a day names it", () => {
    writeTripFixture(USER, { id: "kyoto-2026", start: "2026-04-01", end: "2026-04-10" });
    dropWaitingPhoto("kyoto-2026", "abc123.jpg");

    const before = tripWaitingGroups(USER);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ tripId: "kyoto-2026", tripTitle: "kyoto-2026" });
    expect(before[0].rows).toHaveLength(1);
    expect(before[0].rows[0]).toMatchObject({ id: "abc123.jpg", day: null, trip: "kyoto-2026", type: "photo" });
    // No day to move it onto yet.
    expect(before[0].days).toEqual([]);

    writeDayFixture(dir, USER, "kyoto-2026", { slug: "arrival", date: "2026-04-01", title: "Arrival" });

    // Still waiting: a day exists now, but nothing in its gallery names the
    // file yet.
    const withDay = tripWaitingGroups(USER);
    expect(withDay[0].rows).toHaveLength(1);
    expect(withDay[0].days).toEqual([{ slug: "arrival", date: "2026-04-01", title: "Arrival" }]);

    const attached = attachTripWaitingMedia(USER, "kyoto-2026", "abc123.jpg", "arrival");
    expect(attached).toMatchObject({ ok: true, attached: 1 });

    // Gone from "waiting" — a day's gallery names it now.
    expect(tripWaitingGroups(USER)).toEqual([]);

    const entry = getEntryBySlug(tripRef(USER, "kyoto-2026"), "arrival", AS_AUTHOR);
    // `mediaWithOwner` prefixes the owner onto `frontmatterSrc`'s bare
    // `/media/<trip>/<file>` at read time (lib/entries.ts).
    expect(entry?.gallery[0]?.src).toBe(`/@${USER}/media/kyoto-2026/abc123.jpg`);
  });

  test("a poster frame and a sidecar are never rows of their own", () => {
    writeTripFixture(USER, { id: "video-trip", start: "2026-05-01", end: "2026-05-05" });
    dropWaitingPhoto("video-trip", "def456.mp4");
    dropWaitingPhoto("video-trip", "def456-poster.jpg");
    dropWaitingPhoto("video-trip", "def456.mp4.meta.json", "{}");

    const groups = tripWaitingGroups(USER);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["def456.mp4"]);
    expect(groups[0].rows[0].type).toBe("video");
  });

  test("a day's own photograph (already inside a day subfolder) is not double-counted", () => {
    writeTripFixture(USER, { id: "with-day-photo", start: "2026-06-01", end: "2026-06-05" });
    // A day's own photo lives one level deeper — the trip media root itself
    // stays empty, so nothing here should ever appear as "waiting".
    const dayDir = path.join(dir, USER, "trips", "with-day-photo", "media", "2026-06-01-first");
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(path.join(dayDir, "already-filed.jpg"), "bytes");

    expect(tripWaitingGroups(USER)).toEqual([]);
  });

  test("the hub count includes what is waiting on a trip", () => {
    writeTripFixture(USER, { id: "counted-2026", start: "2026-07-01", end: "2026-07-05" });
    const before = inboxSummary(USER);
    dropWaitingPhoto("counted-2026", "ghi789.jpg", "twelve bytes!");
    const after = inboxSummary(USER);
    expect(after.count).toBe(before.count + 1);
    expect(after.bytes).toBe(before.bytes + "twelve bytes!".length);

    const model = buildInboxHubModel(USER);
    expect(model.tripWaiting).toHaveLength(1);
    expect(model.tripWaiting[0].rows[0].id).toBe("ghi789.jpg");
  });

  test("attach refuses an unknown trip, an unknown file, and a file already attached", () => {
    writeTripFixture(USER, { id: "refusals-2026", start: "2026-08-01", end: "2026-08-05" });
    writeDayFixture(dir, USER, "refusals-2026", { slug: "day-one", date: "2026-08-01", title: "Day one" });
    dropWaitingPhoto("refusals-2026", "jkl012.jpg");

    expect(attachTripWaitingMedia(USER, "no-such-trip", "jkl012.jpg", "day-one")).toMatchObject({
      ok: false,
      error: "unknown_trip",
    });
    expect(attachTripWaitingMedia(USER, "refusals-2026", "missing.jpg", "day-one")).toMatchObject({
      ok: false,
      error: "unknown_file",
    });
    // A traversal attempt resolves to a basename that does not exist here.
    expect(attachTripWaitingMedia(USER, "refusals-2026", "../../../etc/passwd", "day-one")).toMatchObject({
      ok: false,
      error: "unknown_file",
    });

    const first = attachTripWaitingMedia(USER, "refusals-2026", "jkl012.jpg", "day-one");
    expect(first.ok).toBe(true);
    const second = attachTripWaitingMedia(USER, "refusals-2026", "jkl012.jpg", "day-one");
    expect(second).toMatchObject({ ok: false, error: "already_attached" });
  });
});
