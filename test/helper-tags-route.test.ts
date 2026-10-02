import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * `GET /api/helper/<user>/tags?trip=&q=` — B2675, "tags used before". No
 * model, no AI day: the journal's own existing day tags, most used first.
 * Same owner-cookie harness as `test/helper-trip-files-route.test.ts`.
 */

const OWNER_EMAIL = "alex@example.test";

vi.mock("@/lib/auth/handshake", () => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL })),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { GET: getTags } = await import("@/app/api/helper/[user]/tags/route");

const params = { params: Promise.resolve({ user: "ux" }) };

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"ux"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A","email":"' +
  OWNER_EMAIL +
  '"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function journal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-tags-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "ux"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ux", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;

  writeTripFixture("ux", { id: "a-trip", title: "A Trip", start: "2024-01-01", end: "2024-01-09", status: "past" });
  writeTripFixture("ux", { id: "b-trip", title: "B Trip", start: "2025-01-01", end: "2025-01-09", status: "past" });

  writeDayFixture(dir, "ux", "a-trip", {
    slug: "one",
    date: "2024-01-02",
    title: "One",
    content: "It happened.",
    tags: ["hiking", "museum"],
  });
  writeDayFixture(dir, "ux", "a-trip", {
    slug: "two",
    date: "2024-01-03",
    title: "Two",
    content: "It happened again.",
    tags: ["hiking", "rain"],
  });
  writeDayFixture(dir, "ux", "b-trip", {
    slug: "three",
    date: "2025-01-02",
    title: "Three",
    content: "A different trip.",
    tags: ["museum"],
  });
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

test("every tag across the journal, most used first", async () => {
  journal();
  const response = await getTags(new Request("https://t.test/api/helper/ux/tags"), params);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean; tags: string[] };
  expect(body.ok).toBe(true);
  // hiking: 2, museum: 2, rain: 1 — ties broken alphabetically.
  expect(body.tags).toEqual(["hiking", "museum", "rain"]);
});

test("narrowed to one trip", async () => {
  journal();
  const response = await getTags(new Request("https://t.test/api/helper/ux/tags?trip=b-trip"), params);
  const body = (await response.json()) as { tags: string[] };
  expect(body.tags).toEqual(["museum"]);
});

test("a q filters to a substring match", async () => {
  journal();
  const response = await getTags(new Request("https://t.test/api/helper/ux/tags?q=hik"), params);
  const body = (await response.json()) as { tags: string[] };
  expect(body.tags).toEqual(["hiking"]);
});

test("a journal with no days yet answers an empty list, not an error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-tags-empty-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "ux"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ux", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;

  const response = await getTags(new Request("https://t.test/api/helper/ux/tags"), params);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tags: string[] };
  expect(body.tags).toEqual([]);
});
