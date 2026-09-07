import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The empty jar: a stranger with the URL, which is who this test looks like
// throughout. Neither route under test needs a real session to demonstrate
// the header — the point is that the response *declares* it varies by
// cookie, not what a signed-in reader would see.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B330 — `story.json` (and `search-index.json`, which shares the same shape)
 * answer with a `Cache-Control` a shared cache will not store, but the body
 * still varies by the request's own cookie (drafts, costs, a reader-scoped
 * index) and nothing said so. `private` keeps a CDN or proxy from storing it;
 * it does nothing about a browser's own cache, which is shared between every
 * session on one device and keys purely on the URL without `Vary: Cookie`.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

let dir: string;

function journal(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-varying-json-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex", "trips", "asia-2023", "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "config.json"), USER_CFG);
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2023", "trip.md"),
    [
      "---",
      "id: asia-2023",
      'title: "Asia"',
      'start: "2026-01-01"',
      'end: "2026-01-09"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2023", "entries", "2026-01-01-a-day.md"),
    ["---", 'title: "A day"', 'date: "2026-01-01"', "status: published", "---", "", "x", ""].join(
      "\n",
    ),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
}

beforeEach(() => {
  journal();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describe("GET /:user/story.json", () => {
  test("carries Vary: Cookie beside its private Cache-Control", async () => {
    const { GET } = await import("@/app/[user]/story.json/route");
    const response = await GET(
      new Request("https://example.test/alex/story.json?trip=asia-2023&from=0&to=1"),
      { params: Promise.resolve({ user: "alex" }) } as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Vary")).toContain("Cookie");
  });
});

describe("GET /:user/search-index.json", () => {
  test("the anonymous, public branch needs no Vary (same answer for everyone)", async () => {
    const { GET } = await import("@/app/[user]/search-index.json/route");
    const response = await GET(new Request("https://example.test/alex/search-index.json"), {
      params: Promise.resolve({ user: "alex" }),
    } as never);
    expect(response.headers.get("Cache-Control")).toContain("public");
  });
});
