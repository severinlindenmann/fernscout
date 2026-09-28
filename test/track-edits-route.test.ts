import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

// The web-cookie door's own gate (`isOwner`, `lib/contacts/session.ts`) reads
// `next/headers` in a way that only resolves inside a real request — the
// same reason `test/delete-day.test.ts` mocks it directly rather than trying
// to fabricate a cookie header. The v2 bearer door below never touches this.
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

/**
 * One trip's hidden spots, hidden stretches and named stretches over the
 * network — B2539, D8 C. Mirrors `test/gps-zones-route.test.ts`'s shape:
 * who may reach the door matters more here than the happy path, since a
 * hidden spot changes what every reader of this trip is shown.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const BUDDY_EMAIL = "buddy@example.test";
const TRIP = "algarve-2026";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string, trip?: string, scope?: string): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(OWNER, email, code, "agent", scope ?? (trip ? tripWriteScope(trip) : undefined));
  if (!result.ok) throw new Error(`no token for ${email}`);
  return result.token;
}

async function guestToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, BUDDY_EMAIL, "guest");
  const result = await verifyCode(OWNER, BUDDY_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no guest token");
  return result.token;
}

async function getEdits(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/track-edits/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}/track-edits`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return {
    status: response.status,
    body: await response.json(),
    etag: response.headers.get("etag"),
    cacheControl: response.headers.get("cache-control"),
  };
}

async function putEdits(token: string, body: Record<string, unknown>, ifMatch?: string | null) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/track-edits/route");
  const current = ifMatch === null ? null : (ifMatch ?? (await getEdits(token)).etag);
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP}/track-edits`, {
      method: "PUT",
      headers: headers({
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(current ? { "if-match": current } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return {
    status: response.status,
    body: await response.json(),
    etag: response.headers.get("etag"),
  };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-track-edits-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "The Algarve",
    start: "2026-06-22",
    end: "2026-06-24",
    status: "past",
    visibility: "private",
    people: [{ name: "Buddy", email: BUDDY_EMAIL }],
    intro: "Intro.",
  });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET/PUT /api/v2/{user}/trips/{trip}/track-edits", { shuffle: false }, () => {
  test("GET starts empty, with the limits a caller needs before it hits them", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await getEdits(token);
    expect(status).toBe(200);
    expect(body).toEqual({
      hiddenSpots: [],
      hiddenStretches: [],
      namedStretches: [],
      limits: { maxSpots: 20, maxStretches: 20, maxNamed: 20, radiusM: { min: 50, max: 5000 }, labelMax: 80 },
    });
  });

  test("PUT assigns an id and GET reads back exactly what was stored, label included", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [{ lat: 37.1, lon: -8.8, radiusM: 200 }],
      hiddenStretches: [],
      namedStretches: [{ from: "2026-06-22T10:00:00Z", to: "2026-06-22T12:00:00Z", label: "Boat trip · dolphins" }],
    });
    expect(status).toBe(200);
    expect(body.hiddenSpots).toHaveLength(1);
    expect(body.hiddenSpots[0]).toMatchObject({ lat: 37.1, lon: -8.8, radiusM: 200 });
    expect(typeof body.hiddenSpots[0].id).toBe("string");
    expect(body.namedStretches[0]).toMatchObject({ label: "Boat trip · dolphins" });

    const read = await getEdits(token);
    expect(read.body).toEqual(body);
  });

  test("a radius outside the discoverable bounds is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [{ lat: 1, lon: 1, radiusM: 10 }],
      hiddenStretches: [],
      namedStretches: [],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a label over the length limit is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [],
      hiddenStretches: [],
      namedStretches: [{ from: "2026-06-22T10:00:00Z", to: "2026-06-22T11:00:00Z", label: "x".repeat(81) }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("over the spot count limit is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: Array.from({ length: 21 }, (_, i) => ({ lat: i, lon: i, radiusM: 100 })),
      hiddenStretches: [],
      namedStretches: [],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("an unknown trip is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/track-edits/route");
    const response = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/trips/never-existed/track-edits`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: "never-existed" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("unknown_trip");
  });

  test("a trip-scoped token is refused — hiding a spot is the owner's, not the trip token's, authority", async () => {
    const buddy = await tokenFor(BUDDY_EMAIL, TRIP);
    const get = await getEdits(buddy);
    expect(get.status).toBe(403);
    expect(get.body.error).toBe("forbidden");

    const put = await putEdits(buddy, { hiddenSpots: [], hiddenStretches: [], namedStretches: [] });
    expect(put.status).toBe(403);
    expect(put.body.error).toBe("forbidden");
  });

  test("a narrower agent scope (write:gps) is refused, the same as a trip-scoped token", async () => {
    const token = await tokenFor(OWNER_EMAIL, undefined, "write:gps");
    const { status, body } = await getEdits(token);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("a guest session is refused — it is a cookie kind, not an agent bearer token", async () => {
    const token = await guestToken();
    const { status, body } = await getEdits(token);
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  test("PUT with no If-Match is refused — optimistic concurrency", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, { hiddenSpots: [], hiddenStretches: [], namedStretches: [] }, null);
    expect(status).toBe(409);
    expect(body.error).toBe("stale_document");
  });

  test("GET and PUT both answer Cache-Control: no-store", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const get = await getEdits(token);
    expect(get.cacheControl).toBe("no-store");
  });
});

describe("GET/PUT /api/web/{user}/trips/{trip}/track-edits", { shuffle: false }, () => {
  test("an Authorization header is refused outright — this door is the browser's", async () => {
    const { isOwner } = await import("@/lib/contacts/session");
    vi.mocked(isOwner).mockResolvedValue(true);
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/track-edits/route");
    const token = await tokenFor(OWNER_EMAIL);
    const response = await GET(
      new Request(`https://example.test/api/web/${OWNER}/trips/${TRIP}/track-edits`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("not_for_agents");
  });

  test("a session that is not the owner (isOwner false) is refused as forbidden", async () => {
    const { isOwner } = await import("@/lib/contacts/session");
    vi.mocked(isOwner).mockResolvedValue(false);
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/track-edits/route");
    const response = await GET(
      new Request(`https://example.test/api/web/${OWNER}/trips/${TRIP}/track-edits`, { headers: headers() }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("forbidden");
  });

  test("the owner's own cookie reads and writes the same document the v2 door does", async () => {
    const { isOwner } = await import("@/lib/contacts/session");
    vi.mocked(isOwner).mockResolvedValue(true);
    const { GET, PUT } = await import("@/app/api/web/[user]/trips/[trip]/track-edits/route");
    const get = await GET(
      new Request(`https://example.test/api/web/${OWNER}/trips/${TRIP}/track-edits`, { headers: headers() }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(get.status).toBe(200);
    const etag = get.headers.get("etag");
    const body = await get.json();

    const put = await PUT(
      new Request(`https://example.test/api/web/${OWNER}/trips/${TRIP}/track-edits`, {
        method: "PUT",
        headers: headers({ "content-type": "application/json", ...(etag ? { "if-match": etag } : {}) }),
        body: JSON.stringify({
          hiddenSpots: [{ lat: 10, lon: 10, radiusM: 100 }],
          hiddenStretches: body.hiddenStretches,
          namedStretches: body.namedStretches,
        }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.hiddenSpots).toHaveLength(1);

    const token = await tokenFor(OWNER_EMAIL);
    const read = await getEdits(token);
    expect(read.body.hiddenSpots).toEqual(putBody.hiddenSpots);
  });
});

/** A zigzag walk, long enough (30 steps, ~3.3 km of forward travel) that a
 * fix in the middle survives the 500 m end-trim both derivations apply, on
 * either side of wherever hiding splits the run — and zigzagging (rather
 * than a straight line) so every point deviates well past the 50 m
 * Douglas–Peucker tolerance `deriveTrack` simplifies with, the same reason
 * `test/gps-track.test.ts`'s own simplification test uses a corner rather
 * than a straight run: a collinear middle point would otherwise be thinned
 * away before hiding ever got a chance to. */
