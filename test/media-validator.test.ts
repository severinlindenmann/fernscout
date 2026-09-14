import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import sharp from "sharp";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * Conditional requests on the media route — B1730.
 *
 * The route served every photograph with an hour's freshness and no validator
 * at all, so a browser holding a perfectly good copy had nothing to send back
 * and the whole gallery came down the wire again every hour, and in full on
 * any reload that skipped the freshness check. The other half of the same
 * ticket is the body: an unresized `200` was `fs.readFileSync`, which for the
 * clips this route also serves is the entire file in memory before a byte
 * goes out.
 *
 * What is guarded here is the *route*, not a parser, because both faults are
 * properties of the response and neither is visible from a unit. The
 * permission gates have their own tests in `test/photo-visibility.test.ts`
 * and `test/draft-audience.test.ts`; the one thing this file has to say about
 * them is that the new early exit did not climb above them.
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
const CLIP_BYTES = 256 * 1024;

let dir: string;
let photo: string;

/** The route, imported fresh each time so it reads the current CONTENT_DIR. */
async function get(
  file: string,
  opts: { width?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { GET } = await import("@/app/[user]/media/[...path]/route");
  const segments = [TRIP, SLUG, file];
  const query = opts.width ? `?w=${opts.width}` : "";
  return GET(
    new Request(`https://example.test/${OWNER}/media/${segments.join("/")}${query}`, {
      headers: opts.headers,
    }),
    { params: Promise.resolve({ user: OWNER, path: segments }) } as never,
  );
}

beforeEach(async () => {
  vi.resetModules();
  jar.cookies = {};
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-validator-"));
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
  photo = path.join(mediaDir, "01.jpg");
  // A real JPEG: `resizedCopy` hands it to sharp, and a four-byte stub would
  // take the "cannot resize, serve the original" branch and never exercise
  // the width half of the validator.
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#3fa9c4" } })
    .jpeg()
    .toFile(photo);
  // And a clip, for the streamed body.
  // Comfortably past a stream's 64 KiB high-water mark, so a streamed body
  // arrives in several chunks and a buffered one does not — see below.
  fs.writeFileSync(path.join(mediaDir, "clip.mp4"), Buffer.alloc(CLIP_BYTES, 7));

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

describe("the validator", () => {
  test("a published photograph is served with a strong ETag and a day's freshness", async () => {
    const res = await get("01.jpg");
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
  });

  test("sending it back is a 304 with no body — at a width and without one", async () => {
    for (const width of [undefined, 480]) {
      const first = await get("01.jpg", { width });
      const etag = first.headers.get("etag")!;
      expect(first.status).toBe(200);

      const second = await get("01.jpg", { width, headers: { "if-none-match": etag } });
      expect(second.status).toBe(304);
      expect(second.headers.get("etag")).toBe(etag);
      // A 304 still has to carry what a cache updates its entry from.
      expect(second.headers.get("cache-control")).toBe(
        "public, max-age=86400, stale-while-revalidate=604800",
      );
      expect(await second.arrayBuffer()).toHaveProperty("byteLength", 0);
      // Nothing out of a content folder is a document, on a 304 either.
      expect(second.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(second.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  /** One file, eight widths plus the original. They are not the same bytes and
   * must not share a validator. */
  test("each width is its own representation", async () => {
    const tags = new Set<string>();
    for (const width of [undefined, 320, 480, 1080]) {
      tags.add((await get("01.jpg", { width })).headers.get("etag")!);
    }
    expect(tags.size).toBe(4);
  });

  test("a width's tag does not revalidate the original, or another width", async () => {
    const small = (await get("01.jpg", { width: 320 })).headers.get("etag")!;
    expect((await get("01.jpg", { headers: { "if-none-match": small } })).status).toBe(200);
    expect(
      (await get("01.jpg", { width: 1080, headers: { "if-none-match": small } })).status,
    ).toBe(200);
  });

  /** The reason the key carries mtime and size: a photograph replaced under
   * the same name must not be revalidated away forever. */
  test("replacing the file in place changes the tag and re-sends", async () => {
    const before = (await get("01.jpg")).headers.get("etag")!;

    await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c43f9a" } })
      .jpeg({ quality: 40 })
      .toFile(photo);
    fs.utimesSync(photo, new Date(), new Date(Date.now() + 60_000));

    const after = await get("01.jpg", { headers: { "if-none-match": before } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before);
  });

  test("a weak tag and a list are both understood, and so is *", async () => {
    const etag = (await get("01.jpg")).headers.get("etag")!;
    const cases = [
      `W/${etag}`,
      `"0000000000000000000000000000beef", ${etag}`,
      "*",
    ];
    for (const header of cases) {
      expect((await get("01.jpg", { headers: { "if-none-match": header } })).status).toBe(304);
    }
  });

  test("a tag for another file does not match", async () => {
    const clip = (await get("clip.mp4")).headers.get("etag")!;
    expect((await get("01.jpg", { headers: { "if-none-match": clip } })).status).toBe(200);
  });
});

describe("the gates still run first", () => {
  /**
   * The whole risk in adding an early exit to this route: a `304` above the
   * permission checks would confirm a photograph exists to somebody who
   * should get a `404`. The tag is taken as the owner and replayed as a
   * stranger on a trip nobody may read.
   */
  test("a validator does not open a private trip", async () => {
    const etag = (await get("01.jpg")).headers.get("etag")!;

    // Same file, same bytes, same tag — and now behind a gate. Written
    // through the store rather than the fixture writer, which creates and
    // refuses to overwrite.
    const { readTripFile, writeTripFile } = await import("@/lib/api/v2/store");
    const trip = readTripFile(OWNER, TRIP)!;
    writeTripFile(OWNER, TRIP, { ...trip, visibility: "private" });
    vi.resetModules();

    const refused = await get("01.jpg", { headers: { "if-none-match": etag } });
    expect(refused.status).toBe(404);
    expect(refused.headers.get("etag")).toBe(null);
  });
});

describe("the body", () => {
  /**
   * **Counting chunks, and that is the only assertion here that discriminates.**
   * `new Response(uint8Array)` also exposes a `ReadableStream` body, so
   * `instanceof` passes just as happily on the `readFileSync` this ticket
   * removed — the test would have been green against the bug. What a buffered
   * body cannot do is arrive in pieces: it is one chunk of the whole file,
   * however large. A `createReadStream` reads in 64 KiB by default, so a
   * quarter-megabyte clip is four of them or more.
   */
  test("a clip is streamed rather than held whole, and still declares its length", async () => {
    const res = await get("clip.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(CLIP_BYTES));
    expect(res.headers.get("accept-ranges")).toBe("bytes");

    // A reader loop rather than `for await`: the DOM `ReadableStream` this
    // is typed as has no `Symbol.asyncIterator`, whatever Node's own does.
    const reader = res.body!.getReader();
    let chunks = 0;
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      bytes += value.byteLength;
    }
    expect(chunks).toBeGreaterThan(1);
    // And it is the whole file, not a truncated stream.
    expect(bytes).toBe(CLIP_BYTES);
  });

  test("a range is still a 206 of the right slice, and a bad one still a 416", async () => {
    const res = await get("clip.mp4", { headers: { range: "bytes=10-19" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-19/${CLIP_BYTES}`);
    expect((await res.arrayBuffer()).byteLength).toBe(10);

    const bad = await get("clip.mp4", { headers: { range: `bytes=${CLIP_BYTES}-${CLIP_BYTES + 10}` } });
    expect(bad.status).toBe(416);
  });
});
