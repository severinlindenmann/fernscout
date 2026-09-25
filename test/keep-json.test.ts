import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A stranger with the URL: no cookie. What the manifest lists for them is
// exactly what the pages would show them — published days only.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2158 — `keep.json` lists what the service worker fetches ahead so a trip
 * reads with no signal (W43). It is a list of addresses behind the same gate
 * as the pages: a private trip is refused, a draft day is not listed for a
 * stranger, and no original is ever named — only the served derivatives at
 * the widths the pages use.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keep-json-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  for (const [id, visibility, status] of [
    ["alps", "public", "past"],
    ["secret", "private", "past"],
    // The current trip is served at the bare URLs; it must not be alps.
    // Status derives from the dates, so this one spans today.
    ["now", "public", "current"],
  ] as const) {
    writeTripFixture("alex", {
      id,
      title: id,
      start: status === "current" ? "2000-01-01" : "2026-01-01",
      end: status === "current" ? "2999-12-31" : "2026-01-09",
      status,
      visibility,
    });
  }
  const media = path.join(dir, "alex", "trips", "alps", "media");
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, "one.jpg"), Buffer.alloc(1234));
  writeDayFixture(dir, "alex", "alps", {
    slug: "one",
    date: "2026-01-01",
    title: "One",
    content: "x",
    media: [{ src: "/media/alps/one.jpg" }],
  });
  writeDayFixture(dir, "alex", "alps", {
    slug: "two",
    date: "2026-01-02",
    title: "Two",
    content: "y",
    status: "draft",
    media: [{ src: "/media/alps/hidden.jpg" }],
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

async function get(trip: string) {
  const { GET } = await import("@/app/[user]/trips/[trip]/keep.json/route");
  return GET(new Request(`https://example.test/alex/trips/${trip}/keep.json`), {
    params: Promise.resolve({ user: "alex", trip }),
  } as never);
}

describe("GET /:user/trips/:trip/keep.json", () => {
  test("lists the pages, story windows and served photographs a stranger may read", async () => {
    const res = await get("alps");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(res.headers.get("Vary")).toContain("Cookie");
    const body = await res.json();
    expect(body.pages).toEqual([
      "/alex/trips/alps",
      "/alex/trips/alps/map",
      "/alex/trips/alps/gallery",
      "/alex/trips/alps/day/one",
    ]);
    expect(body.data).toEqual(["/alex/story.json?trip=alex%2Falps&from=0&to=24"]);
    expect(body.media).toEqual([
      "/alex/media/alps/one.jpg?w=640",
      "/alex/media/alps/one.jpg?w=1200",
    ]);
    expect(body.counts).toEqual({ days: 1, media: 1 });
    expect(body.bytes).toBe(1234);
    // The draft day and its photograph are not there, and nothing says so.
    expect(JSON.stringify(body)).not.toContain("hidden");
    expect(JSON.stringify(body)).not.toContain("originals");
  });

  test("the current trip is listed at its bare URLs, where it is served", async () => {
    const body = await (await get("now")).json();
    expect(body.pages).toEqual(["/alex", "/alex/map", "/alex/gallery"]);
  });

  test("refuses a private trip like the pages do", async () => {
    expect((await get("secret")).status).toBe(403);
    expect((await get("nope")).status).toBe(404);
  });
});
