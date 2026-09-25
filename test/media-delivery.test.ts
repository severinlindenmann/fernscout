import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import sharp from "sharp";
import nextConfig from "@/next.config";
import { MEDIA_WIDTHS, NEXT_DEVICE_SIZES, NEXT_IMAGE_SIZES, POSTER_WIDTH, WARM_WIDTHS } from "@/lib/mediaSizes";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * How the media route delivers what its gates have already allowed — the
 * speed half of a route whose correctness half is `photo-visibility`,
 * `draft-audience` and `media-validator`.
 *
 * Every test here is about a shortcut, and a shortcut on this route is only
 * acceptable if it never answers a permission question from a stale state.
 * So the first block is the one that matters most: the trip's entries are now
 * read once per request instead of twice, and a publish, an unpublish or a
 * label written to disk must still be seen by the very next request.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

/**
 * sharp, counted. `lib/media.ts` imports it lazily, so this wrapper is what
 * every resize in this file goes through; the fixture photographs above are
 * made with the real one, imported statically before this mock applies.
 * `resize` records the width a pipeline was asked for, so the order jobs
 * *start* in can be read back.
 */
const sharpCalls = vi.hoisted(() => ({ started: [] as number[], active: 0, peak: 0 }));
vi.mock("sharp", async () => {
  const real = (await vi.importActual<typeof import("sharp")>("sharp")).default;
  const counted = (...args: Parameters<typeof real>) => {
    const pipeline = real(...args);
    let width = 0;
    const resize = pipeline.resize.bind(pipeline);
    pipeline.resize = ((w: number, ...rest: unknown[]) => {
      width = w;
      return (resize as (...a: unknown[]) => typeof pipeline)(w, ...rest);
    }) as typeof pipeline.resize;
    // Only the media route's own resize encodes to WebP. The route also
    // measures and hashes each photograph after the response
    // (`imageFactsFor`, `phashFor`), through sharp too, and those are not
    // what is being counted.
    let derivative = false;
    const webp = pipeline.webp.bind(pipeline);
    pipeline.webp = ((...a: Parameters<typeof webp>) => {
      derivative = true;
      return webp(...a);
    }) as typeof pipeline.webp;
    const toBuffer = pipeline.toBuffer.bind(pipeline);
    pipeline.toBuffer = (async () => {
      if (!derivative) return toBuffer();
      sharpCalls.started.push(width);
      sharpCalls.active += 1;
      sharpCalls.peak = Math.max(sharpCalls.peak, sharpCalls.active);
      try {
        // Long enough that jobs started together really do overlap.
        await new Promise((r) => setTimeout(r, 15));
        return await toBuffer();
      } finally {
        sharpCalls.active -= 1;
      }
    }) as typeof pipeline.toBuffer;
    return pipeline;
  };
  return { default: Object.assign(counted, real) };
});

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "open-2026";
const SLUG = "bangkok";

let dir: string;
let dayFile: string;
let photo: string;
let ownerToken: string;

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

/** Rewrites the day on disk the way a person editing the file would. */
function rewriteDay(change: (doc: Record<string, unknown>) => void) {
  const doc = JSON.parse(fs.readFileSync(dayFile, "utf8")) as Record<string, unknown>;
  change(doc);
  fs.writeFileSync(dayFile, JSON.stringify(doc, null, 2));
}

function cacheFiles(): string[] {
  try {
    return fs.readdirSync(path.join(dir, ".cache", "media"));
  } catch {
    return [];
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-delivery-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);

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
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
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
  await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#3fa9c4" } })
    .jpeg()
    .toFile(photo);
  await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#c43f9a" } })
    .jpeg()
    .toFile(path.join(mediaDir, "02.jpg"));

  ({ file: dayFile } = writeDayFixture(dir, OWNER, TRIP, {
    slug: SLUG,
    date: "2026-08-25",
    title: "Arrival",
    location: "Bangkok",
    country: "Thailand",
    media: [
      { src: `/media/${TRIP}/${SLUG}/01.jpg`, type: "image" },
      { src: `/media/${TRIP}/${SLUG}/02.jpg`, type: "image" },
    ],
    content: "Arrival.",
  }));

  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  ownerToken = session.token;
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  jar.cookies = {};
  sharpCalls.started = [];
  sharpCalls.peak = 0;
  fs.rmSync(path.join(dir, ".cache"), { recursive: true, force: true });
});

