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

async function putDay(
  tripId: string,
  slug: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string } = {},
) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "PUT",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchDay(tripId: string, slug: string, body: unknown, token: string | undefined) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PATCH(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${tripId}/days/${slug}`, {
      method: "PATCH",
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

/** Same door, but the intent NAMES a day instead of declining it — B1685: a
 * photograph uploaded this way must land in that day's own `media` too, not
 * merely on disk. Returns the full upload response and status, since a test
 * of this needs both. */
async function uploadPhotoNamingDay(
  tripId: string,
  slug: string,
  shade: number,
  token: string | undefined,
  caption = "the harbour at dawn",
) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const form = new FormData();
  form.set("intent", JSON.stringify({ kind: "photo", trip: tripId, day: slug, caption }));
  form.set("file", new File([new Uint8Array(await jpeg(shade))], "q.jpg", { type: "image/jpeg" }));
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: formHeaders(token ? { authorization: `Bearer ${token}` } : {}),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function listMedia(tripId: string, token: string | undefined) {
  const { GET } = await import("@/app/api/v2/[user]/media/route");
  const url = new URL(`https://example.test/api/v2/${OWNER}/media`);
  url.searchParams.set("trip", tripId);
  const response = await GET(
    new Request(url, { headers: headers(token ? { authorization: `Bearer ${token}` } : {}) }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
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

/**
 * What the day says the item *is* — B1885.
 *
 * `toStoredMedia` gave every src new to a day `type: "image"`, the
 * placeholder for "nothing here can measure real bytes". For a clip that was
 * simply wrong: `storeTripPhoto` had just transcoded it and written
 * `<hash>.mp4`, and the day recorded an image — so `components/Gallery.tsx`,
 * which switches on `type`, drew an `<img src="....mp4">`, and every reader
 * that picks "a photograph" off a day (the photobook, a postcard, the Open
 * Graph image, the day letter) could pick the clip.
 *
 * The extension is the measurement here: it is `.mp4` because this server
 * transcoded it to one, and `contentTypeFor` (lib/media.ts) is already the
 * one place that says which extensions are video.
 */
describe("what a day records a clip as — B1885", () => {
  test("a clip attached to a day is recorded as a video, and a photograph as an image", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-07-the-pass", dayBody("2026-06-07-the-pass"), token);

    // The bytes a v2 upload would have left behind, without needing ffmpeg on
    // the machine running the tests: the derivative and the poster beside it.
    const folder = path.join(dir, OWNER, "trips", TRIP_ID, "media", "2026-06-07-the-pass");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "clip.mp4"), Buffer.from([0x00, 0x00, 0x00, 0x18]));
    fs.writeFileSync(path.join(folder, "clip-poster.jpg"), await jpeg(120));
    const clipSrc = `/media/${TRIP_ID}/2026-06-07-the-pass/clip.mp4`;

    const photoSrc = await uploadPhoto(TRIP_ID, 70, token);
    const attached = await attach(TRIP_ID, "2026-06-07-the-pass", [{ src: clipSrc }, { src: photoSrc }], token);
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);

    const { readDayFile } = await import("@/lib/api/v2/store");
    const stored = readDayFile(OWNER, TRIP_ID, "2026-06-07-the-pass");
    const byType = Object.fromEntries((stored?.media ?? []).map((m) => [m.src, m.type]));
    expect(byType[clipSrc]).toBe("video");
    expect(byType[photoSrc]).toBe("image");
  });

  /**
   * And the reader draws it as one. `posterFor` (lib/entries.ts, B1876)
   * supplies the still frame the day document does not name, so the gallery
   * item a page renders is a video with a poster.
   */
  test("the gallery item the page renders is a video with its poster", async () => {
    const { clearMatterCache, getEntryBySlug, AS_AUTHOR } = await import("@/lib/entries");
    clearMatterCache();
    const entry = getEntryBySlug(`${OWNER}/${TRIP_ID}`, "the-pass", AS_AUTHOR);
    const clip = entry?.gallery.find((g) => g.src.endsWith("clip.mp4"));
    expect(clip?.type).toBe("video");
    expect(clip?.poster).toBe(`/${OWNER}/media/${TRIP_ID}/2026-06-07-the-pass/clip-poster.jpg`);
  });
});

describe("POST /api/v2/{user}/media naming a day — B1685", () => {
  test("attaches the photograph to that day, and retracts declined.media", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-05-lanterns", dayBody("2026-06-05-lanterns"), token);

    const { status, body: uploaded } = await uploadPhotoNamingDay(TRIP_ID, "2026-06-05-lanterns", 33, token);
    expect(status, JSON.stringify(uploaded)).toBe(201);
    const src = String(uploaded.src);

    // It is there, not merely accepted (B540/B1685) — a fresh GET agrees.
    const { body: day } = await getDay(TRIP_ID, "2026-06-05-lanterns", token);
    expect((day.media as { src: string }[] | undefined)?.map((m) => m.src)).toContain(src);
    expect((day.declined as Record<string, string> | undefined)?.media).toBeUndefined();
  });

  test("a day this trip has never heard of is unknown_day, and nothing is written", async () => {
    const token = await ownerToken();
    const { status, body } = await uploadPhotoNamingDay(TRIP_ID, "2026-06-05-no-such-day", 44, token);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe("unknown_day");
  });
});

