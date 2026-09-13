import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `POST/DELETE /api/v2/{user}/trips/{trip}/days/{slug}/media` — B1656.
 *
 * The gap this closes: `POST /api/v2/{user}/media` only ever places bytes,
 * never a `src` into a day's own `media` array. Same shape as
 * `test/api-v2-days.test.ts`: a real temp content dir, a real sqlite db,
 * real sessions minted through `lib/auth`, real route handlers called
 * directly.
 */

const OWNER = "priya";
const OWNER_EMAIL = "priya@example.test";
const TRIP_ID = "day-media-trip";
const OTHER_TRIP_ID = "other-trip";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.14.5.${calls % 250}`, ...extra };
}

/** No `content-type` default — a multipart body needs `fetch`/`FormData` to
 * set its own boundary, which an explicit `application/json` here would
 * stomp on (the media route reads this header to tell the two apart). */
function formHeaders(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.14.5.${calls % 250}`, ...extra };
}

async function jpeg(shade: number): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: shade, b: 40 } } })
    .jpeg()
    .toBuffer();
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function tripScopedToken(tripId: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
  if (!result.ok) throw new Error("no scoped token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(id: string): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-06-01", to: "2026-06-20" },
    visibility: "private",
    people: [{ name: "Priya Traveller", email: OWNER_EMAIL }],
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
  };
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

async function putDay(tripId: string, slug: string, body: unknown, token: string | undefined) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "PUT",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function getDay(tripId: string, slug: string, token?: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function uploadPhoto(tripId: string, shade: number, token: string | undefined) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const form = new FormData();
  form.set(
    "intent",
    JSON.stringify({
      kind: "photo",
      trip: tripId,
      declined: { day: "attached to a day separately, by this ticket's own door", caption: "no caption for this test" },
    }),
  );
  form.set("file", new File([new Uint8Array(await jpeg(shade))], "p.jpg", { type: "image/jpeg" }));
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: formHeaders(token ? { authorization: `Bearer ${token}` } : {}),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const body = (await response.json()) as Body;
  if (typeof body.src !== "string") throw new Error(`upload failed: ${JSON.stringify(body)}`);
  return body.src;
}

async function attach(
  tripId: string,
  slug: string,
  items: unknown[],
  token: string | undefined,
  opts: { ifMatch?: string } = {},
) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/media/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}/media`, {
      method: "POST",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify({ items }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function detach(
  tripId: string,
  slug: string,
  srcs: string[],
  token: string | undefined,
  opts: { ifMatch?: string } = {},
) {
  const { DELETE } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/media/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}/media`, {
      method: "DELETE",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify({ srcs }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-day-media-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
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
  const { writeTripFile } = await import("@/lib/api/v2/store");
  const { tripCreate } = await import("@/lib/api/v2/schemas");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Priya's Journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Priya Traveller",
    ownerNickname: "Priya",
  });
  if (!created.ok) throw new Error(created.message);

  for (const id of [TRIP_ID, OTHER_TRIP_ID]) {
    const parsed = tripCreate.parse(fullTrip(id));
    const { days: _ignored, ...tripFields } = parsed;
    writeTripFile(OWNER, id, tripFields);
  }
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST .../days/{slug}/media — attach", () => {
  test("attaches a stored photograph, and retracts a stale declined.media", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-01-arrival", dayBody("2026-06-01-arrival"), token);

    const src = await uploadPhoto(TRIP_ID, 60, token);
    const attached = await attach(TRIP_ID, "2026-06-01-arrival", [{ src, caption: "the harbour" }], token);
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    expect(attached.body.media).toEqual([{ src, caption: "the harbour", url: src }]);
    expect((attached.body.declined as Record<string, string> | undefined)?.media).toBeUndefined();

    // It is there, not merely accepted (B540) — a fresh GET agrees.
    const { body: fetched } = await getDay(TRIP_ID, "2026-06-01-arrival", token);
    expect(fetched.media).toEqual([{ src, caption: "the harbour", url: src }]);
  });

  test("a second attach of the same src changes nothing further (retry-safe)", async () => {
    const token = await ownerToken();
    const { body: before } = await getDay(TRIP_ID, "2026-06-01-arrival", token);
    const src = (before.media as { src: string }[])[0].src;

    const retried = await attach(TRIP_ID, "2026-06-01-arrival", [{ src, caption: "a different caption" }], token);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect((retried.body.media as unknown[]).length).toBe(1);
  });

  test("a src belonging to a different trip is refused, not written", async () => {
    const token = await ownerToken();
    await putDay(OTHER_TRIP_ID, "2026-07-01-elsewhere", dayBody("2026-07-01-elsewhere"), token);
    const foreignSrc = await uploadPhoto(OTHER_TRIP_ID, 90, token);

    const result = await attach(TRIP_ID, "2026-06-01-arrival", [{ src: foreignSrc }], token);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("not_this_trip");

    const { body: unchanged } = await getDay(TRIP_ID, "2026-06-01-arrival", token);
    expect((unchanged.media as unknown[]).length).toBe(1);
  });

  test("an inbox src (bytes never placed in a trip) is refused", async () => {
    const token = await ownerToken();
    const result = await attach(TRIP_ID, "2026-06-01-arrival", [{ src: "inbox:whatever" }], token);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("not_this_trip");
  });

  test("a stale If-Match is refused with the current document", async () => {
    const token = await ownerToken();
    const src = await uploadPhoto(TRIP_ID, 120, token);
    const result = await attach(TRIP_ID, "2026-06-01-arrival", [{ src }], token, { ifMatch: '"not-the-real-one"' });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("stale_document");
    expect((result.body.details as Body).title).toBe("A day");
  });

  test("a day this trip has never heard of is unknown_day", async () => {
    const token = await ownerToken();
    const src = await uploadPhoto(TRIP_ID, 150, token);
    const result = await attach(TRIP_ID, "2026-06-01-no-such-day", [{ src }], token);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("unknown_day");
  });

  test("a trip-scoped token may attach to its own trip", async () => {
    const token = await tripScopedToken(TRIP_ID);
    const owner = await ownerToken();
    const src = await uploadPhoto(TRIP_ID, 170, owner);
    const result = await attach(TRIP_ID, "2026-06-01-arrival", [{ src }], token);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  });

  test("a token scoped to a different trip is out_of_scope", async () => {
    const owner = await ownerToken();
    const scoped = await tripScopedToken(OTHER_TRIP_ID);
    const src = await uploadPhoto(TRIP_ID, 200, owner);
    const result = await attach(TRIP_ID, "2026-06-01-arrival", [{ src }], scoped);
    expect(result.status).toBe(404); // unknown_trip: a token may not even confirm this trip exists
  });
});

