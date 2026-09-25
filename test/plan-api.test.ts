import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { tripWriteScope } from "@/lib/tripPeople";

/**
 * B909 — a plan door: an upcoming trip's route could only ever be written by
 * hand, over SSH or through the `add-a-trip` skill on a local checkout.
 *
 * B1612 repoint: v1's `.../plan` route (GET/PUT) is deleted; `plan` is now a
 * plain section of the one v2 trip document
 * (`PATCH /api/v2/{user}/trips/{trip}`) — `{route: [...], body?: string}`,
 * required-or-declined at create like every other section. Two properties
 * from the original ticket do NOT survive and are not asserted here:
 *
 *  - v1's `getPlan({includeDrafts})` folded a future-dated draft day's own
 *    coordinate into the route as an extra stop, visible to the owner and
 *    hidden from a trip-scoped token (`draftsIncluded`). v2's `plan` section
 *    is exactly what was written to it — nothing augments it from the day
 *    list — so "the owner sees a draft-derived stop" has no v2 analogue;
 *  - v1's GET refused a trip-scoped token reading the whole trip's plan
 *    section on its own door. v2's GET is not owner- or scope-restricted at
 *    all (only PATCH is) — any token for the journal that owns this trip can
 *    read the trip document, plan included.
 *
 * What survives: a plan can be answered after creation instead of only at
 * create time; a stop with no real coordinate is refused by name; the write
 * is the owner's alone.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint an owner token: ${verified.reason}`);
  return verified.token;
}

async function scopedToken(email: string): Promise<string> {
  const { code } = await issueCode("alex", email, "agent", { trip: TRIP });
  const session = await verifyCode("alex", email, code, "agent", tripWriteScope(TRIP));
  if (!session.ok) throw new Error(`could not mint a trip-scoped token: ${session.reason}`);
  return session.token;
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
      plan: "an upcoming trip whose route is not yet decided",
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

async function putTrip(body: unknown, token: string) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function patchTrip(body: unknown, token: string) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getTrip(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/${TRIP}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: TRIP }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-plan-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "plan-api-test-secret-plan-api-test";
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
      baseCurrency: "CHF",
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

describe("the plan section, declined at create then answered by a PATCH", () => {
  test("declining plan at create reads back absent, not an error", async () => {
    const token = await ownerToken();
    const { status, body } = await putTrip(fullTrip(), token);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.plan).toBeUndefined();
  });

  test("a PATCH answers the declined section, and it reads back", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);

    const { status, body } = await patchTrip(
      {
        plan: {
          route: [{ location: "Fukuoka", country: "Japan", countryCode: "JP", lat: 33.5904, lng: 130.4017 }],
          body: "South to north.",
        },
      },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.plan as { route: { location: string }[] }).route.map((s) => s.location)).toEqual(["Fukuoka"]);
    expect((body.plan as { body?: string }).body).toBe("South to north.");
    expect((body.declined as Record<string, string>).plan).toBeUndefined();

    const { body: onDisk } = await getTrip(token);
    expect((onDisk.plan as { route: unknown[] }).route).toHaveLength(1);
  });

  test("a stop with no coordinate is refused by name, and nothing is written", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);

    const { status, body } = await patchTrip({ plan: { route: [{ location: "Nowhere" }] } }, token);
    expect(status).toBe(400);
    const problems = (body.details ?? []) as { field: string }[];
    expect(problems.some((p) => p.field.includes("lat"))).toBe(true);
    expect(problems.some((p) => p.field.includes("lng"))).toBe(true);

    const { body: onDisk } = await getTrip(token);
    expect(onDisk.plan).toBeUndefined();
  });

  test("an out-of-range coordinate is refused by name", async () => {
    const token = await ownerToken();
    await putTrip(fullTrip(), token);

    const { status, body } = await patchTrip(
      { plan: { route: [{ location: "Somewhere", lat: 200, lng: 10 }] } },
      token,
    );
    expect(status).toBe(400);
    const problems = (body.details ?? []) as { field: string }[];
    expect(problems.some((p) => p.field.includes("lat"))).toBe(true);
  });

  test("a trip-scoped token may still read the plan section (v2's GET is not owner-restricted)", async () => {
    const owner = await ownerToken();
    const declined = { ...(fullTrip().declined as Record<string, string>) };
    delete declined.buddies;
    await putTrip(
      fullTrip({
        people: [
          { name: "Alex", email: OWNER_EMAIL },
          { name: "Robin", email: "robin@example.test" },
        ],
        declined,
      }),
      owner,
    );
    await patchTrip(
      { plan: { route: [{ location: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 }] } },
      owner,
    );

    const scoped = await scopedToken("robin@example.test");
    const { status, body } = await getTrip(scoped);
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body.plan as { route: { location: string }[] }).route[0].location).toBe("Kyoto");
  });

  test("a trip-scoped token cannot write the plan — patching the trip document is the owner's alone", async () => {
    const owner = await ownerToken();
    const declined = { ...(fullTrip().declined as Record<string, string>) };
    delete declined.buddies;
    await putTrip(
      fullTrip({
        people: [
          { name: "Alex", email: OWNER_EMAIL },
          { name: "Robin", email: "robin@example.test" },
        ],
        declined,
      }),
      owner,
    );
    const scoped = await scopedToken("robin@example.test");

    const { status, body } = await patchTrip(
      { plan: { route: [{ location: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 }] } },
      scoped,
    );
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });
});
