import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * `GET/POST/DELETE /api/v2/{user}/media` — B1613, phase 2 step 3, parcel C.
 *
 * End to end against a real temp content dir and a real sqlite db, the same
 * shape `test/api-v2-journal.test.ts` uses: real sessions minted through
 * `lib/auth`, real route handlers called directly.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const OTHER_TRIP = "europe-2027";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.11.3.${calls % 250}`, ...extra };
}

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number, shade = 140): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: shade } } })
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

/** A token scoped to a trip other than the one being written to. */
async function otherTripToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, "buddy@example.test", "agent", { trip: `${OWNER}/${OTHER_TRIP}` });
  const result = await verifyCode(OWNER, "buddy@example.test", code, "agent");
  if (!result.ok) throw new Error("no scoped token");
  return result.token;
}

type MediaBody = Record<string, unknown> & { error?: string; message?: string };

async function postMultipart(
  token: string | undefined,
  intent: unknown,
  file: { name: string; bytes: Buffer; type?: string },
  opts: { dryRun?: boolean } = {},
) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const form = new FormData();
  form.set("intent", JSON.stringify(intent));
  form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "image/jpeg" }));
  const url = new URL(`https://example.test/api/v2/${OWNER}/media`);
  if (opts.dryRun !== undefined) url.searchParams.set("dryRun", String(opts.dryRun));
  const response = await POST(
    new Request(url, {
      method: "POST",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as MediaBody };
}

async function getMedia(token: string | undefined, query: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/v2/[user]/media/route");
  const url = new URL(`https://example.test/api/v2/${OWNER}/media`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await GET(
    new Request(url, { headers: headers(token ? { authorization: `Bearer ${token}` } : {}) }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as MediaBody };
}

async function deleteMedia(token: string | undefined, src: string) {
  const { DELETE } = await import("@/app/api/v2/[user]/media/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "DELETE",
      headers: headers({ "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }),
      body: JSON.stringify({ src }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as MediaBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-media-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "44".repeat(32);
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

  for (const id of [TRIP, OTHER_TRIP]) {
    const trip = createTrip(OWNER, {
      id,
      title: "A trip",
      start: "2026-01-01",
      end: "2026-01-10",
      visibility: "private",
    });
    if (!trip.ok) throw new Error(trip.message);
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

describe("POST — the same bytes twice", () => {
  test("gives the same src and reports duplicateOf on the second call", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(800, 600);

    const first = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "n/a for this test" } },
      { name: "a.jpg", bytes },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.duplicateOf).toBeUndefined();

    const second = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "n/a for this test" } },
      { name: "a-again.jpg", bytes },
    );
    expect(second.status).toBe(201);
    expect(second.body.src).toBe(first.body.src);
    expect(second.body.duplicateOf).toBe(first.body.src);
  });
});

describe("POST — the server's own copy, sent back", () => {
  /**
   * B1790. A folder synced down holds what the site *serves*, not what was
   * uploaded, and publishing that folder sends the derivative back. Its bytes
   * are not the original's bytes, so it hashes to a new address — and the
   * same photograph used to be stored twice, the day re-pointed at the second
   * copy, and the first left with nothing naming it. On one real journal that
   * was 18 photographs, and the orphan was the copy holding the untouched
   * original, so tidying them away cost the print masters.
   */
  const mediaRoot = () => path.join(tripPath(), "media");

  test("answers with the photograph it already holds, and stores nothing new", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(900, 700, 200);
    const intent = { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "n/a for this test" } };

    const first = await postMultipart(token, intent, { name: "camera-original.jpg", bytes });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const stored = String(first.body.src).split("/").pop() as string;

    // What the site serves is not the file that was sent — which is the whole
    // reason this case exists.
    const served = fs.readFileSync(path.join(mediaRoot(), stored));
    expect(served.equals(bytes)).toBe(false);

    const before = fs.readdirSync(mediaRoot()).sort();
    const again = await postMultipart(token, intent, { name: stored, bytes: served });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.src).toBe(first.body.src);
    expect(again.body.duplicateOf).toBe(first.body.src);
    expect(fs.readdirSync(mediaRoot()).sort()).toEqual(before);
  });

  test("a genuinely different photograph is still stored", async () => {
    const token = await ownerToken();
    const intent = { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "n/a for this test" } };

    const one = await postMultipart(token, intent, { name: "one.jpg", bytes: await jpeg(640, 480, 17) });
    const two = await postMultipart(token, intent, { name: "two.jpg", bytes: await jpeg(640, 480, 211) });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(two.body.src).not.toBe(one.body.src);
    expect(two.body.duplicateOf).toBeUndefined();
  });
});

