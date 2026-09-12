import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

/**
 * `GET /api/helper/<user>/trip-files?trip=<id>` — B1573.
 *
 * The on-demand half of the split: `filesForRoom` lists every trip cheaply
 * and loads none of their photographs; this is the one call that fetches a
 * single named trip's, and only once the files pane's own picker asks.
 */

const OWNER_EMAIL = "alex@example.test";

vi.mock("@/lib/auth/handshake", () => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL })),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { GET: getTripFiles } = await import("@/app/api/helper/[user]/trip-files/route");

const params = { params: Promise.resolve({ user: "ux" }) };

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"ux"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A","email":"' +
  OWNER_EMAIL +
  '"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

const TRIP =
  '---\nid: a-trip\ntitle: "A Trip"\nstart: "2024-01-01"\nend: "2024-01-09"\nstatus: past\n---\n\nx\n';

const ENTRY = `---
title: "Tuesday"
date: "2024-01-02"
location: "Somewhere"
gallery:
  - src: "/media/a-trip/tuesday/01.jpg"
    type: "image"
    width: 100
    height: 100
    caption: "The harbour"
---

It happened.
`;

function journal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-trip-files-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "ux", "trips", "a-trip", "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ux", "config.json"), USER_CFG);
  fs.writeFileSync(path.join(dir, "ux", "trips", "a-trip", "trip.md"), TRIP);
  fs.writeFileSync(path.join(dir, "ux", "trips", "a-trip", "entries", "2024-01-02-tuesday.md"), ENTRY);
  process.env.CONTENT_DIR = dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

test("a named trip answers with its title and its photographs", async () => {
  journal();
  const response = await getTripFiles(
    new Request("https://t.test/api/helper/ux/trip-files?trip=a-trip"),
    params,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    ok: boolean;
    title: string;
    files: { id: string; src?: string }[];
  };
  expect(body.title).toBe("A Trip");
  expect(body.files).toHaveLength(1);
  expect(body.files[0].id).toBe("photo:tuesday:/ux/media/a-trip/tuesday/01.jpg");
});

test("a trip id nothing answers to is a 404, not an empty trip", async () => {
  journal();
  const response = await getTripFiles(
    new Request("https://t.test/api/helper/ux/trip-files?trip=no-such-trip"),
    params,
  );
  expect(response.status).toBe(404);
});

test("no trip named at all is the same 404 — there is nothing to guess at", async () => {
  journal();
  const response = await getTripFiles(
    new Request("https://t.test/api/helper/ux/trip-files"),
    params,
  );
  expect(response.status).toBe(404);
});