describe("one read of the entries per request, and nothing remembered past it", () => {
  /**
   * The same module instance throughout — no `resetModules` between the
   * steps — so anything the route or the entries layer held on to between
   * requests would show up here as a stale answer.
   */
  test("an unpublish is seen by the next request, and a draft is never public", async () => {
    const published = await get("01.jpg", { width: 480 });
    expect(published.status).toBe(200);
    expect(published.headers.get("cache-control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );

    rewriteDay((doc) => {
      doc.status = "draft";
    });
    // A stranger now gets nothing at all…
    expect((await get("01.jpg", { width: 480 })).status).toBe(404);
    // …and the owner gets it with no cache anywhere allowed to keep it.
    jar.cookies.fs_session = ownerToken;
    const asOwner = await get("01.jpg", { width: 480 });
    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get("cache-control")).toBe("private, no-store");
    // Revalidating a copy fetched while it was public does not bring the
    // public answer back either.
    const revalidated = await get("01.jpg", {
      width: 480,
      headers: { "if-none-match": published.headers.get("etag")! },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("cache-control")).toBe("private, no-store");

    jar.cookies = {};
    rewriteDay((doc) => {
      doc.status = "published";
    });
    const republished = await get("01.jpg", { width: 480 });
    expect(republished.status).toBe(200);
    expect(republished.headers.get("cache-control")).toMatch(/^public,/);
  });

  test("a label written to one photograph is seen by the next request", async () => {
    expect((await get("02.jpg")).status).toBe(200);
    rewriteDay((doc) => {
      (doc.media as { src: string; visibility?: string }[])[1].visibility = "private";
    });
    expect((await get("02.jpg")).status).toBe(404);
    // The other photograph on the same day keeps its public answer.
    expect((await get("01.jpg")).headers.get("cache-control")).toMatch(/^public,/);

    jar.cookies.fs_session = ownerToken;
    expect((await get("02.jpg")).headers.get("cache-control")).toBe("private, no-store");

    rewriteDay((doc) => {
      delete (doc.media as { visibility?: string }[])[1].visibility;
    });
  });
});

describe("the sized copy", () => {
  test("a cached copy is sent from disk, byte for byte what was made, at its real length", async () => {
    const made = await get("01.jpg", { width: 640 });
    const first = Buffer.from(await made.arrayBuffer());
    expect(made.headers.get("content-type")).toBe("image/webp");
    expect(cacheFiles()).toHaveLength(1);

    const cached = await get("01.jpg", { width: 640 });
    const again = Buffer.from(await cached.arrayBuffer());
    expect(cached.headers.get("content-length")).toBe(String(again.byteLength));
    expect(again.equals(first)).toBe(true);
    // Served, not made a second time.
    expect(sharpCalls.started).toEqual([640]);
  });

  /** Noise does not compress, so its 2000px copy is well past the size the
   *  route reads whole — the streamed branch, and it must be the same bytes. */
  test("a large cached copy is streamed, whole", async () => {
    const noisy = path.join(path.dirname(photo), "03.jpg");
    const pixels = Buffer.alloc(2000 * 1500 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
    await sharp(pixels, { raw: { width: 2000, height: 1500, channels: 3 } }).jpeg({ quality: 95 }).toFile(noisy);
    rewriteDay((doc) => {
      (doc.media as { src: string }[]).push({ src: `/media/${TRIP}/${SLUG}/03.jpg` });
    });

    const made = Buffer.from(await (await get("03.jpg", { width: 2000 })).arrayBuffer());
    expect(made.byteLength).toBeGreaterThan(256 * 1024);

    const cached = await get("03.jpg", { width: 2000 });
    expect(cached.headers.get("content-length")).toBe(String(made.byteLength));
    const reader = cached.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks).equals(made)).toBe(true);

    rewriteDay((doc) => {
      doc.media = (doc.media as { src: string }[]).filter((m) => !m.src.endsWith("03.jpg"));
    });
  });

  /** The body is identical whatever `Accept` says, so `Vary: Accept` was a
   *  false claim that split every shared cache's entry per browser. */
  test("says nothing about Accept, which the bytes do not depend on", async () => {
    for (const accept of ["image/webp,*/*", "image/jpeg"]) {
      const res = await get("01.jpg", { width: 320, headers: { accept } });
      expect(res.headers.get("vary") ?? "").not.toMatch(/accept/i);
    }
  });

  test("ten readers asking for one width at once cost one resize", async () => {
    const all = await Promise.all(Array.from({ length: 10 }, () => get("01.jpg", { width: 1200 })));
    const bodies = await Promise.all(all.map(async (r) => Buffer.from(await r.arrayBuffer())));
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(bodies.every((b) => b.equals(bodies[0]))).toBe(true);
    expect(sharpCalls.started).toEqual([1200]);
    // And nothing half-written was left beside it.
    expect(cacheFiles()).toEqual([expect.stringMatching(/^[0-9a-f]{32}\.webp$/)]);
  });

  test("however many are asked for at once, at most two decode together", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const copies = await Promise.all(MEDIA_WIDTHS.map((w) => resizedCopy(photo, w)));
    expect(copies.every(Boolean)).toBe(true);
    expect(sharpCalls.started).toHaveLength(MEDIA_WIDTHS.length);
    expect(sharpCalls.peak).toBeLessThanOrEqual(2);
  });

  test("somebody waiting goes ahead of a warm-up queued before them", async () => {
    const { mediaDerivative } = await import("@/lib/media");
    const second = path.join(path.dirname(photo), "02.jpg");
    const warming = Promise.all(
      [320, 480, 640, 828, 1080].map((w) => mediaDerivative(second, w, undefined, "later")),
    );
    // Two warm-ups are already running by now; the rest are queued.
    const wanted = mediaDerivative(photo, 1600, undefined, "now");
    await Promise.all([warming, wanted]);
    expect(sharpCalls.started.indexOf(1600)).toBeLessThanOrEqual(2);
  });

  test("a warm-up that somebody then asks for is theirs at once", async () => {
    const { mediaDerivative } = await import("@/lib/media");
    const second = path.join(path.dirname(photo), "02.jpg");
    const warming = [320, 480, 640, 828, 1080].map((w) => mediaDerivative(second, w, undefined, "later"));
    const wanted = mediaDerivative(second, 1080, undefined, "now");
    await Promise.all([...warming, wanted]);
    // 1080 was last in the warm queue; asked for, it jumped the other three.
    expect(sharpCalls.started.indexOf(1080)).toBeLessThanOrEqual(2);
    expect(sharpCalls.started.filter((w) => w === 1080)).toHaveLength(1);
  });
});

