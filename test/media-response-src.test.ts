import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

/**
 * B540 — the upload response's own `src` did not match what reading the day
 * back gave for the same photograph.
 *
 * `storeUploads` (lib/api/media.ts) keeps `src` trip-relative — on purpose,
 * because that is what belongs in the entry's frontmatter, portable across a
 * copy to another journal (see `frontmatterSrc`'s own comment). But the route
 * handed that same trip-relative value straight back in the JSON response
 * too, and `/agent.md` tells an agent to correct captions **keyed by `src`**.
 * An agent that took the upload response at its word and later tried to
 * match a caption by `"/media/<trip>/<day>/01.jpg"` would never find it: the
 * day it reads back has `"/<user>/media/<trip>/<day>/01.jpg"`, via
 * `mediaWithOwner` (lib/trips.ts) at read time.
 *
 * This drives the real route handler, exactly as media-url-upload.test.ts
 * does, and compares the upload response's `src` against `getEntryBySlug`'s
 * gallery for the same file.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";

let dir: string;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
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

/** The multipart door, driven exactly as an agent's client library would. */
async function postFile(token: string, filename: string, bytes: Buffer) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/media/route");
  const form = new FormData();
  form.set("day", DAY);
  form.set("files", new File([new Uint8Array(bytes)], filename, { type: "image/jpeg" }));
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-src-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
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
  fs.writeFileSync(
    path.join(tripPath(), "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      'title: "Asia"',
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
  fs.writeFileSync(
    path.join(tripPath(), "entries", `2026-01-01-${DAY}.md`),
    [
      "---",
      `title: "${DAY}"`,
      'date: "2026-01-01"',
      'location: "Hoi An"',
      'country: "Vietnam"',
      "status: draft",
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(() => {
  fs.rmSync(path.join(tripPath(), "media"), { recursive: true, force: true });
  fs.rmSync(path.join(tripPath(), "originals"), { recursive: true, force: true });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the upload response's src", () => {
  test("is the same string the day reports for the same photograph", async () => {
    const token = await ownerToken();
    const { status, body } = await postFile(token, "a.jpg", await jpeg(400, 300));
    expect(status, JSON.stringify(body)).toBe(201);

    const reply = body as { items: { src: string }[] };

    const { getEntryBySlug } = await import("@/lib/entries");
    const entry = getEntryBySlug(`${OWNER}/${TRIP}`, DAY, { includeDrafts: true });
    expect(entry?.gallery).toHaveLength(1);

    // The whole point: what the upload answered with is exactly what the day
    // reads back, not the trip-relative form the entry's frontmatter keeps.
    expect(reply.items[0].src).toBe(entry!.gallery[0].src);
    expect(reply.items[0].src).toBe(`/${OWNER}/media/${TRIP}/${DAY}/01.jpg`);
  });
});
