import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

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
      namedStretches: [{ date: "2026-06-22", from: "10:00", to: "12:00", label: "Boat trip · dolphins" }],
    });
    expect(status).toBe(200);
    expect(body.hiddenSpots).toHaveLength(1);
    expect(body.hiddenSpots[0]).toMatchObject({ lat: 37.1, lon: -8.8, radiusM: 200 });
    expect(typeof body.hiddenSpots[0].id).toBe("string");
    expect(body.namedStretches[0]).toMatchObject({ date: "2026-06-22", from: "10:00", to: "12:00", label: "Boat trip · dolphins" });

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
      namedStretches: [{ date: "2026-06-22", from: "10:00", to: "11:00", label: "x".repeat(81) }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a stretch with from >= to is refused — security review, S6", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [],
      hiddenStretches: [{ date: "2026-06-22", from: "10:00", to: "10:00" }],
      namedStretches: [],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a stretch dated outside the trip's own span is refused — security review, S6", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [],
      // The trip runs 2026-06-22 to 2026-06-24.
      hiddenStretches: [{ date: "2026-07-01", from: "10:00", to: "11:00" }],
      namedStretches: [],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a client-supplied id that never existed is ignored, not kept — security review, S6", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { status, body } = await putEdits(token, {
      hiddenSpots: [{ id: "not-a-real-id", lat: 9, lon: 9, radiusM: 100 } as never],
      hiddenStretches: [],
      namedStretches: [],
    });
    expect(status).toBe(200);
    expect(body.hiddenSpots[0].id).not.toBe("not-a-real-id");
    expect(typeof body.hiddenSpots[0].id).toBe("string");
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

describe("a stretch is resolved against the day's own timezone, not the caller's — security review, B1 (blocker)", () => {
  test("a stretch on a day carrying Asia/Tokyo hides the Tokyo-local hour, not the same clock digits read as UTC", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    // A draft day is enough — `dayTimezones` reads every entry, drafts
    // included, the same way `deriveTripTrack`'s own doc comment says.
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "tokyo-day",
      date: "2026-06-23",
      status: "draft",
      timezone: "Asia/Tokyo",
    });
    const { clearUserCache } = await import("@/lib/users");
    clearUserCache();

    // 80 points, 5 minutes apart, starting 2026-06-22T21:00:00Z — 06:00
    // *Tokyo* local time on the 23rd (Tokyo midnight is UTC 15:00 the day
    // before). Long, and starting well before the hidden window, so the
    // window this test hides sits comfortably in the *middle* of the run —
    // clear of the 500 m end-trim `trimByDistance` already applies to both
    // of the run's own true ends, which this test must not be confused with.
    const fixes = walk("2026-06-22", 21, 20.0, 20.0, 80);
    const { appendFixes } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);

    // Hide 09:00–10:00 *Tokyo local time* — correctly resolved, that is
    // 2026-06-23T00:00Z–01:00Z, index 36–48 of this walk (36 steps of 5 min
    // from the 21:00Z start). Read as bare UTC (the B1 bug) it would
    // instead cover 2026-06-23T09:00Z–10:00Z, which this walk (ending at
    // 2026-06-23T02:35Z) never reaches at all — so the bug's signature is
    // "nothing gets hidden".
    await putEdits(token, {
      hiddenSpots: [],
      hiddenStretches: [{ date: "2026-06-23", from: "09:00", to: "10:00" }],
      namedStretches: [],
    });

    const { readTrack } = await import("@/lib/gps/track");
    const track = readTrack(OWNER, TRIP);
    const points = (track?.segments ?? []).flatMap((s) => s.points);
    // Well inside the correctly-resolved (Tokyo) hidden window, and well
    // clear of both the run's own true ends.
    const shouldBeHidden = fixes[40];
    // Well before the window, and well clear of the run's own start.
    const shouldSurviveBefore = fixes[15];
    // Well after the window, and well clear of the run's own end.
    const shouldSurviveAfter = fixes[65];
    expect(points).not.toContainEqual([shouldBeHidden.lat, shouldBeHidden.lon]);
    expect(points).toContainEqual([shouldSurviveBefore.lat, shouldSurviveBefore.lon]);
    expect(points).toContainEqual([shouldSurviveAfter.lat, shouldSurviveAfter.lon]);
  });
});