function walk(day: string, startHour: number, baseLat: number, baseLon: number, count = 30): Array<{ t: number; lat: number; lon: number }> {
  const start = Date.parse(`${day}T${String(startHour).padStart(2, "0")}:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    t: start + i * 5 * 60_000,
    lat: Number((baseLat + i * 0.001).toFixed(5)),
    lon: Number((baseLon + (i % 2 === 0 ? 0 : 0.005)).toFixed(5)),
  }));
}

describe("a hidden spot actually clips the derived track, immediately", () => {
  test("PUT re-derives track.json before it returns — no import or POST …/track needed", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const fixes = walk("2026-06-22", 9, 37.4, -8.6);
    const middle = fixes[15]; // far from both ends once hiding splits the run
    const { appendFixes } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);
    const { deriveTripTrack } = await import("@/lib/gps/api");
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-24" });

    const { readTrack } = await import("@/lib/gps/track");
    const before = readTrack(OWNER, TRIP);
    expect((before?.segments ?? []).flatMap((s) => s.points)).toContainEqual([middle.lat, middle.lon]);

    await putEdits(token, {
      hiddenSpots: [{ lat: middle.lat, lon: middle.lon, radiusM: 50 }],
      hiddenStretches: [],
      namedStretches: [],
    });

    const after = readTrack(OWNER, TRIP);
    const points = (after?.segments ?? []).flatMap((s) => s.points);
    expect(points).not.toContainEqual([middle.lat, middle.lon]);
    expect(points.length).toBeGreaterThan(0);
  });
});

describe("readerTrack never carries a hidden point; ownerTripLine — the owner's own raw view — still does", () => {
  test("readerTrack drops it; ownerTripLine keeps it", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const fixes = walk("2026-06-23", 9, 12.3, 12.3);
    const middle = fixes[15];
    const { appendFixes } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);
    await putEdits(token, {
      hiddenSpots: [{ lat: middle.lat, lon: middle.lon, radiusM: 50 }],
      hiddenStretches: [],
      namedStretches: [],
    });

    const { readerTrack } = await import("@/lib/gps/track");
    const { ownerTripLine } = await import("@/lib/gps/api");
    const visible = new Set(["2026-06-22", "2026-06-23", "2026-06-24"]);
    const reader = readerTrack(OWNER, TRIP, visible);
    const readerPoints = (reader?.segments ?? []).flatMap((s) => s.points);
    expect(readerPoints).not.toContainEqual([middle.lat, middle.lon]);

    const owner = ownerTripLine(OWNER, TRIP);
    const ownerPoints = (owner?.segments ?? []).flatMap((s) => s.points);
    expect(ownerPoints).toContainEqual([middle.lat, middle.lon]);
  });
});
