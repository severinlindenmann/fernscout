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
 * A key that is not a field, on the two calls that write content.
 *
 * B540 watched an agent working only from `/openapi.json` send `visibilty` —
 * one transposed letter — meaning `private`, and get a 201 and a trip
 * advertised in the sitemap, the feed and the switcher. Nothing refused it and
 * nothing mentioned it.
 *
 * B1612 repoint: v1's routes hand-rolled the "did you mean" suggestion this
 * file used to assert; v2's `z.strictObject` (`lib/api/v2/schemas/*.ts`)
 * refuses an unrecognised key on sight, with no fuzzy-match hint of its own —
 * that specific UX (naming the field the caller probably meant) has no v2
 * equivalent, and this file no longer asserts it. What survives, and is
 * B540's actual point, is the property underneath: a typo'd field is REFUSED,
 * loudly, and nothing is written — never silently dropped and never silently
 * accepted as some other trip going public.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

function fullTrip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex", email: OWNER_EMAIL }],
    teaser: true,
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
    },
    ...overrides,
  };
}

function fullDayBody(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: "Tag",
    date: slug.slice(0, 10),
    content: "Prosa.",
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

async function putTrip(body: unknown) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getTrip() {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      headers: { authorization: `Bearer ${await token()}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function putDay(slug: string, body: unknown) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}/days/${slug}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unknown-field-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "unknown-field-test-secret-b540";
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
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      visibility: "public",
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

describe("a misspelled field on trip creation", () => {
  test("is refused, and nothing is written", async () => {
    const result = await putTrip({ ...fullTrip(), visibilty: "private" });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body.error).toBe("invalid_trip");
    const missing = await getTrip();
    expect(missing.status).toBe(404);
  });

  test("names the field it does not recognise", async () => {
    const result = await putTrip({ ...fullTrip(), visibilty: "private" });
    const problems = (result.body.details ?? []) as { field: string; problem: string }[];
    expect(problems.some((p) => p.problem.includes("visibilty"))).toBe(true);
  });

  test("catches another API's separator habits too", async () => {
    const result = await putTrip({ ...fullTrip(), costs_visibility: "guests" });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    const problems = (result.body.details ?? []) as { field: string; problem: string }[];
    expect(problems.some((p) => p.problem.includes("costs_visibility"))).toBe(true);
  });

  test("a body with every field spelled right is still created", async () => {
    const base = fullTrip({ visibility: "public", accent: "green", teaser: undefined, listed: false });
    const declined = { ...(base.declined as Record<string, string>) };
    delete declined.accent;
    const result = await putTrip({ ...base, declined });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
  });
});

describe("a misspelled field on a day", () => {
  test("is refused alongside whatever else is wrong, in one list", async () => {
    await putTrip(fullTrip());
    const result = await putDay("2026-09-01-tag", {
      ...fullDayBody("2026-09-01-tag"),
      transport_mode: "car",
    });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    const problems = (result.body.details ?? []) as { field: string; problem: string }[];
    expect(problems.some((p) => p.problem.includes("transport_mode"))).toBe(true);
  });

  test("one mistake is reported once, by the validator that knows the field", async () => {
    await putTrip(fullTrip());
    const result = await putDay("2026-09-01-tag", { ...fullDayBody("2026-09-01-tag"), date: "nonsense" });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    const problems = (result.body.details ?? []) as { field: string }[];
    expect(problems.filter((p) => p.field === "date")).toHaveLength(1);
  });
});
