import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { getTrip } from "@/lib/trips";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { POST as createDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";

/** The hints out of a refusal, as one string — asserted rather than the raw
 * JSON, whose escaping is not what anybody is testing. */
const hints = (body: Record<string, unknown>): string =>
  ((body.problems ?? []) as { hint?: string }[]).map((p) => p.hint ?? "").join(" | ");

/**
 * A key that is not a field, on the two calls that write content.
 *
 * B540 watched an agent working only from `/openapi.json` send `visibilty` —
 * one transposed letter — meaning `private`, and get a 201 and a trip
 * advertised in the sitemap, the feed and the switcher. Nothing refused it and
 * nothing mentioned it. The *value* side of that field has always been careful
 * (an unrecognised value reads as private, never as public, so a typo cannot
 * publish somebody's trip); the *key* side had no such care and failed the
 * other way.
 *
 * These assert the refusal and the suggestion, because a refusal that does not
 * name the field the caller meant sends them back to the documentation to
 * find it — which is where they got it wrong the first time.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function post(body: unknown) {
  const response = await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postDay(body: unknown) {
  const response = await createDayRoute(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const trip = { id: "reise", title: "Reise", start: "2026-09-01", end: "2026-09-05" };

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
    const result = await post({ ...trip, visibilty: "private" });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(getTrip("alex/reise")).toBeUndefined();
  });

  test("names the field the caller meant", async () => {
    const result = await post({ ...trip, visibilty: "private" });
    expect(hints(result.body)).toContain('did you mean "visibility"');
  });

  test("catches another API's separator habits", async () => {
    const result = await post({ ...trip, costs_visibility: "guests" });
    expect(result.status).toBe(400);
    expect(hints(result.body)).toContain('did you mean "costsVisibility"');
  });

  test("a body with every field spelled right is still created", async () => {
    const result = await post({
      ...trip,
      visibility: "private",
      costsVisibility: "guests",
      accent: "green",
      listed: false,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
  });
});

describe("a misspelled field on a day", () => {
  test("is refused alongside whatever else is wrong, in one list", async () => {
    await post(trip);
    const result = await postDay({
      title: "Tag",
      date: "2026-09-01",
      content: "Prosa.",
      transport_mode: "car",
      coordinates: false,
      costs: false,
      photos: false,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(hints(result.body)).toContain('did you mean "transportMode"');
  });

  test("one mistake is reported once, by the validator that knows the field", async () => {
    await post(trip);
    const result = await postDay({ title: "Tag", date: "nonsense", content: "P." });
    const problems = (result.body.problems ?? []) as { field: string }[];
    expect(problems.filter((p) => p.field === "date")).toHaveLength(1);
  });
});
