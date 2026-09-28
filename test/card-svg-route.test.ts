import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

/**
 * B2538, item 3 — `/@<user>/card.svg` (and the `/trips/<id>` equivalent):
 * served behind the trip's own read gate, exactly like `story.json` beside
 * it, so an `<img src>` can reach it directly rather than only a
 * server-rendered permalink getting a card.
 */

// An empty jar throughout — every test here reads as an anonymous, signed-out
// visitor. Same shape `test/access-gate.test.ts` uses for the same reason:
// `mayReadTrip`/`readFor` call `next/headers`' `cookies()`, which throws
// outside a real request unless it is mocked.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const OWNER = "ana";
const TRIP = "algarve-2026";

let dir: string;

function config() {
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
      owner: { name: "A B", nickname: "A", email: `${OWNER}@example.test` },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-card-svg-route-"));
  process.env.CONTENT_DIR = dir;
  config();
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function currentTripCard(headers?: Record<string, string>) {
  const { GET } = await import("@/app/at/[user]/card.svg/route");
  return GET(new Request(`https://t.test/@${OWNER}/card.svg`, { headers }), {
    params: Promise.resolve({ user: OWNER }),
  });
}

describe("GET /@<user>/card.svg", () => {
  test("a reader without access gets 404, not the card", async () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      start: "2026-06-22",
      end: "2026-06-23",
      visibility: "private",
      listed: false,
      intro: "x",
    });
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "day-1",
      date: "2026-06-22",
      coordinates: { lat: 37.1, lng: -8.5 },
    });

    const response = await currentTripCard();
    expect(response.status).toBe(404);
  });

  test("a public reader's SVG never carries a draft day's marker", async () => {
    writeTripFixture(OWNER, {
      id: TRIP,
      start: "2026-06-22",
      end: "2026-06-23",
      visibility: "public",
      listed: true,
      intro: "x",
    });
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "day-1",
      date: "2026-06-22",
      coordinates: { lat: 37.1, lng: -8.5 },
    });
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "day-2",
      date: "2026-06-23",
      status: "draft",
      coordinates: { lat: 41.9, lng: 12.5 },
    });

    const response = await currentTripCard();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    const svg = await response.text();
    // One published day, one marker — the draft's own day-2 circle (and its
    // Rome coordinates, projected into the frame) is not in here at all,
    // the same guarantee `test/trip-view-track.test.ts` proves one layer
    // down for the recorded line.
    expect(svg.match(/<circle/g)?.length ?? 0).toBe(1);
    expect(svg).toContain(">1<");
    expect(svg).not.toContain(">2<");
  });

  test("an unknown trip is 404, the same face as a locked one", async () => {
    const response = await currentTripCard();
    expect(response.status).toBe(404);
  });
});
