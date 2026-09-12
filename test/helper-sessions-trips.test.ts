import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

/**
 * The sessions route's trip picker split — B1573.
 *
 * `trips` (id + title, every trip) used to arrive alongside `days` computed
 * for whichever trip was chronologically newest, on every open of the
 * history panel whether or not its Tage tab was ever opened. Now `days` and
 * `tripTitle` arrive only when the caller names a trip with `?trip=<id>` —
 * the panel's own picker is what supplies that, once a person actually asks.
 *
 * `sessionsOf`/`liveSession` are mocked out: they need a real database, and
 * nothing about this split touches either of them — `trips`/`days` are read
 * straight off disk, same as `filesForRoom`'s own trip list.
 */

const OWNER_EMAIL = "alex@example.test";

vi.mock("@/lib/auth/handshake", () => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL })),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/helper/sessions", () => ({ sessionsOf: vi.fn(async () => []) }));
vi.mock("@/lib/helper/thread", () => ({ liveSession: vi.fn(async () => null) }));

const { GET: getSessions } = await import("@/app/api/helper/[user]/sessions/route");

const params = { params: Promise.resolve({ user: "ux" }) };

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"ux"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A","email":"' +
  OWNER_EMAIL +
  '"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function trip(id: string, title: string, start: string) {
  return `---\nid: ${id}\ntitle: "${title}"\nstart: "${start}"\nend: "${start}"\nstatus: past\n---\n\nx\n`;
}

const ENTRY = `---
title: "Tuesday"
date: "2024-01-02"
---

It happened.
`;

function journal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-sessions-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "ux", "trips", "older", "entries"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ux", "trips", "newer", "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ux", "config.json"), USER_CFG);
  fs.writeFileSync(path.join(dir, "ux", "trips", "older", "trip.md"), trip("older", "Older Trip", "2020-01-01"));
  fs.writeFileSync(path.join(dir, "ux", "trips", "newer", "trip.md"), trip("newer", "Newer Trip", "2026-01-01"));
  fs.writeFileSync(path.join(dir, "ux", "trips", "older", "entries", "2024-01-02-tuesday.md"), ENTRY);
  process.env.CONTENT_DIR = dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

test("without a trip named, every trip is listed and no days are computed for any of them", async () => {
  journal();
  const response = await getSessions(new Request("https://t.test/api/helper/ux/sessions"), params);
  const body = (await response.json()) as {
    trips?: { id: string; title: string }[];
    days?: unknown;
    tripTitle?: unknown;
  };
  // Newest first, same order the old single-trip pick used.
  expect(body.trips).toEqual([
    { id: "newer", title: "Newer Trip" },
    { id: "older", title: "Older Trip" },
  ]);
  expect(body.days).toBeUndefined();
  expect(body.tripTitle).toBeUndefined();
});

test("naming an older trip reaches its days, not the newest trip's", async () => {
  journal();
  const response = await getSessions(
    new Request("https://t.test/api/helper/ux/sessions?trip=older"),
    params,
  );
  const body = (await response.json()) as {
    tripTitle?: string;
    days?: { slug: string; date: string }[];
  };
  expect(body.tripTitle).toBe("Older Trip");
  expect(body.days).toEqual([{ trip: "older", slug: "tuesday", date: "2024-01-02", title: "Tuesday", draft: false }]);
});

test("a trip id nothing answers to gets an empty title and no days, not the newest trip's", async () => {
  journal();
  const response = await getSessions(
    new Request("https://t.test/api/helper/ux/sessions?trip=no-such-trip"),
    params,
  );
  const body = (await response.json()) as { tripTitle?: string; days?: unknown[] };
  expect(body.tripTitle).toBe("");
  expect(body.days).toEqual([]);
});
