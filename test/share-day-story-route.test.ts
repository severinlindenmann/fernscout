import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

/**
 * `GET /api/web/{user}/trips/{trip}/days/{slug}/story` — B2665. The owner's
 * own door onto the 9:16 PNG "Share as a story" shows a preview of and
 * hands to the phone's share sheet. Modelled on the sibling
 * `.../publish`/`.../unpublish` routes (`test/web-cookie-proxies.test.ts`):
 * cookie-only, any `Authorization` header refused outright before the owner
 * is even asked about.
 */

const OWNER = "alex";
const TRIP = "story-trip";
const SLUG = "a-day";
const FULL_SLUG = `2026-09-02-${SLUG}`;

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 80, b: 40 } } })
    .jpeg()
    .toBuffer();
}

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

async function setupTripAndDay(opts: { visibility?: "public" | "private" | "guest"; photos?: number; status?: "draft" | "published" } = {}) {
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "A Trip",
    start: "2026-09-01",
    end: "2026-09-10",
    visibility: opts.visibility ?? "public",
    declined: {
      rates: "none",
      costs: "none",
      plan: "none",
      translations: "none",
      accent: "default",
      figures: "none",
    },
  });
  const mediaDir = path.join(dir, OWNER, "trips", TRIP, "media", SLUG);
  fs.mkdirSync(mediaDir, { recursive: true });
  const photoCount = opts.photos ?? 2;
  const media = [];
  for (let i = 1; i <= photoCount; i++) {
    const file = path.join(mediaDir, `0${i}.jpg`);
    fs.writeFileSync(file, await jpeg());
    media.push({ src: `/media/${TRIP}/${SLUG}/0${i}.jpg`, caption: i === 1 ? "A caption" : undefined });
  }
  writeDayFixture(dir, OWNER, TRIP, {
    slug: SLUG,
    date: "2026-09-02",
    title: "A day",
    location: "Somewhere",
    status: opts.status ?? "published",
    media,
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

function url(query = "") {
  return `https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${FULL_SLUG}/story${query}`;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-story-route-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeJournal();
  clearUserCache();
  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  isOwnerMock.mockClear();
  isOwnerMock.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("GET .../story — refusals", () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    await setupTripAndDay();
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    const response = await GET(new Request(url(), { headers: { authorization: "Bearer x" } }), params);
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("somebody who is not the owner gets nothing", async () => {
    await setupTripAndDay();
    isOwnerMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    const response = await GET(new Request(url()), params);
    expect(response.status).toBe(403);
  });

  test("a draft day answers 409 not_published, never a PNG of unpublished content", async () => {
    await setupTripAndDay({ status: "draft" });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    const response = await GET(new Request(url()), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_published");
  });

  test("the collage look refuses a day with fewer than three photos", async () => {
    await setupTripAndDay({ photos: 2 });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    const response = await GET(new Request(url("?look=collage")), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_enough_photos");
  });
});

describe("GET .../story — what is drawn", () => {
  test("draws a PNG for the owner, for each look, once there are enough photos", async () => {
    await setupTripAndDay({ photos: 3 });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    for (const look of ["photo", "postcard", "collage"]) {
      const response = await GET(new Request(url(`?look=${look}`)), params);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
    }
  });

  test("a public, published day's link reaches the picture route's facts (via storyCardFacts) — a guest trip's does not", async () => {
    // Exercised indirectly through the pure function test/story-card-facts.test.ts;
    // here we only confirm the route still answers 200 either way (the
    // drawn link itself is asserted on the pure facts, not by decoding a PNG).
    await setupTripAndDay({ visibility: "guest", photos: 1 });
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/story/route");
    const response = await GET(new Request(url()), params);
    expect(response.status).toBe(200);
  });
});