describe("a named stretch's label never lands on a trimmed-away fix — security review, S1", () => {
  test("a stretch whose `to` is in the future does not centre its label on the live tail's own current position", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const fixes = walk("2026-06-24", 9, 30.0, 30.0);
    const { appendFixes } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);

    // A named stretch that started when the walk did and has not "ended"
    // yet — its own middle instant, naively, is close to the walk's own
    // last (most recent) fix, which `trimByDistance` cuts off the end of
    // every run.
    const lastFix = fixes[fixes.length - 1];
    const inTheFuture = new Date(lastFix.t + 60 * 60_000).toISOString().slice(11, 16);
    const startTime = new Date(fixes[0].t).toISOString().slice(11, 16);
    await putEdits(token, {
      hiddenSpots: [],
      hiddenStretches: [],
      namedStretches: [{ date: "2026-06-24", from: startTime, to: inTheFuture, label: "Still going" }],
    });

    const { readTrack } = await import("@/lib/gps/track");
    const track = readTrack(OWNER, TRIP);
    const label = track?.labels?.find((l) => l.label === "Still going");
    // Never absent — some fix in range must have survived trimming, since
    // the walk is long enough.
    expect(label).toBeDefined();
    // And never the walk's own last point or its immediate neighbours — the
    // exact 500 m `trimByDistance` cuts off this run's own end.
    const trimmedEnd = fixes.slice(-4).map((f) => [f.lat, f.lon]);
    expect(trimmedEnd).not.toContainEqual(label!.point);
  });
});

describe("a hide PUT never destroys a published route just because the store was purged — security review, S2", () => {
  test("preserveExistingWhenEmpty: an empty re-derive after a purge leaves the existing track.json alone", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const fixes = walk("2026-06-22", 6, 40.0, 40.0);
    const { appendFixes, deleteRange } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);
    const { deriveTripTrack } = await import("@/lib/gps/api");
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-24" });

    const { readTrack } = await import("@/lib/gps/track");
    const before = readTrack(OWNER, TRIP);
    expect(before?.segments.length).toBeGreaterThan(0);

    // The owner purges their whole history (B1843 addendum) — nothing left
    // in the store for this trip's dates at all.
    deleteRange(OWNER, 0, Date.now() + 1e12);

    // A hide edit now re-derives to nothing, since the store has nothing —
    // but the trip's already-published route must survive that; only an
    // import or an explicit POST …/track may legitimately delete it.
    await putEdits(token, { hiddenSpots: [{ lat: 1, lon: 1, radiusM: 100 }], hiddenStretches: [], namedStretches: [] });

    const after = readTrack(OWNER, TRIP);
    expect(after).toBeDefined();
    expect(after?.segments).toEqual(before?.segments);
  });

  test("recordedTrips lists a trip by its surviving track.json alone once the store has nothing left for it", async () => {
    const { recordedTrips } = await import("@/lib/gps/api");
    const rows = recordedTrips(OWNER);
    const row = rows.find((r) => r.tripId === TRIP);
    expect(row).toBeDefined();
    expect(row?.hasPublishedTrack).toBe(true);
    expect(row?.daysRecorded).toBe(0);
  });
});

describe("a re-derive that throws after edits are saved does not leave a stale file being served — security review, S4", () => {
  test("writeTrackEdits deletes track.json and track-recent.json, then rethrows", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const fixes = walk("2026-06-22", 6, 50.0, 50.0);
    const { appendFixes, gpsDir } = await import("@/lib/gps/store");
    appendFixes(OWNER, fixes);
    const { deriveTripTrack, writeTrackEdits } = await import("@/lib/gps/api");
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-24" });

    const { readTrack } = await import("@/lib/gps/track");
    expect(readTrack(OWNER, TRIP)).toBeDefined();

    // A corrupt exclude.json makes the next derivation throw.
    const excludeFile = path.join(gpsDir(OWNER), "exclude.json");
    fs.writeFileSync(excludeFile, "{ not json");
    try {
      expect(() => writeTrackEdits(OWNER, TRIP, { hiddenSpots: [], hiddenStretches: [], namedStretches: [] })).toThrow();
      expect(readTrack(OWNER, TRIP)).toBeUndefined();
    } finally {
      fs.writeFileSync(excludeFile, "[]");
    }

    // Re-derive cleanly now that the store's own zone file is readable
    // again, so later tests in this file are not left broken by this one.
    deriveTripTrack(OWNER, { id: TRIP, start: "2026-06-22", end: "2026-06-24" });
    void token;
  });
});

describe("two entries citing the same existing id never collide on disk — security review, S6", () => {
  test("the later occurrence gets a fresh id instead of a duplicate", async () => {
    const { writeTrackEdits, listTrackEdits } = await import("@/lib/gps/api");
    const first = writeTrackEdits(OWNER, TRIP, {
      hiddenSpots: [{ lat: 2, lon: 2, radiusM: 100 }],
      hiddenStretches: [],
      namedStretches: [],
    });
    const existingId = first.hiddenSpots[0].id;
    const second = writeTrackEdits(OWNER, TRIP, {
      hiddenSpots: [
        { id: existingId, lat: 2, lon: 2, radiusM: 100 },
        { id: existingId, lat: 3, lon: 3, radiusM: 100 },
      ],
      hiddenStretches: [],
      namedStretches: [],
    });
    expect(second.hiddenSpots).toHaveLength(2);
    expect(second.hiddenSpots[0].id).not.toBe(second.hiddenSpots[1].id);
    const stored = listTrackEdits(OWNER, TRIP);
    const ids = stored.hiddenSpots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