describe("POST — a day-less trip-scoped upload", () => {
  test("lands directly in the trip's media, with no day", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(500, 500, 30);

    const { status, body } = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "sorting later", caption: "no caption for this test" } },
      { name: "loose.jpg", bytes },
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.day).toBeUndefined();
    expect(body.trip).toBe(TRIP);

    // On disk directly under media/, not inside a day subfolder.
    const root = path.join(tripPath(), "media");
    const direct = fs.readdirSync(root).filter((f) => !fs.statSync(path.join(root, f)).isDirectory());
    expect(direct.some((f) => f.endsWith(".jpg"))).toBe(true);

    // A day can reference it afterwards by exactly this src — this route
    // never writes into a day document itself (that is the day route's job);
    // it only guarantees the address is real and stable.
    expect(typeof body.src).toBe("string");
  });
});

describe("POST — a stray field is refused, not ignored", () => {
  test("day sent with bank_export is refused", async () => {
    const token = await ownerToken();
    const { status, body } = await postMultipart(
      token,
      { kind: "bank_export", trip: TRIP, day: "day-one", declined: { format: "let the server detect it" } },
      { name: "statement.csv", bytes: Buffer.from("date,amount\n"), type: "text/csv" },
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("bank_export declining trip and format lands in the flat inbox, unparsed", async () => {
    const token = await ownerToken();
    const { status, body } = await postMultipart(
      token,
      { kind: "bank_export", declined: { trip: "spans the whole year", format: "let the server detect it" } },
      { name: "statement.csv", bytes: Buffer.from("date,amount\n2026-01-01,12.50\n"), type: "text/csv" },
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.kind).toBe("bank_export");
    expect(String(body.src)).toMatch(/^inbox:/);
  });
});

describe("POST — the original survives untouched, beside the derivative", () => {
  test("both files exist, and the original is byte-identical to what was sent", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(1600, 1200, 200);

    const { status, body } = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "no caption for this test" } },
      { name: "big.jpg", bytes },
    );
    expect(status, JSON.stringify(body)).toBe(201);

    const src = String(body.src);
    const relPath = src.replace(/^\/media\/[^/]+\//, "");
    const derivative = path.join(tripPath(), "media", relPath);
    const original = path.join(tripPath(), "originals", relPath);

    expect(fs.existsSync(derivative)).toBe(true);
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.readFileSync(original).equals(bytes)).toBe(true);

    // The derivative is a real, decodable jpeg — not merely a second copy.
    const meta = await sharp(derivative).metadata();
    expect(meta.width).toBeGreaterThan(0);
  });
});

describe("DELETE — by src", () => {
  test("removes the stored bytes and their sidecar", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(300, 300, 90);
    const uploaded = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "no caption for this test" } },
      { name: "gone.jpg", bytes },
    );
    expect(uploaded.status).toBe(201);
    const src = String(uploaded.body.src);
    const relPath = src.replace(/^\/media\/[^/]+\//, "");
    const derivative = path.join(tripPath(), "media", relPath);
    const sidecar = path.join(tripPath(), "meta", `${relPath}.meta.json`);
    expect(fs.existsSync(derivative)).toBe(true);
    expect(fs.existsSync(sidecar)).toBe(true);

    const { status, body } = await deleteMedia(token, src);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(fs.existsSync(derivative)).toBe(false);
    // B1863: the sidecar lives in the trip's own `meta/`, a sibling of
    // `media/` no route can resolve — and never beside the derivative.
    expect(fs.existsSync(sidecar)).toBe(false);
    expect(fs.existsSync(`${derivative}.meta.json`)).toBe(false);
  });

  test("an unknown src is refused", async () => {
    const token = await ownerToken();
    const { status, body } = await deleteMedia(token, `/media/${TRIP}/no-such-day/deadbeef.jpg`);
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_media");
  });

  test("a src reaching for ../ outside the trip is refused, not resolved", async () => {
    const token = await ownerToken();
    // A sibling file outside the trip's own media directory — this must
    // survive untouched whatever the answer is.
    const outside = path.join(dir, OWNER, "trips", "canary.jpg");
    fs.writeFileSync(outside, "not touched");

    const { status, body } = await deleteMedia(token, `/media/${TRIP}/../canary.jpg`);
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_media");
    expect(fs.existsSync(outside)).toBe(true);
  });

  test("a trip-scoped token for a different trip cannot delete this trip's media", async () => {
    const owner = await ownerToken();
    const bytes = await jpeg(200, 200, 50);
    const uploaded = await postMultipart(
      owner,
      { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "no caption for this test" } },
      { name: "x.jpg", bytes },
    );
    const src = String(uploaded.body.src);

    const scoped = await otherTripToken();
    const { status } = await deleteMedia(scoped, src);
    // Same shape as every other trip-scoped-token-in-the-wrong-place refusal:
    // unknown, not forbidden, so a probe cannot tell "wrong trip" from
    // "no such trip".
    expect(status).toBe(404);
  });
});

