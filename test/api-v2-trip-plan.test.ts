import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Same guard `api-v2-trips.test.ts` uses: every call here authenticates with
// a bearer token, so `isOwner`/cookie helpers (which read through
// next/headers) never run against a live request.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `plan.mode`/`plan.readers`, stop ids, `see[]`, `plan.private` and
 * `costs.items[].stop`/day `costs[].stop` — B2009.
 *
 * Same shape as `test/api-v2-trips.test.ts`: a real temp content dir, a real
 * sqlite db, real sessions minted through `lib/auth`, real route handlers
 * called directly.
 */

const OWNER = "pia";
const OWNER_EMAIL = "pia@example.test";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.4.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function tripScopedToken(tripId: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: tripId });
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
  if (!result.ok) throw new Error("no scoped token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Trip ${id}`,
    dates: { from: "2026-06-01", to: "2026-06-10" },
    visibility: "private",
    people: [{ name: "Pia Traveller", email: OWNER_EMAIL }],
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
      buddies: "travelling solo, nobody else was on this trip",
    },
    ...overrides,
  };
}

async function getTrip(user: string, id: string, token?: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
  const response = await GET(new Request(url, { headers: headers(token ? { authorization: `Bearer ${token}` } : {}) }), {
    params: Promise.resolve({ user, trip: id }),
  });
  return { status: response.status, body: (await response.json()) as Body };
}

