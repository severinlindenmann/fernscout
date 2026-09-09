import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { attachGallery } from "@/lib/api/entries";
import { storeUploads } from "@/lib/api/media";

/**
 * B1103 — a trip could hold the same photograph twice and nothing could say
 * so. The upload path already warns as a likeness arrives and stores it
 * anyway; this is the question asked afterwards, of a journal nobody here
 * uploaded.
 *
 * The fixtures are the real-world shape rather than a convenient one: a full
 * size camera-ish file, the same picture as it comes back off a messaging app
 * — smaller, re-encoded — and the same picture again stored sideways with an
 * EXIF orientation tag. That last one is the trap the ticket was written
 * around: compare the pixels without applying the tag and the two are
 * unrelated images.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const REF = `${OWNER}/${TRIP}`;

let dir: string;
const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

/** A picture with structure along both axes — a difference hash has nothing
 *  to say about flat colour, and correctly refuses to call two blank frames
 *  the same photograph (see `hasSignal` in lib/ingest/hash.ts). */
function pattern(w: number, h: number, seed: number): Buffer {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            128 +
              60 * Math.sin(Math.PI * (x / w) + seed) +
              50 * Math.cos(Math.PI * (y / h) * (1 + (seed % 3) / 2) + seed * 1.7),
          ),
        ),
      );
      const i = (y * w + x) * 3;
      raw[i] = v;
      raw[i + 1] = 255 - v;
      raw[i + 2] = (v + 60) % 256;
    }
  }
  return raw;
}

const source = (w: number, h: number, seed: number) =>
  sharp(pattern(w, h, seed), { raw: { width: w, height: h, channels: 3 } });

async function duplicates(token: string) {
  const { GET } = await import("@/app/api/v1/[user]/trips/[trip]/media/duplicates/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/media/duplicates`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function day(slug: string, uploads: { filename: string; bytes: Buffer }[]) {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `2026-01-01-${slug}.md`),
    ["---", `title: "${slug}"`, 'date: "2026-01-01"', "status: draft", "---", "", "Words.", ""].join("\n"),
  );
  const uploaded = await storeUploads(REF, slug, uploads);
  if (!uploaded.ok) throw new Error("expected the upload to land");
  const attached = attachGallery(REF, slug, uploaded.items);
  if (!attached.ok) throw new Error("expected the gallery attach to land");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-duplicates-"));
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
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.mkdirSync(path.join(dir, OWNER, "trips", "elsewhere", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );
  for (const [id, where] of [
    [TRIP, tripPath()],
    ["elsewhere", path.join(dir, OWNER, "trips", "elsewhere")],
  ] as const) {
    fs.writeFileSync(
      path.join(where, "trip.md"),
      [
        "---",
        `id: "${id}"`,
        'title: "A trip"',
        'start: "2026-01-01"',
        'end: "2026-01-05"',
        'status: "past"',
        'visibility: "private"',
        "---",
        "",
        "Intro.",
        "",
      ].join("\n"),
    );
  }

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const gone of ["media", "originals", ".fingerprints"]) {
    fs.rmSync(path.join(tripPath(), gone), { recursive: true, force: true });
  }
  for (const file of fs.readdirSync(path.join(tripPath(), "entries"))) {
    fs.rmSync(path.join(tripPath(), "entries", file));
  }
});

describe("GET /api/v1/<user>/trips/<trip>/media/duplicates", () => {
  test("groups a photograph with its smaller re-encoded copy, largest first", async () => {
    await day("lanterns", [
      { filename: "camera.jpg", bytes: await source(1200, 900, 1).jpeg({ quality: 92 }).toBuffer() },
      { filename: "messaged.jpg", bytes: await source(1200, 900, 1).resize(600, 450).jpeg({ quality: 75 }).toBuffer() },
    ]);

    const { status, body } = await duplicates(await ownerToken());
    expect(status).toBe(200);
    const groups = body.groups as { src: string; day: string; bytes: number }[][];
    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.src)).toEqual([
      `/${OWNER}/media/${TRIP}/lanterns/01.jpg`,
      `/${OWNER}/media/${TRIP}/lanterns/02.jpg`,
    ]);
    expect(groups[0][0].bytes).toBeGreaterThan(groups[0][1].bytes);
    expect(groups[0][0].day).toBe("lanterns");
  });

  test("the same picture stored sideways with an EXIF orientation tag still groups", async () => {
    await day("lanterns", [
      { filename: "upright.jpg", bytes: await source(1200, 900, 1).jpeg({ quality: 92 }).toBuffer() },
      {
        filename: "sideways.jpg",
        bytes: await source(1200, 900, 1)
          .rotate(90)
          .withMetadata({ orientation: 8 })
          .jpeg({ quality: 80 })
          .toBuffer(),
      },
    ]);

    const groups = (await duplicates(await ownerToken())).body.groups as unknown[][];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  test("two different photographs, on one day or across two, are not a group", async () => {
    await day("lanterns", [
      { filename: "a.jpg", bytes: await source(1200, 900, 1).jpeg().toBuffer() },
      { filename: "b.jpg", bytes: await source(1200, 900, 2).jpeg().toBuffer() },
    ]);
    await day("market", [{ filename: "c.jpg", bytes: await source(1200, 900, 5).jpeg().toBuffer() }]);

    const { body } = await duplicates(await ownerToken());
    expect(body.groups).toEqual([]);
    expect(body.note).toContain("No photograph");
  });

  test("the same picture on two different days is one group", async () => {
    const bytes = await source(1200, 900, 1).jpeg({ quality: 92 }).toBuffer();
    await day("lanterns", [{ filename: "a.jpg", bytes }]);
    await day("market", [{ filename: "a.jpg", bytes }]);

    const groups = (await duplicates(await ownerToken())).body.groups as { day: string }[][];
    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.day).sort()).toEqual(["lanterns", "market"]);
  });

  test("a trip-scoped token for a different trip cannot read this one", async () => {
    await day("lanterns", [{ filename: "a.jpg", bytes: await source(1200, 900, 1).jpeg().toBuffer() }]);
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, "buddy@example.test", "agent", { trip: `${OWNER}/elsewhere` });
    const scoped = await verifyCode(OWNER, "buddy@example.test", code, "agent");
    if (!scoped.ok) throw new Error("no scoped token");

    // The same answer `mayWriteTrip` gives any trip a scoped token does not
    // name: unknown_trip, so a probe cannot tell "wrong trip" from "no such
    // trip".
    expect((await duplicates(scoped.token)).status).toBe(404);
  });
});
