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
 * B1647 — `costs/apply` treated a day that demonstrably existed as though it
 * did not, and filed its rows away from it (to the trip since B1844; dropped
 * entirely before that).
 *
 * `applyCosts` (`lib/statements/apply.ts`) read with `{ includeDrafts: true }`
 * and no `reader`, which defaults to the `"public"` level — the same filter
 * a stranger reading the site gets. A day (or gallery item) narrowed to
 * `visibility: "guest"`/`"private"` is invisible at that level (B632), so a
 * real day written through the day-write endpoint with that field set —
 * exactly what an agent exercising every field would do — read as though no
 * day existed at all for its date, and every row landed off the day.
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

test("a cost row dated for a private day lands on that day, not filed to the trip", async () => {
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
  expect(applyBody.filedToTrip).toEqual([]);
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

test("a row dated for no day at all is filed to the trip, and says so plainly", async () => {
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
  expect(applyBody.filedToTrip).toEqual([{ date: "2026-01-03", rows: 1 }]);
  expect(applyBody.total).toBe(1);

  const { readTripJson } = await import("@/lib/api/tripFile");
  const { tripRef } = await import("@/lib/trips");
  const read = readTripJson(tripRef("alex", "reise"));
  expect(read?.trip.costs?.items).toEqual([
    { label: "Nothing to attach this to", amount: 10, currency: "CHF", category: "food" },
  ]);
});

// B2243 review F1 — `costs/apply` is held to the same bounds as a day's own
// write: a long label is cut, and rows that would overfill a place are
// refused before anything is written.
test("a label over COST_LABEL_MAX_CHARS is cut; rows past COST_LINES_MAX are refused, nothing written", async () => {
  const token = await agentToken();
  const { COST_LABEL_MAX_CHARS, COST_LINES_MAX } = await import("@/lib/api/v2/schemas/day");
  const { POST: applyPost } = await import("@/app/api/v2/[user]/trips/[trip]/costs/apply/route");
  const apply = (rows: unknown[]) =>
    applyPost(
      new Request(`https://t.test/api/v2/alex/trips/reise/costs/apply`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
  const { readTripJson } = await import("@/lib/api/tripFile");
  const { tripRef } = await import("@/lib/trips");

  const long = await apply([{ date: "2026-01-03", label: "z".repeat(COST_LABEL_MAX_CHARS + 50), amount: 1, currency: "CHF", category: "food" }]);
  expect(long.status).toBe(200);
  expect(readTripJson(tripRef("alex", "reise"))?.trip.costs?.items?.[0].label).toHaveLength(COST_LABEL_MAX_CHARS);

  const rows = Array.from({ length: COST_LINES_MAX }, () => ({ date: "2026-01-04", label: "x", amount: 1, currency: "CHF", category: "food" }));
  const over = await apply(rows);
  expect(over.status).toBe(400);
  const body = await over.json();
  expect(body.error).toBe("invalid_costs");
  expect(JSON.stringify(body.details)).toContain(`at most ${COST_LINES_MAX} cost lines`);
  expect(readTripJson(tripRef("alex", "reise"))?.trip.costs?.items).toHaveLength(1);
});
