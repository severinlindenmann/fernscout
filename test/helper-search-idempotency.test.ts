import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1663 — `find_in_journal` is a real model turn, spent for and run exactly
 * like `ask_thread`, so a retry must not run `findInJournal` a second time or
 * charge for it twice. This is `search`'s own copy of `helper-ask.test.ts`'s
 * retry test, in a file of its own because `test/helper-search.test.ts`
 * switches `credits` off globally to test the free path.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { findInJournal } = vi.hoisted(() => ({ findInJournal: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  findInJournal,
}));

const { POST } = await import("@/app/api/helper/[user]/search/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function search(body: unknown) {
  return POST(
    new Request("https://t.test/api/helper/alex/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-search-idem-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-search-idem-secret-b1663";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  findInJournal.mockReset();
  findInJournal.mockResolvedValue({ hits: [], suggestion: "" });
  clearIdempotencyStore();

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);

  writeTripFixture("alex", {
    id: "open-2026",
    title: "An Open Trip",
    start: "2026-08-24",
    end: "2026-08-26",
    visibility: "public",
    intro: "An open trip.",
  });
  writeDayFixture(dir, "alex", "open-2026", {
    slug: "day",
    date: "2026-08-25",
    title: "A day",
    location: "Bellinzona",
    country: "Switzerland",
    content: "Something happened.",
  });
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what it costs", () => {
  test("one credit per search", async () => {
    await search({ said: "the day in Ticino" });
    expect(await balanceOf("alex")).toBeCloseTo(9.98, 5);
  });

  test("a retry under the same idempotency key is answered once, not charged again", async () => {
    findInJournal.mockResolvedValue({ hits: [{ id: "open-2026/day", why: "Ticino" }], suggestion: "" });
    const call = async () =>
      read(await search({ said: "the day in Ticino", idempotency_key: "same-tap" }));
    const first = await call();
    const again = await call();
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(findInJournal).toHaveBeenCalledTimes(1);
    expect(await balanceOf("alex")).toBeCloseTo(9.98, 5);
  });

  test("without a key, two searches are two charges and two calls", async () => {
    await search({ said: "one" });
    await search({ said: "two" });
    expect(findInJournal).toHaveBeenCalledTimes(2);
    expect(await balanceOf("alex")).toBeCloseTo(9.96, 5);
  });
});
