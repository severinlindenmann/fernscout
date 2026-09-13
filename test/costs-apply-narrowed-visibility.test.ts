import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { writeTripFixture } from "./fixtures/content";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B1647 — `costs/apply` orphaned a day that demonstrably existed.
 *
 * `applyCosts` (`lib/statements/apply.ts`) read with `{ includeDrafts: true }`
 * and no `reader`, which defaults to the `"public"` level — the same filter
 * a stranger reading the site gets. A day (or gallery item) narrowed to
 * `visibility: "guest"`/`"private"` is invisible at that level (B632), so a
 * real day written through the day-write endpoint with that field set —
 * exactly what an agent exercising every field would do — read as though no
 * day existed at all for its date, and every row landed in `orphaned`.
 *
 * `costs/apply` already gates on `mayWriteTrip` before it reads anything, so
 * it is entitled to the same standing as the person who wrote the day
 * (`AS_AUTHOR` in `lib/entries.ts`), not a public reader's.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1647-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, costs: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "T",
      owner: { name: "A", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, costs: { enabled: true } },
    }),
  );

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  writeTripFixture("alex", {
    id: "reise",
    title: "Reise",
    start: "2026-01-01",
    end: "2026-01-05",
    status: "current",
    visibility: "public",
    intro: "Body.",
  });
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a cost row dated for a private day lands on that day, not in orphaned", async () => {
  const token = await agentToken();
  const slug = "2026-01-02-private-day";

  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const putResp = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        title: "A private day",
        date: "2026-01-02",
        content: "Something happened.",
        status: "draft",
        visibility: "private",
        declined: {
          media: "no photographs attached to this day yet",
          costs: "nothing spent today, tracked elsewhere",
          coordinates: "no position recorded for this day",
          weather: "weather was not asked for this day",
          time: "the exact time of day was not recorded",
          timezone: "no timezone established for this leg",
          location: "no place name recorded for this day",
          country: "no country recorded for this day",
          countryCode: "no country code named for this day",
          transportMode: "no transport leg happened this day",
          tags: "no tags applied to this day",
          translations: "single-language journal, nothing to translate",
        },
      }),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  expect(putResp.status).toBe(201);

  const { POST: applyPost } = await import("@/app/api/v2/[user]/trips/[trip]/costs/apply/route");
  const applyResp = await applyPost(
    new Request(`https://t.test/api/v2/alex/trips/reise/costs/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        rows: [{ date: "2026-01-02", label: "Test train ticket", amount: 25, currency: "CHF", category: "transport" }],
      }),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  const applyBody = await applyResp.json();

  expect(applyResp.status).toBe(200);
  expect(applyBody.orphaned).toEqual([]);
  expect(applyBody.allOrphaned).toBeUndefined();
  expect(applyBody.written).toEqual([{ date: "2026-01-02", slug: "private-day", added: 1, kept: 0 }]);

  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const getResp = await GET(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  const day = await getResp.json();
  expect(day.costs).toEqual([{ label: "Test train ticket", amount: 25, currency: "CHF", category: "transport" }]);
});

test("a row dated for no day at all still orphans, and says so plainly", async () => {
  const token = await agentToken();

  const { POST: applyPost } = await import("@/app/api/v2/[user]/trips/[trip]/costs/apply/route");
  const applyResp = await applyPost(
    new Request(`https://t.test/api/v2/alex/trips/reise/costs/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        rows: [{ date: "2026-01-03", label: "Nothing to attach this to", amount: 10, currency: "CHF", category: "food" }],
      }),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  const applyBody = await applyResp.json();

  expect(applyResp.status).toBe(200);
  expect(applyBody.written).toEqual([]);
  expect(applyBody.orphaned).toEqual([{ date: "2026-01-03", rows: 1 }]);
  expect(applyBody.allOrphaned).toBe(true);
});
