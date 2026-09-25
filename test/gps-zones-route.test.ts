import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * Private zones over the network — B2203.
 *
 * `content/<user>/gps/exclude.json` was documented as something only a shell
 * could write, and a hosted owner has no shell on the machine this runs on.
 * `GET`/`PUT /api/v2/{user}/gps/zones` is that door: who may reach it, and
 * that a zone the owner set is actually removed from a derived track,
 * matters more here than the happy path.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const BUDDY_EMAIL = "buddy@example.test";
const TRIP = "algarve-2026";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.8.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string, trip?: string, scope?: string): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(
    OWNER,
    email,
    code,
    "agent",
    scope ?? (trip ? tripWriteScope(trip) : undefined),
  );
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

async function getZones(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/gps/zones/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/gps/zones`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return {
    status: response.status,
    body: await response.json(),
    etag: response.headers.get("etag"),
    cacheControl: response.headers.get("cache-control"),
  };
}

/**
 * `ifMatch` mirrors what a well-behaved client does: read first, send the
 * ETag back. `undefined` (the default every existing call below uses) fetches
 * the current one automatically, so most of this suite reads exactly as it
 * did before optimistic concurrency existed. `null` sends no `If-Match` at
 * all, and any other string sends that literal value — both for the
 * conflict tests below.
 */
async function putZones(token: string, body: Record<string, unknown>, ifMatch?: string | null) {
  const { PUT } = await import("@/app/api/v2/[user]/gps/zones/route");
  const current = ifMatch === null ? null : (ifMatch ?? (await getZones(token)).etag);
  const response = await PUT(
    new Request(`https://example.test/api/v2/${OWNER}/gps/zones`, {
      method: "PUT",
      headers: headers({
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(current ? { "if-match": current } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return {
    status: response.status,
    body: await response.json(),
    etag: response.headers.get("etag"),
    cacheControl: response.headers.get("cache-control"),
  };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-zones-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

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

describe("GET/PUT /api/v2/{user}/gps/zones", { shuffle: false }, () => {
  test("GET starts empty, with the limits a caller needs before it hits them", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await getZones(token);
    expect(status).toBe(200);
    expect(body.zones).toEqual([]);
    expect(body.homeDeclined).toBe(false);
    expect(body.limits).toEqual({ maxZones: 20, radiusM: { min: 50, max: 5000 } });
  });

  test("PUT writes a zone, and GET reads back exactly what PUT accepted", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const zone = { label: "Home", lat: 47.38564, lon: 8.21819, radiusM: 500 };
    const { status, body } = await putZones(token, { zones: [zone] });
    expect(status).toBe(200);
    expect(body.zones).toEqual([zone]);

    const read = await getZones(token);
    expect(read.body.zones).toEqual([zone]);
  });

  test("a radius outside the discoverable bounds is refused, not silently clamped", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putZones(token, {
      zones: [{ label: "Too small", lat: 1, lon: 1, radiusM: 10 }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("homeDeclined round-trips, and a PUT of zones alone does not silently undo it", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const declined = await putZones(token, { zones: [], homeDeclined: true });
    expect(declined.body.homeDeclined).toBe(true);

    const kept = await putZones(token, { zones: [{ label: "Office", lat: 2, lon: 2, radiusM: 200 }] });
    expect(kept.body.homeDeclined).toBe(true);
  });

  test("a trip-scoped token is refused — a zone is journal-wide, not one trip's", async () => {
    const buddy = await tokenFor(BUDDY_EMAIL, TRIP);
    const get = await getZones(buddy);
    expect(get.status).toBe(403);
    expect(get.body.error).toBe("forbidden");

    const put = await putZones(buddy, { zones: [] });
    expect(put.status).toBe(403);
    expect(put.body.error).toBe("forbidden");
  });

  test("a guest session is refused — it is a cookie kind, not an agent bearer token", async () => {
    const token = await guestToken();
    const { status, body } = await getZones(token);
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  test("a narrower agent scope than the journal-wide one is refused, the same as write:gps would be", async () => {
    // B2204 adds a real `write:gps` scope for the recorder; whatever string
    // it lands on, `requireJournalOwner`'s gate is `isJournalWideScope`,
    // which only ever answers `true` for the one journal-wide scope agent
    // tokens are minted with. Any other scope string is refused the same
    // way — asserted here against a synthetic one so this test does not
    // have to wait on that ticket to exist.
    const token = await tokenFor(OWNER_EMAIL, undefined, "write:gps");
    const { status, body } = await getZones(token);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("PUT with no If-Match is refused — optimistic concurrency, security review 2026-09-24", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putZones(token, { zones: [] }, null);
    expect(status).toBe(409);
    expect(body.error).toBe("stale_document");
    // The refusal carries the document actually on disk, so a caller can
    // read it and retry with a matching If-Match.
    expect(body.details).toMatchObject({ zones: expect.any(Array), homeDeclined: expect.any(Boolean) });
  });

  test("PUT with a stale If-Match is refused, a fresh one is accepted", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const stale = await putZones(token, { zones: [{ label: "Stale", lat: 4, lon: 4, radiusM: 100 }] }, '"0000000000000000000000000000ff"');
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale_document");

    // The default (no third argument) reads the current ETag first, then
    // sends it — a fresh If-Match goes through.
    const fresh = await putZones(token, { zones: [{ label: "Fresh", lat: 5, lon: 5, radiusM: 100 }] });
    expect(fresh.status).toBe(200);
    expect(fresh.body.zones).toEqual([{ label: "Fresh", lat: 5, lon: 5, radiusM: 100 }]);
  });

  test("GET and PUT both answer Cache-Control: no-store", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const get = await getZones(token);
    expect(get.cacheControl).toBe("no-store");

    const put = await putZones(token, { zones: [] });
    expect(put.cacheControl).toBe("no-store");
  });

  test("an unreadable zones file answers 500 with a fixed message, never a filesystem path", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { gpsDir } = await import("@/lib/gps/store");
    const file = path.join(gpsDir(OWNER), "exclude.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    try {
      const { status, body } = await getZones(token);
      expect(status).toBe(500);
      expect(body.error).toBe("unreadable_zones");
      expect(body.message).not.toContain(dir);
      expect(body.message).not.toContain(".json");
    } finally {
      fs.writeFileSync(file, "[]");
    }
  });
});

describe("hasHomeZoneOrDeclined — the arming question B2196/B2198 will ask", () => {
  test("false with neither a home zone nor a decline", async () => {
    const { hasHomeZoneOrDeclined } = await import("@/lib/gps/api");
    expect(hasHomeZoneOrDeclined("nobody-yet")).toBe(false);
  });

  test("true once any zone is saved, whatever it is called", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    await putZones(token, { zones: [{ label: "Zuhause", lat: 3, lon: 3, radiusM: 100 }] });
    const { hasHomeZoneOrDeclined } = await import("@/lib/gps/api");
    expect(hasHomeZoneOrDeclined(OWNER)).toBe(true);
  });

  test("true once the owner has declined, even with no zone at all", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    await putZones(token, { zones: [], homeDeclined: true });
    const { hasHomeZoneOrDeclined } = await import("@/lib/gps/api");
    expect(hasHomeZoneOrDeclined(OWNER)).toBe(true);
  });
});

describe("a home zone actually clips the derived track", () => {
  test("a fix inside the zone's radius does not survive to trips/<trip>/track.json", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    // The front door, right at the trip's first morning.
    const home = { label: "Home", lat: 47.38564, lon: 8.21819, radiusM: 500 };
    await putZones(token, { zones: [home] });

    const { appendFixes } = await import("@/lib/gps/store");
    const { deriveTripTrack } = await import("@/lib/gps/api");
    appendFixes(OWNER, [
      // At home — must be clipped.
      { t: Date.parse("2026-06-22T06:00:00Z"), lat: 47.38564, lon: 8.21819 },
      // A walk well away from home, long enough to outlast B2202's 500 m
      // trim at both of its ends — must survive.
      ...Array.from({ length: 20 }, (_, i) => ({
        t: Date.parse("2026-06-22T09:00:00Z") + i * 5 * 60_000,
        lat: 47.4 + i * 0.002,
        lon: 8.24,
      })),
    ]);
    const outcome = deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-24" });
    expect(outcome.written).toBe(true);

    const { readTrack } = await import("@/lib/gps/track");
    const track = readTrack(OWNER, TRIP);
    const points = (track?.segments ?? []).flatMap((s) => s.points);
    for (const [lat, lon] of points) {
      const metres =
        Math.hypot(lat - home.lat, (lon - home.lon) * Math.cos((home.lat * Math.PI) / 180)) * 111_320;
      expect(metres).toBeGreaterThan(home.radiusM);
    }
    expect(points.length).toBeGreaterThan(0);
  });
});
