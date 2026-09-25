import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import sharp from "sharp";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * A photograph that predates `measureImage` is measured on first use — B1955.
 *
 * B1865 built the measurement and wired it into both upload paths, and
 * `imageFactsFor` for everything already on disk — which then had no
 * production caller at all, so not one of the owner's fifteen hundred
 * photographs ever carried an `image` block. The backfill script fills a
 * journal in one pass; this guards the half that keeps the hole shut
 * afterwards, for a photograph restored from a backup, synced in, or in a
 * journal nobody ran the script over.
 *
 * Driven through the media route rather than by calling `imageFactsFor`
 * directly, because "has a production caller" is the whole point of the
 * ticket and a unit test of the helper is what existed while nothing called
 * it. `flushAfterResponse` is how the deferred work is waited for: outside a
 * request scope `afterResponse` runs the task detached and tracked, so a test
 * calling the handler need not stand up a server.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const TRIP = "open-2026";
const SLUG = "bangkok";

let dir: string;

async function get(file: string, headers?: Record<string, string>): Promise<Response> {
  const { GET } = await import("@/app/[user]/media/[...path]/route");
  const segments = [TRIP, SLUG, file];
  return GET(
    new Request(`https://example.test/${OWNER}/media/${segments.join("/")}`, { headers }),
    { params: Promise.resolve({ user: OWNER, path: segments }) } as never,
  );
}

async function settled(): Promise<void> {
  const { flushAfterResponse } = await import("@/lib/afterResponse");
  await flushAfterResponse();
}

function sidecar(file: string): Record<string, unknown> | null {
  const at = path.join(dir, OWNER, "trips", TRIP, "meta", SLUG, `${file}.meta.json`);
  return fs.existsSync(at) ? (JSON.parse(fs.readFileSync(at, "utf8")) as Record<string, unknown>) : null;
}

beforeEach(async () => {
  vi.resetModules();
  jar.cookies = {};
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-image-facts-"));
  process.env.CONTENT_DIR = dir;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: "ana@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "Open",
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "public",
  });

  const mediaDir = path.join(dir, OWNER, "trips", TRIP, "media", SLUG);
  fs.mkdirSync(mediaDir, { recursive: true });
  // Half flat, half noise, so the quiet-tile grid has something to be right
  // about rather than nine identical numbers.
  const noisy = Buffer.alloc(600 * 400 * 3);
  for (let i = 0; i < noisy.length; i++) noisy[i] = i % 600 < 900 ? 128 : (i * 37) % 255;
  await sharp(noisy, { raw: { width: 600, height: 400, channels: 3 } }).jpeg().toFile(
    path.join(mediaDir, "01.jpg"),
  );
  fs.writeFileSync(path.join(mediaDir, "clip.mp4"), Buffer.alloc(64, 7));

  writeDayFixture(dir, OWNER, TRIP, {
    slug: SLUG,
    date: "2026-08-25",
    title: "Arrival",
    location: "Bangkok",
    country: "Thailand",
    media: [
      { src: `/media/${TRIP}/${SLUG}/01.jpg`, type: "image" },
      { src: `/media/${TRIP}/${SLUG}/clip.mp4`, type: "video" },
    ],
    content: "Arrival.",
  });
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a photograph with no image block gets one the first time it is served", async () => {
  expect(sidecar("01.jpg")).toBeNull();

  expect((await get("01.jpg")).status).toBe(200);
  await settled();

  const image = sidecar("01.jpg")?.image as Record<string, unknown> | undefined;
  expect(image).toBeDefined();
  expect(image).toMatchObject({ version: 1, width: 600, height: 400 });
  expect(image!.quietTiles).toHaveLength(9);
  expect(typeof image!.brightness).toBe("number");
});

test("serving it again leaves the block exactly as it was", async () => {
  await get("01.jpg");
  await settled();
  const first = sidecar("01.jpg");

  await get("01.jpg");
  await settled();
  expect(sidecar("01.jpg")).toEqual(first);
});

test("a 304 measures it too — a cached copy is still a first use", async () => {
  const warm = await get("01.jpg");
  const etag = warm.headers.get("etag")!;
  await settled();
  fs.rmSync(path.join(dir, OWNER, "trips", TRIP, "meta", SLUG, "01.jpg.meta.json"));

  const again = await get("01.jpg", { "if-none-match": etag });
  expect(again.status).toBe(304);
  await settled();
  expect((sidecar("01.jpg")?.image as { version?: number } | undefined)?.version).toBe(1);
});

test("a clip is not measured, and is not retried on every request", async () => {
  expect((await get("clip.mp4")).status).toBe(200);
  await settled();
  expect(sidecar("clip.mp4")).toBeNull();
});
