import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeTripFixture } from "./fixtures/content";

/**
 * B2701 — a second part of a day with no time used to answer the same
 * `date_has_day` 409 a brand new, unconfirmed collision does, even once
 * `confirmSecondEntry` was already true: the route's own gate
 * (`app/api/helper/[user]/day/new/route.ts`) additionally required
 * `text(body.time)`, which a timeless part (an untimed photograph, or none
 * at all) never carries. `AddDayFlow`'s own `commit()` reads that 409 as
 * "ask again" and resets straight back to the inline "Add this to it?"
 * card — silently, with no message — which is what the persona round found
 * (B2684–B2693).
 *
 * `createDraft`'s own `nextUntitledSlug` (`lib/api/entries.ts`) already
 * gives an untitled second entry its own address on the date (`{date}-2`)
 * with no time involved at all, so requiring one here was never load
 * bearing for uniqueness — just an extra refusal a confirmed second entry
 * should never have to clear twice.
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

const { POST } = await import("@/app/api/helper/[user]/day/new/route");

const OWNER = "alex";
const TRIP_ID = "reise";
const params = { params: Promise.resolve({ user: OWNER }) };

let dir: string;

function post(body: unknown) {
  return POST(
    new Request(`https://t.test/api/helper/${OWNER}/day/new`, {
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
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-new-second-entry-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-new-second-entry-test-secret-b2701";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  writeTripFixture(OWNER, { id: TRIP_ID, title: "Reise", start: "2025-11-01", end: "2025-11-30", status: "current", visibility: "public" });
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("day/new — B2701, a confirmed second entry with no time", () => {
  test("a timeless second part is written, never refused a second time", async () => {
    const first = await read(await post({ trip: TRIP_ID, date: "2025-11-05", title: "Morning", content: "Out early." }));
    expect(first.status).toBe(201);

    // Unconfirmed: still the honest 409, existing day named.
    const unconfirmed = await read(await post({ trip: TRIP_ID, date: "2025-11-05", content: "Later." }));
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("date_has_day");

    // Confirmed, but no time at all — the part this ticket is about.
    const second = await read(
      await post({ trip: TRIP_ID, date: "2025-11-05", content: "Later, no time given.", confirmSecondEntry: true }),
    );
    expect(second.status).toBe(201);
    expect(second.body.slug).not.toBe(first.body.slug);
  });

  test("a timed second part still works, same as before", async () => {
    await post({ trip: TRIP_ID, date: "2025-11-05", title: "Morning", content: "Out early." });
    const second = await read(
      await post({ trip: TRIP_ID, date: "2025-11-05", time: "18:00", content: "Evening.", confirmSecondEntry: true }),
    );
    expect(second.status).toBe(201);
  });
});