describe("DELETE .../days/{slug}/media — detach", () => {
  test("removes a src from the gallery, and leaves the bytes on disk", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-02-market", dayBody("2026-06-02-market"), token);
    const src = await uploadPhoto(TRIP_ID, 40, token);
    await attach(TRIP_ID, "2026-06-02-market", [{ src }], token);

    const removed = await detach(TRIP_ID, "2026-06-02-market", [src], token);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.media).toBeUndefined();

    // The file itself is untouched — detach is the reversible half.
    const { resolveMediaFile } = await import("@/lib/media");
    const segments = src.replace(/^.*\/media\//, "").split("/");
    expect(resolveMediaFile(OWNER, segments)).toBeTruthy();
  });

  test("a src this day does not have is unknown_media, and nothing is removed", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-03-rest", dayBody("2026-06-03-rest"), token);
    const src = await uploadPhoto(TRIP_ID, 210, token);
    await attach(TRIP_ID, "2026-06-03-rest", [{ src }], token);

    const result = await detach(TRIP_ID, "2026-06-03-rest", ["not-a-real-src"], token);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("unknown_media");

    const { body: unchanged } = await getDay(TRIP_ID, "2026-06-03-rest", token);
    expect((unchanged.media as unknown[]).length).toBe(1);
  });
});

describe("visibility — narrows only, and round-trips", () => {
  test("a private item's label survives attach, GET, and a further patch of unrelated fields", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-04-quiet", dayBody("2026-06-04-quiet"), token);
    const src = await uploadPhoto(TRIP_ID, 250, token);

    const attached = await attach(TRIP_ID, "2026-06-04-quiet", [{ src, visibility: "private" }], token);
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    expect((attached.body.media as { visibility?: string }[])[0].visibility).toBe("private");

    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const patched = await PATCH(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/2026-06-04-quiet`, {
        method: "PATCH",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify({ content: "Stayed in, mostly." }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug: "2026-06-04-quiet" }) },
    );
    const patchedBody = (await patched.json()) as Body;
    expect(patched.status, JSON.stringify(patchedBody)).toBe(200);
    expect((patchedBody.media as { visibility?: string }[])[0].visibility).toBe("private");
  });

  test("the wire schema has no way to write visibility: public — narrows only, never widens", async () => {
    const { dayMediaAttachRequest } = await import("@/lib/api/v2/schemas/dayMedia");
    const result = dayMediaAttachRequest.safeParse({ items: [{ src: "x", visibility: "public" }] });
    expect(result.success).toBe(false);
  });
});
