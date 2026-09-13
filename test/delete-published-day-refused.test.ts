import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B1118 — a published day is not deleted on a self-served round trip,
 * repointed onto v2's `DELETE .../days/{slug}` for B1612.
 *
 * B101 found the old `DELETE .../days` (body-addressed) would remove a
 * *published* day behind the `agentConfirm` handshake, which is the same
 * agent asking for the code and spending it. B224's doctrine is that
 * destroying content people have already read needs a step no bearer token
 * can complete alone. `published_day_not_deletable` stands unchanged in v2
 * (`app/api/v2/.../days/[slug]/route.ts`'s own `DELETE`, B1118's doctrine
 * "carried over unchanged" per its comment) — take it off the site with
 * `.../unpublish` first (reversible); a draft still deletes outright, and v2
 * drops the confirm-code handshake entirely for that case, since nothing
 * about a draft has ever been on the site to protect a reader from.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP_ID = "alps";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.10.${calls % 250}`, ...extra };
}

async function token(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Alps",
    dates: { from: "2026-09-01", to: "2026-09-10" },
    visibility: "public",
    people: [{ name: "Alex B", email: OWNER_EMAIL }],
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      translations: "single-language journal",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
      listed: "not advertised for this fixture",
      buddies: "travelling solo",
    },
  };
}

function fullDayBody(slug: string): Record<string, unknown> {
  return {
    slug,
    title: slug,
    date: slug.slice(0, 10),
    content: "Something happened.",
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
  };
}

async function putTrip() {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function putDay(slug: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(fullDayBody(slug)),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function publish(slug: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}/publish`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: "{}",
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function deleteDay(slug: string) {
  const { DELETE } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await DELETE(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "DELETE",
      headers: headers({ authorization: `Bearer ${await token()}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

function dayFile(slug: string): string {
  return path.join(dir, OWNER, "trips", TRIP_ID, "entries", `${slug}.json`);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1118-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "b1118-test-secret-b1118-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Notebook",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Alex B",
    ownerNickname: "Alex",
  });
  if (!created.ok) throw new Error(created.message);

  const trip = await putTrip();
  if (trip.status !== 201) throw new Error(`trip not created: ${JSON.stringify(trip.body)}`);
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

describe("deleting a published day", () => {
  test("is refused with published_day_not_deletable, and the file survives", async () => {
    const slug = "2026-09-02-live-day";
    const written = await putDay(slug);
    expect(written.status, JSON.stringify(written.body)).toBe(201);
    const published = await publish(slug);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const refused = await deleteDay(slug);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("published_day_not_deletable");
    expect(String(refused.body.message)).toContain("unpublish");

    // The entry file is still there.
    expect(fs.existsSync(dayFile(slug))).toBe(true);
  });
});

describe("deleting a draft day", () => {
  test("goes through outright — no code to satisfy, nothing here was ever on the site", async () => {
    const slug = "2026-09-02-scrap";
    const written = await putDay(slug);
    expect(written.status, JSON.stringify(written.body)).toBe(201);

    const deleted = await deleteDay(slug);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    expect(fs.existsSync(dayFile(slug))).toBe(false);
  });
});
