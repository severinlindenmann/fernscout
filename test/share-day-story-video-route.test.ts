import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));
vi.mock("@/lib/storyVideo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storyVideo")>();
  return { ...actual, videoToolsAvailable: vi.fn(), renderStoryVideo: vi.fn() };
});

/**
 * `GET /api/web/{user}/trips/{trip}/days/{slug}/story/video` — B2665. Same
 * gates as the picture route beside it; this file covers the one thing
 * that is specific to the clip: no ffmpeg on this host, no clip, and the
 * UI (`ShareDayStory`) is told so server-side rather than offering a tile
 * that 500s. Rendering a real clip needs a real ffmpeg and is exercised by
 * hand in the browser check, not here — see the final report.
 */

const OWNER = "alex";
const TRIP = "story-video-trip";
const SLUG = "a-day";
const FULL_SLUG = `2026-09-02-${SLUG}`;

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;
let videoToolsAvailableMock: ReturnType<typeof vi.fn>;
let renderStoryVideoMock: ReturnType<typeof vi.fn>;

function writeJournal() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Notebook",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "public",
      declined: { figures: "none for this test journal" },
      features: {},
    }),
  );
}

function setupTripAndDay() {
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "A Trip",
    start: "2026-09-01",
    end: "2026-09-10",
    visibility: "public",
    listed: true,
    declined: { rates: "none", costs: "none", plan: "none", translations: "none", accent: "default", figures: "none" },
  });
  const mediaDir = path.join(dir, OWNER, "trips", TRIP, "media", SLUG);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, "01.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  writeDayFixture(dir, OWNER, TRIP, {
    slug: SLUG,
    date: "2026-09-02",
    title: "A day",
    location: "Somewhere",
    status: "published",
    media: [{ src: `/media/${TRIP}/${SLUG}/01.jpg` }],
    declined: {
      costs: "none",
      coordinates: "none",
      weather: "none",
      time: "none",
      timezone: "none",
      countryCode: "none",
      transportMode: "none",
      tags: "none",
      translations: "none",
      visibility: "none",
    },
  });
}

const params = { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: FULL_SLUG }) };
const url = `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/story/video`;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-story-video-route-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeJournal();
  clearUserCache();
  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  isOwnerMock.mockClear();
  isOwnerMock.mockResolvedValue(true);
  const storyVideo = await import("@/lib/storyVideo");
  videoToolsAvailableMock = vi.mocked(storyVideo.videoToolsAvailable);
  videoToolsAvailableMock.mockResolvedValue(true);
  renderStoryVideoMock = vi.mocked(storyVideo.renderStoryVideo);
  renderStoryVideoMock.mockReset();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("GET .../story/video", () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    setupTripAndDay();
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { authorization: "Bearer x" } }), params);
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("no ffmpeg on this host → 404 video_unavailable, never a 500", async () => {
    setupTripAndDay();
    videoToolsAvailableMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("video_unavailable");
  });

  test("a day with no photographs → 404 video_unavailable", async () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      title: "A Trip",
      start: "2026-09-01",
      end: "2026-09-10",
      visibility: "public",
      listed: true,
      declined: { rates: "none", costs: "none", plan: "none", translations: "none", accent: "default", figures: "none" },
    });
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      status: "published",
      declined: {
        media: "none",
        costs: "none",
        coordinates: "none",
        weather: "none",
        time: "none",
        timezone: "none",
        location: "none",
        country: "none",
        countryCode: "none",
        transportMode: "none",
        tags: "none",
        translations: "none",
        visibility: "none",
      },
    });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("video_unavailable");
  });

  test("a draft day → 409 not_published, checked before any render", async () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      title: "A Trip",
      start: "2026-09-01",
      end: "2026-09-10",
      visibility: "public",
      listed: true,
      declined: { rates: "none", costs: "none", plan: "none", translations: "none", accent: "default", figures: "none" },
    });
    const mediaDir = path.join(dir, OWNER, "trips", TRIP, "media", SLUG);
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "01.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    writeDayFixture(dir, OWNER, TRIP, {
      slug: SLUG,
      date: "2026-09-02",
      title: "A day",
      status: "draft",
      media: [{ src: `/media/${TRIP}/${SLUG}/01.jpg` }],
      declined: {
        costs: "none",
        coordinates: "none",
        weather: "none",
        time: "none",
        timezone: "none",
        location: "none",
        country: "none",
        countryCode: "none",
        transportMode: "none",
        tags: "none",
        translations: "none",
        visibility: "none",
      },
    });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_published");
  });
});

/**
 * Byte ranges — B2665 round 2. iOS Safari refuses to play a clip at all
 * unless the server answers the range it asks for before it starts, so
 * this is checked against a fixed, fake "rendered" buffer rather than a
 * real clip (which the real-render test, test/story-video-render.test.ts,
 * covers on its own).
 */
describe("GET .../story/video — byte ranges", () => {
  const TOTAL = 1000;
  function fixedClip() {
    const buf = Buffer.alloc(TOTAL);
    for (let i = 0; i < TOTAL; i++) buf[i] = i % 256;
    return buf;
  }

  beforeEach(() => {
    setupTripAndDay();
    renderStoryVideoMock.mockResolvedValue(fixedClip());
  });

  test("no Range header answers the whole clip, with Accept-Ranges", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(TOTAL));
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(TOTAL);
  });

  test("bytes=a-b answers 206 with exactly that slice", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { range: "bytes=100-199" } }), params);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 100-199/${TOTAL}`);
    expect(response.headers.get("content-length")).toBe("100");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toHaveLength(100);
    expect(body[0]).toBe(100 % 256);
  });

  test("bytes=a- answers from a to the end", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { range: `bytes=${TOTAL - 50}-` } }), params);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${TOTAL - 50}-${TOTAL - 1}/${TOTAL}`);
    expect(response.headers.get("content-length")).toBe("50");
  });

  test("the suffix form bytes=-n answers the last n bytes", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { range: "bytes=-40" } }), params);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${TOTAL - 40}-${TOTAL - 1}/${TOTAL}`);
    expect(response.headers.get("content-length")).toBe("40");
  });

  test("an unsatisfiable range answers 416 with the total size, never a guess", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { range: `bytes=${TOTAL + 10}-${TOTAL + 20}` } }), params);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${TOTAL}`);
  });

  test("auth is still checked before any byte is served, range or not", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/video/route");
    const response = await GET(new Request(url, { headers: { range: "bytes=0-10" } }), params);
    expect(response.status).toBe(403);
    expect(renderStoryVideoMock).not.toHaveBeenCalled();
  });
});
