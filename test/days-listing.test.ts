import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

/**
 * B296 — the days listing is the one place the caller who wrote a draft is
 * entitled to see it, and it was hiding it: `getAllEntries(ref)` with no
 * options runs through `visible()`, which drops anything with `draft` set.
 * An agent that had just created fifteen days asked for the trip's days and
 * was handed an empty array.
 *
 * B1612 repoint: v1's `GET .../days` is deleted; the property moves to
 * `GET /api/v2/{user}/trips/{trip}/days`
 * (`app/api/v2/[user]/trips/[trip]/days/route.ts`). It never needed a special
 * case at all — it lists every `trip.json`-adjacent day file on disk with no
 * `visible()`-style filtering, gated only by `mayWriteTrip`, so a draft is
 * simply IN the list, same as a published day, distinguished by its own
 * `status` field ("draft"/"published") rather than v1's bolt-on `draft: true`
 * flag.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

function fullTrip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "public",
    people: [{ name: "Alex", email: OWNER_EMAIL }],
    listed: false,
    declined: {
      rates: "no foreign currency tracked on this trip at all",
      costs: "no budget tracked for this trip currently",
      plan: "no planned route recorded for this trip",
      days: "no days written for this trip at create time",
      translations: "single-language journal, nothing to translate",
      accent: "default accent left as the renderer's choice",
      figures: "no walking figures drawn for this trip",
      tagline: "no one-line subtitle written for this trip",
      intro: "no opening prose written for this trip yet",
      buddies: "travelling solo, nobody else was on this trip",
    },
    ...overrides,
  };
}

function fullDayBody(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: "Erster Tag",
    date: slug.slice(0, 10),
    content: "Ankunft am Morgen.",
    status: "draft",
    declined: {
      media: "no photographs attached to this day yet",
      costs: "nothing spent today, tracked elsewhere",
      coordinates: "no position recorded for this day",
      weather: "weather was not asked for this day",
      time: "the exact time of day was not recorded",
      timezone: "no timezone established for this leg",
      location: "no specific location named for this day",
      country: "no country named for this day entry",
      countryCode: "no country code named for this day",
      transportMode: "no transport leg happened this day",
      tags: "no tags applied to this day",
      translations: "single-language journal, nothing to translate",
      visibility: "no narrower visibility set for this day",
    },
    ...overrides,
  };
}

async function putTrip(token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function putDay(slug: string, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}/days/${slug}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(fullDayBody(slug)),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function publishDay(slug: string, token: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}/days/${slug}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function listDays(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}/days`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  const body = (await response.json()) as { days: { slug: string; status: string }[] };
  return { status: response.status, body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-days-listing-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "days-listing-test-secret-days-listing";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET .../days: the caller entitled to write here is entitled to see drafts", () => {
  test("a freshly written draft appears in the listing, marked as one", async () => {
    const token = await agentToken();
    await putTrip(token);
    await putDay("2026-09-01-erster-tag", token);

    const { status, body } = await listDays(token);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ slug: "2026-09-01-erster-tag", status: "draft" });
  });

  test("a published day in the same list carries status published", async () => {
    const token = await agentToken();
    await putTrip(token);
    await putDay("2026-09-01-erster-tag", token);
    await publishDay("2026-09-01-erster-tag", token);

    const { body } = await listDays(token);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ slug: "2026-09-01-erster-tag", status: "published" });
  });

  test("a mix of both is fully listed, each carrying its own status", async () => {
    const token = await agentToken();
    await putTrip(token);
    await putDay("2026-09-01-erster-tag", token);
    await publishDay("2026-09-01-erster-tag", token);
    await putDay("2026-09-02-zweiter-tag", token);

    const { body } = await listDays(token);
    const bySlug = new Map(body.days.map((d) => [d.slug, d]));
    expect(bySlug.get("2026-09-01-erster-tag")?.status).toBe("published");
    expect(bySlug.get("2026-09-02-zweiter-tag")?.status).toBe("draft");
  });
});