describe("warming after an upload", () => {
  test("makes exactly the copies the route will then serve without a resize", async () => {
    const { warmDerivatives } = await import("@/lib/media");
    await warmDerivatives(OWNER, [`/media/${TRIP}/${SLUG}/01.jpg`], WARM_WIDTHS);
    expect(cacheFiles()).toHaveLength(WARM_WIDTHS.length);
    expect(sharpCalls.started).toEqual([...WARM_WIDTHS]);

    for (const width of WARM_WIDTHS) {
      expect((await get("01.jpg", { width })).status).toBe(200);
    }
    // Keyed the way the route keys them: nothing new was made.
    expect(sharpCalls.started).toEqual([...WARM_WIDTHS]);
    expect(cacheFiles()).toHaveLength(WARM_WIDTHS.length);
  });

  test("a path that resolves to nothing warms nothing, and does not throw", async () => {
    const { warmDerivatives } = await import("@/lib/media");
    await warmDerivatives(OWNER, [`/media/${TRIP}/${SLUG}/missing.jpg`, `/media/${TRIP}/../x.jpg`], WARM_WIDTHS);
    expect(cacheFiles()).toHaveLength(0);
  });
});

describe("what the pages ask for", () => {
  /**
   * Next builds a `srcset` from `deviceSizes` + `imageSizes` and the loader
   * rounds each to a width the route makes. With Next's defaults, 750 and
   * 828 were both `?w=828` and 1920, 2048 and 3840 all `?w=2000`: several
   * candidates claiming widths their file did not have.
   */
  test("every srcset candidate is a distinct width the route really makes", () => {
    const images = nextConfig.images!;
    const all = [...(images.imageSizes ?? []), ...(images.deviceSizes ?? [])].sort((a, b) => a - b);
    expect(all).toEqual([...MEDIA_WIDTHS]);
    expect(images.deviceSizes).toEqual(NEXT_DEVICE_SIZES);
    expect(images.imageSizes).toEqual(NEXT_IMAGE_SIZES);
    // Next's own rule: every image size below every device size.
    expect(Math.max(...NEXT_IMAGE_SIZES)).toBeLessThan(Math.min(...NEXT_DEVICE_SIZES));

    const urls = all.map((width) => mediaLoader({ src: "/ana/media/t/d/01.jpg", width }));
    expect(new Set(urls).size).toBe(all.length);
    for (const width of all) {
      expect(mediaLoader({ src: "/ana/media/t/d/01.jpg", width })).toBe(`/ana/media/t/d/01.jpg?w=${width}`);
    }
  });

  test("a clip's still frame is asked for sized, and only when there is one", () => {
    expect(posterSrc("/ana/media/t/d/clip-poster.jpg", POSTER_WIDTH.GRID)).toBe(
      "/ana/media/t/d/clip-poster.jpg?w=640",
    );
    expect(posterSrc(undefined, POSTER_WIDTH.GRID)).toBeUndefined();
    // Both are widths the route makes, so neither is rounded into a third.
    expect(MEDIA_WIDTHS).toEqual(expect.arrayContaining([POSTER_WIDTH.GRID, POSTER_WIDTH.FULL]));
    expect(MEDIA_WIDTHS).toEqual(expect.arrayContaining([...WARM_WIDTHS]));
  });
});
