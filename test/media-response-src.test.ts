import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { paintJpeg } from "./support/pictures";

/**
 * B540 — the upload response's own `src` did not match what reading the day
 * back gave for the same photograph. `storeUploads` (v1, `lib/api/media.ts`)
 * kept `src` trip-relative on purpose (portable across a copy to another
 * journal), but the route handed that same trip-relative value back in the
 * JSON response while a day, read back, gave the owner-prefixed form
 * (`mediaWithOwner`, lib/trips.ts). An agent told to correct a caption keyed
 * by `src` could never match the two.
 *
 * This file was deleted during the v2 migration (B1613) on the judgement
 * that it was "wholly about the deleted route's v1-only semantics". That was
 * wrong: `mediaItem.src` (lib/api/v2/schemas/media.ts) is now a content hash
 * that days reference by exact string, so "what the upload said" and "what a
 * reader gets" being the same claim matters *more* in v2, not less. Do not
 * delete this again — repoint it at whatever the media/day contract becomes
 * instead.
 *
 * v2 closes the loop differently than v1 did, and by construction rather
 * than by a read-time transform: `storeMediaV2` and `listTripMediaV2`
 * (lib/api/v2/media.ts) both derive `src` from the same `frontmatterSrc()`
 * call, and a v2 day document is defined (lib/api/v2/schemas/day.ts,
 * `dayMediaItem`) to store and echo that exact string back unchanged — its
 * own doc comment names "the B540 distinction" and says a day's `media` read
 * only ever *adds* a `url` field alongside the untouched `src`, rather than
 * re-deriving it the way v1's `mediaWithOwner` did. So there is no separate
 * owner-prefixing step left to drift out of sync with the write path.
 *
 * The v2 day routes now exist in this worktree, and — since B1685 — naming a
 * day in the upload `intent` attaches the photograph to it, which means the
 * day has to actually exist first (`attachDayMedia`, lib/api/v2/days.ts).
 * `DAY`/`SECOND_DAY` below are real day documents created in `beforeAll` for
 * exactly that reason, not merely directory names.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const DAY = "2026-01-02-lanterns-of-hoi-an";
const SECOND_DAY = "2026-01-03-second-day";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.4.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function postFile(token: string, filename: string, bytes: Buffer, day: string) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const form = new FormData();
  form.set(
    "intent",
    JSON.stringify({ kind: "photo", trip: TRIP, day, declined: { caption: "no caption for this test" } }),
  );
  form.set("file", new File([new Uint8Array(bytes)], filename, { type: "image/jpeg" }));
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function dayBody(slug: string): Record<string, unknown> {
  return {
    slug,
    title: "A day",
    date: slug.slice(0, 10),
    content: "Something happened.",
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
  };
}

async function putDay(slug: string, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}/days/${slug}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(dayBody(slug)),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP, slug }) },
  );
  if (response.status !== 201) throw new Error(`putDay(${slug}) failed: ${JSON.stringify(await response.json())}`);
}

async function getMedia(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/media/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/media?trip=${TRIP}`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as { items: { src: string; day?: string }[] } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-src-v2-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  delete process.env.MEDIA_ORIGINALS_DIR;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  const { createTrip } = await import("@/lib/tripWrite");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);

  const trip = createTrip(OWNER, {
    id: TRIP,
    title: "Asia",
    start: "2026-01-01",
    end: "2026-01-10",
    visibility: "private",
  });
  if (!trip.ok) throw new Error(trip.message);

  const token = await ownerToken();
  await putDay(DAY, token);
  await putDay(SECOND_DAY, token);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the upload response's src", () => {
  test("is the same string this door's own GET answers for the same photograph", async () => {
    const token = await ownerToken();
    const bytes = await paintJpeg(400, 300);
    const { status, body } = await postFile(token, "a.jpg", bytes, DAY);
    expect(status, JSON.stringify(body)).toBe(201);

    const list = await getMedia(token);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const match = list.body.items.find((item) => item.day === DAY);
    expect(match).toBeDefined();

    // The whole point: the write path and the read path of this one door
    // must agree, byte for byte, on the id a caller correlates by.
    expect(match!.src).toBe(body.src);
  });

  test("is the trip-relative frontmatter form, unprefixed by owner — the exact string a v2 day is defined to store and echo back untouched", async () => {
    const token = await ownerToken();
    const bytes = await paintJpeg(410, 310);
    const { status, body } = await postFile(token, "b.jpg", bytes, SECOND_DAY);
    expect(status, JSON.stringify(body)).toBe(201);

    // frontmatterSrc(tripId, relPath) — see lib/ingest/paths.ts. Not
    // `/${OWNER}/media/...`: v2 deliberately leaves the owner prefix off
    // `src` and carries it only in the separate, browser-facing `url` field
    // instead, so there is no read-time rewrite of `src` left to drift.
    expect(body.src).toMatch(new RegExp(`^/media/${TRIP}/${SECOND_DAY}/[0-9a-f]+\\.jpg$`));
    expect(typeof body.url).toBe("string");
    expect(body.url).toBe(`/${OWNER}${body.src}`);
  });
});