async function putTrip(user: string, id: string, body: unknown, token: string | undefined) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
  const response = await PUT(
    new Request(url, {
      method: "PUT",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchTrip(
  user: string,
  id: string,
  body: unknown,
  token: string | undefined,
  opts: { ifMatch?: string } = {},
) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const url = new URL(`https://example.test/api/v2/${user}/trips/${id}`);
  const response = await PATCH(
    new Request(url, {
      method: "PATCH",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, trip: id }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-trip-plan-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Pia's Journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Pia Traveller",
    ownerNickname: "Pia",
  });
  if (!created.ok) throw new Error(created.message);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("nights mode derives arrive/leave", () => {
  test("a route reads back with dates up to the first stop without nights, and none after it", async () => {
    const token = await ownerToken();
    const id = "nights-basic";
    const { status: createStatus } = await putTrip(OWNER, id, fullTrip(id), token);
    expect(createStatus).toBe(201);

    const { status, body } = await patchTrip(
      OWNER,
      id,
      {
        plan: {
          route: [
            { location: "Bern", lat: 46.948, lng: 7.4474, nights: 2 },
            { location: "Zurich", lat: 47.3769, lng: 8.5417 },
            { location: "Basel", lat: 47.5596, lng: 7.5886 },
          ],
        },
      },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const route = (body.plan as { route: Record<string, unknown>[] }).route;
    expect(route).toHaveLength(3);

    // Ids assigned server-side, from the location.
    expect(route[0].id).toBe("bern");
    expect(route[1].id).toBe("zurich");
    expect(route[2].id).toBe("basel");

    // Bern: 2 nights from the trip's own start.
    expect(route[0].arrive).toBe("2026-06-01");
    expect(route[0].leave).toBe("2026-06-03");
    // Zurich: no `nights` of its own, but still arrives where Bern left off.
    expect(route[1].arrive).toBe("2026-06-03");
    expect(route[1].leave).toBeUndefined();
    // Basel: after a stop with no nights, both ends are unknowable.
    expect(route[2].arrive).toBeUndefined();
    expect(route[2].leave).toBeUndefined();
  });

  test("switching to dates mode keeps the stored dates, and switching back recounts nights from them", async () => {
    const token = await ownerToken();
    const id = "nights-roundtrip";
    await putTrip(OWNER, id, fullTrip(id), token);

    await patchTrip(
      OWNER,
      id,
      {
        plan: {
          route: [
            { location: "Lyon", lat: 45.764, lng: 4.8357, nights: 3 },
            { location: "Marseille", lat: 43.2965, lng: 5.3698, nights: 2 },
          ],
        },
      },
      token,
    );

    // Switch to `dates` mode, sending the same route with its own arrive/
    // leave carried over — nothing here is derived, so it must survive
    // exactly as sent, gap or not.
    const dated = await patchTrip(
      OWNER,
      id,
      {
        plan: {
          mode: "dates",
          route: [
            { id: "lyon", location: "Lyon", lat: 45.764, lng: 4.8357, arrive: "2026-06-01", leave: "2026-06-04" },
            // A one-day gap between Lyon and Marseille — allowed in `dates`
            // mode.
            { id: "marseille", location: "Marseille", lat: 43.2965, lng: 5.3698, arrive: "2026-06-05", leave: "2026-06-07" },
          ],
        },
      },
      token,
    );
    expect(dated.status, JSON.stringify(dated.body)).toBe(200);
    const datedRoute = (dated.body.plan as { route: Record<string, unknown>[] }).route;
    expect(datedRoute[0].arrive).toBe("2026-06-01");
    expect(datedRoute[0].leave).toBe("2026-06-04");
    expect(datedRoute[0].nights).toBeUndefined();
    expect(datedRoute[1].arrive).toBe("2026-06-05");
    expect(datedRoute[1].leave).toBe("2026-06-07");

    // Switch back to `nights` mode without resending `nights` — it is
    // recounted from the dates just stored.
    const renighted = await patchTrip(
      OWNER,
      id,
      {
        plan: {
          mode: "nights",
          route: datedRoute,
        },
      },
      token,
    );
    expect(renighted.status, JSON.stringify(renighted.body)).toBe(200);
    const renightedRoute = (renighted.body.plan as { route: Record<string, unknown>[] }).route;
    expect(renightedRoute[0].nights).toBe(3);
    expect(renightedRoute[1].nights).toBe(2);
  });
});

describe("plan.private", () => {
  async function tripWithPrivatePlan(id: string, token: string) {
    await putTrip(OWNER, id, fullTrip(id), token);
    return patchTrip(
      OWNER,
      id,
      {
        plan: {
          route: [{ location: "Riga", lat: 56.9496, lng: 24.1052, nights: 2 }],
          private: {
            links: [{ label: "Shared notes", url: "https://example.test/notes" }],
            stops: {
              riga: {
                stay: { name: "Some Hotel", lat: 56.95, lng: 24.1 },
                links: [{ label: "Booking", url: "https://example.test/booking" }],
              },
            },
          },
        },
      },
      token,
    );
  }

  test("the owner reads plan.private back whole", async () => {
    const token = await ownerToken();
    const id = "private-owner";
    const written = await tripWithPrivatePlan(id, token);
    expect(written.status, JSON.stringify(written.body)).toBe(200);

    const { status, body } = await getTrip(OWNER, id, token);
    expect(status).toBe(200);
    const plan = body.plan as Record<string, unknown>;
    expect(plan.private).toBeDefined();
    expect((plan.private as Record<string, unknown>).stops).toBeDefined();
  });

  test("a non-owner bearer and no credential both get no plan.private key", async () => {
    const owner = await ownerToken();
    const id = "private-guest";
    await tripWithPrivatePlan(id, owner);

    const scoped = await tripScopedToken(id);
    const asScoped = await getTrip(OWNER, id, scoped);
    expect(asScoped.status, JSON.stringify(asScoped.body)).toBe(200);
    expect(asScoped.body.plan).toBeDefined();
    expect(asScoped.body.plan).not.toHaveProperty("private");

    const noCred = await getTrip(OWNER, id, undefined);
    expect(noCred.status).toBe(401);
    expect(JSON.stringify(noCred.body)).not.toContain("private");
  });

  test("a private.stops id that is not in route is refused, naming it", async () => {
    const token = await ownerToken();
    const id = "private-bad-id";
    await putTrip(OWNER, id, fullTrip(id), token);

    const { status, body } = await patchTrip(
      OWNER,
      id,
      {
        plan: {
          route: [{ location: "Oslo", lat: 59.9139, lng: 10.7522 }],
          private: { stops: { "not-a-real-stop": { links: [{ label: "x", url: "https://example.test/x" }] } } },
        },
      },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_plan");
    expect(body.message).toContain("not-a-real-stop");
  });
});

describe("plan is a required-or-declined section", () => {
  test("emptying the route is refused by the schema's own minimum", async () => {
    const token = await ownerToken();
    const id = "plan-empty-route";
    await putTrip(OWNER, id, fullTrip(id), token);
    await patchTrip(OWNER, id, { plan: { route: [{ location: "Graz", lat: 47.0707, lng: 15.4395 }] } }, token);

    const { status, body } = await patchTrip(OWNER, id, { plan: { route: [] } }, token);
    expect(status, JSON.stringify(body)).toBe(400);
  });

  test("declining plan removes the stored route", async () => {
    const token = await ownerToken();
    const id = "plan-decline";
    await putTrip(OWNER, id, fullTrip(id), token);
    await patchTrip(OWNER, id, { plan: { route: [{ location: "Graz", lat: 47.0707, lng: 15.4395 }] } }, token);

    const { status, body } = await patchTrip(
      OWNER,
      id,
      { declined: { plan: "the route ended, nothing planned beyond this" } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.plan).toBeUndefined();
    expect((body.declined as Record<string, string>).plan).toBe("the route ended, nothing planned beyond this");
  });
});

describe("costs.items[].stop", () => {
  test("a preparation cost names a stop id and reads it back", async () => {
    const token = await ownerToken();
    const id = "cost-stop";
    const trip = fullTrip(id);
    const declined = { ...(trip.declined as Record<string, string>) };
    delete declined.costs;
    await putTrip(OWNER, id, { ...trip, costs: { note: "tracked from the start" }, declined }, token);
    await patchTrip(OWNER, id, { plan: { route: [{ location: "Turin", lat: 45.0703, lng: 7.6869 }] } }, token);
    const { status, body } = await patchTrip(
      OWNER,
      id,
      { costs: { items: [{ label: "Train tickets", amount: 40, stop: "turin" }] } },
      token,
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const items = (body.costs as { items: Record<string, unknown>[] }).items;
    expect(items[0].stop).toBe("turin");
  });
});