describe("GET /api/v2/{user}/media — one caption, not two answers — B1868", () => {
  test("captioning a photo on its day changes what the trip's media list answers with too", async () => {
    const token = await ownerToken();
    await putDay(TRIP_ID, "2026-06-08-caption", dayBody("2026-06-08-caption"), token);

    // Uploaded naming the day — the upload's own caption is "arriving",
    // the intake door's answer, stored on the sidecar.
    const { status: uploadStatus, body: uploaded } = await uploadPhotoNamingDay(
      TRIP_ID,
      "2026-06-08-caption",
      80,
      token,
      "arriving",
    );
    expect(uploadStatus, JSON.stringify(uploaded)).toBe(201);
    const src = String(uploaded.src);

    // ...then re-captioned through the day itself, the only door a person
    // actually edits through (attach is retry-safe and leaves an already-
    // attached src alone, by design — see the test above).
    const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
    const patched = await PATCH(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/2026-06-08-caption`, {
        method: "PATCH",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify({ media: [{ src, caption: "the harbour at dawn" }] }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug: "2026-06-08-caption" }) },
    );
    expect(patched.status, JSON.stringify(await patched.clone().json())).toBe(200);

    const { body: day } = await getDay(TRIP_ID, "2026-06-08-caption", token);
    expect((day.media as { src: string; caption?: string }[])[0].caption).toBe("the harbour at dawn");

    // The trip's media list is the second door named in the ticket — it must
    // agree with the day, not the sidecar's stale upload-time answer.
    const { body: list } = await listMedia(TRIP_ID, token);
    const item = (list.items as { src: string; caption?: string }[]).find((i) => i.src === src);
    expect(item?.caption).toBe("the harbour at dawn");
  });

  test("a day-less photograph's caption still answers from the upload — no day exists to own it", async () => {
    const token = await ownerToken();
    const src = await uploadPhoto(TRIP_ID, 95, token);

    const { body: list } = await listMedia(TRIP_ID, token);
    const item = (list.items as { src: string; caption?: string }[]).find((i) => i.src === src);
    // `uploadPhoto` declines a caption for this test — absent either way,
    // proving the sidecar (not a day that does not exist) is still the door.
    expect(item?.caption).toBeUndefined();
  });
});

/**
 * B1976 — a day-less upload later attached to a day was never moved onto
 * that day's own subfolder, so `listTripMediaV2`'s disk walk kept answering
 * `day: undefined` for it forever, and B1868's caption fix (which only reads
 * a day's own caption once `day` is set) could never find it either.
 *
 * The fix re-points the record instead of moving bytes: `listTripMediaV2`
 * now also asks every day document which `src`s it owns, rather than only
 * trusting which folder the bytes happen to sit in. The print master is the
 * proof this was the right call — it is asserted byte-identical before and
 * after, because nothing about attach touches it either way.
 */
describe("GET /api/v2/{user}/media — a day-less upload attached later — B1976", () => {
  test("answers that day, reads its caption from the day document, and leaves the original untouched", async () => {
    const token = await ownerToken();

    // Day-less first — this is the broken case: bytes land at the trip's
    // media root, not any day's subfolder.
    const src = await uploadPhoto(TRIP_ID, 111, token);
    const relPath = src.slice(`/media/${TRIP_ID}/`.length);
    const originalPath = path.join(dir, OWNER, "trips", TRIP_ID, "originals", relPath);
    const derivativePath = path.join(dir, OWNER, "trips", TRIP_ID, "media", relPath);
    const originalBefore = fs.readFileSync(originalPath);

    // Confirms the premise before touching anything: freshly uploaded and
    // day-less, this trip's own media list agrees it has no day.
    const { body: beforeList } = await listMedia(TRIP_ID, token);
    const beforeItem = (beforeList.items as { src: string; day?: string }[]).find((i) => i.src === src);
    expect(beforeItem?.day).toBeUndefined();

    await putDay(TRIP_ID, "2026-06-09-later", dayBody("2026-06-09-later"), token);
    const attached = await attach(TRIP_ID, "2026-06-09-later", [{ src, caption: "found this one later" }], token);
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);

    // Acceptance line 1: a subsequent GET answers that day.
    const { body: list } = await listMedia(TRIP_ID, token);
    const item = (list.items as { src: string; day?: string; caption?: string }[]).find((i) => i.src === src);
    expect(item?.day).toBe("2026-06-09-later");

    // Acceptance line 2: its caption comes from the day's own document, not
    // the (nonexistent, for this test) sidecar caption.
    expect(item?.caption).toBe("found this one later");

    // The chosen fix re-points the record; it never moves bytes. The
    // derivative is still exactly where the day-less upload put it, not
    // inside the day's own subfolder.
    expect(fs.existsSync(derivativePath)).toBe(true);

    // Acceptance line 3 (the print master): byte-identical before and after.
    const originalAfter = fs.readFileSync(originalPath);
    expect(originalAfter.equals(originalBefore)).toBe(true);
  });
});

/**
 * B2244 — `media[].from` (B527, disk-only, the name a photograph had before
 * it was renamed at upload) survived nowhere: `toStoredMedia`
 * (lib/api/v2/days.ts) carried over `type`/`width`/`height`/`poster` from
 * the stored item on every rewrite, but not `from`, and `applyDayPatch`
 * (the PATCH route below) runs it on every PATCH whether or not `media`
 * was in the body. `from` is never on the wire (`dayMediaItem` is a
 * `strictObject` without it — a client cannot set or read it through this
 * door), so the only way to see it is `readDayFile` straight off disk,
 * which is what B527's own readers (lib/entries.ts, describe-photos, the
 * media route) do too.
 */
describe("PATCH .../days/{slug} — media[].from survives every rewrite — B2244", () => {
  const SLUG = "2026-06-10-from-survives";

  async function seedDayWithFrom(token: string): Promise<{ keptSrc: string; removedSrc: string }> {
    await putDay(TRIP_ID, SLUG, dayBody(SLUG), token);
    const keptSrc = await uploadPhoto(TRIP_ID, 30, token);
    const removedSrc = await uploadPhoto(TRIP_ID, 40, token);
    const attached = await attach(TRIP_ID, SLUG, [{ src: keptSrc }, { src: removedSrc }], token);
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);

    // `from` is disk-only and never wire-settable — planted the only way it
    // can genuinely arrive: as if the upload had renamed these two files.
    const { readDayFile, writeDayFile } = await import("@/lib/api/v2/store");
    const stored = readDayFile(OWNER, TRIP_ID, SLUG);
    if (!stored?.media) throw new Error("expected media on the seeded day");
    const media = stored.media.map((m) =>
      m.src === keptSrc ? { ...m, from: "IMG_0030.jpg" } : { ...m, from: "IMG_0040.jpg" },
    );
    writeDayFile(OWNER, TRIP_ID, SLUG, { ...stored, media });
    return { keptSrc, removedSrc };
  }

  test("a title-only PATCH keeps media[].from byte-identical", async () => {
    const token = await ownerToken();
    const { keptSrc, removedSrc } = await seedDayWithFrom(token);
    const { readDayFile } = await import("@/lib/api/v2/store");
    const before = readDayFile(OWNER, TRIP_ID, SLUG);

    const patched = await patchDay(TRIP_ID, SLUG, { title: "A renamed title" }, token);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const after = readDayFile(OWNER, TRIP_ID, SLUG);
    expect(after?.title).toBe("A renamed title");
    expect(after?.media).toEqual(before?.media);
    expect(after?.media?.find((m) => m.src === keptSrc)?.from).toBe("IMG_0030.jpg");
    expect(after?.media?.find((m) => m.src === removedSrc)?.from).toBe("IMG_0040.jpg");
  });

  test("a caption-only PATCH keeps every photo's from, including the one not captioned", async () => {
    const token = await ownerToken();
    const { keptSrc, removedSrc } = await seedDayWithFrom(token);

    const patched = await patchDay(
      TRIP_ID,
      SLUG,
      { media: [{ src: keptSrc, caption: "a caption" }, { src: removedSrc }] },
      token,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const { readDayFile } = await import("@/lib/api/v2/store");
    const after = readDayFile(OWNER, TRIP_ID, SLUG);
    expect(after?.media?.find((m) => m.src === keptSrc)?.from).toBe("IMG_0030.jpg");
    expect(after?.media?.find((m) => m.src === removedSrc)?.from).toBe("IMG_0040.jpg");
  });

  test("removing one photo (DELETE .../media) leaves the remaining photo's from untouched", async () => {
    const token = await ownerToken();
    const { keptSrc, removedSrc } = await seedDayWithFrom(token);

    const removed = await detach(TRIP_ID, SLUG, [removedSrc], token);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    const { readDayFile } = await import("@/lib/api/v2/store");
    const after = readDayFile(OWNER, TRIP_ID, SLUG);
    expect(after?.media?.map((m) => m.src)).toEqual([keptSrc]);
    expect(after?.media?.[0]?.from).toBe("IMG_0030.jpg");
  });

  test("PUT (full replace) keeps from too, same toStoredMedia call", async () => {
    const token = await ownerToken();
    const { keptSrc, removedSrc } = await seedDayWithFrom(token);
    const { body: before, etag } = await getDay(TRIP_ID, SLUG, token);
    const { declined, ...rest } = dayBody(SLUG);
    const { media: _mediaDecline, ...otherDeclines } = declined as Record<string, string>;

    const putBody = { ...rest, declined: otherDeclines, title: "Rewritten wholesale", media: before.media };
    const put = await putDay(TRIP_ID, SLUG, putBody, token, { ifMatch: etag ?? undefined });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const { readDayFile } = await import("@/lib/api/v2/store");
    const after = readDayFile(OWNER, TRIP_ID, SLUG);
    expect(after?.media?.find((m) => m.src === keptSrc)?.from).toBe("IMG_0030.jpg");
    expect(after?.media?.find((m) => m.src === removedSrc)?.from).toBe("IMG_0040.jpg");
  });
});