describe("dryRun", () => {
  test("writes nothing", async () => {
    const token = await ownerToken();
    const bytes = await jpeg(700, 700, 10);
    const { status, body } = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, day: "dry-run-day", declined: { caption: "no caption for this test" } },
      { name: "preview.jpg", bytes },
      { dryRun: true },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(fs.existsSync(path.join(tripPath(), "media", "dry-run-day"))).toBe(false);
  });
});

describe("an over-limit upload", () => {
  test("is refused with body_too_large", async () => {
    const { POST } = await import("@/app/api/v2/[user]/media/route");
    const { REQUEST_MAX_BYTES } = await import("@/lib/validate/media");
    const token = await ownerToken();
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/media`, {
        method: "POST",
        headers: headers({
          authorization: `Bearer ${token}`,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(REQUEST_MAX_BYTES + 1),
        }),
        body: "not actually that big",
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const body = (await response.json()) as MediaBody;
    expect(response.status).toBe(413);
    expect(body.error).toBe("body_too_large");
  });
});

describe("GET — cursor paging", () => {
  test("pages through a trip's stored media", async () => {
    const token = await ownerToken();
    for (let i = 0; i < 3; i++) {
      const bytes = await jpeg(120 + i, 120 + i, 5 + i * 10);
      const res = await postMultipart(
        token,
        { kind: "photo", trip: TRIP, declined: { day: "not the point of this test", caption: "no caption for this test" } },
        { name: `p${i}.jpg`, bytes },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    const first = await getMedia(token, { trip: TRIP, limit: "2" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const firstItems = first.body.items as unknown[];
    expect(firstItems.length).toBe(2);
    expect(typeof first.body.next_cursor).toBe("string");

    const second = await getMedia(token, { trip: TRIP, limit: "2", cursor: String(first.body.next_cursor) });
    expect(second.status).toBe(200);
    const secondItems = second.body.items as unknown[];
    expect(secondItems.length).toBeGreaterThan(0);

    // No overlap between the two pages.
    const firstSrcs = new Set(firstItems.map((i) => (i as { src: string }).src));
    for (const item of secondItems) expect(firstSrcs.has((item as { src: string }).src)).toBe(false);
  });

  test("requires ?trip=", async () => {
    const token = await ownerToken();
    const { status, body } = await getMedia(token);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });
});

describe("who may reach it", () => {
  test("no token at all is 401", async () => {
    const { status } = await postMultipart(undefined, { kind: "photo", trip: TRIP, declined: { day: "no day for this test", caption: "no caption for this test" } }, {
      name: "x.jpg",
      bytes: await jpeg(50, 50),
    });
    expect(status).toBe(401);
  });

  test("a trip-scoped token for a different trip is refused as unknown_trip", async () => {
    const token = await otherTripToken();
    const { status, body } = await postMultipart(
      token,
      { kind: "photo", trip: TRIP, declined: { day: "no day for this test", caption: "no caption for this test" } },
      { name: "x.jpg", bytes: await jpeg(50, 50) },
    );
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_trip");
  });
});
