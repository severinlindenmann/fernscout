import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { appendFixes, gpsDir, metresBetween } from "@/lib/gps/store";
import { deriveTripTrack, purgeGpsHistory, writeZones } from "@/lib/gps/api";
import { liveTailStatus, readTail, readTrack, readerTrack, writeTail } from "@/lib/gps/track";
import { writeExcludeZones } from "@/lib/gps/enrich";
import { writeTripFixture } from "./fixtures/content";
import type { Fix } from "@/importers/gps/schema";

/** Every cookie the mocked `next/headers` hands back — used by the
 * `mayReadLiveTrack` describe block below only, same shape as
 * `test/access-gate.test.ts`'s own jar. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
  }),
}));

/**
 * B2536 — who sees where the owner was less than 24h ago.
 *
 * Keyed on the trip's own visibility (D6, `lib/tripGate.ts`'s
 * `mayReadLiveTrack`): a `public` trip is never live for anyone but the
 * journal's real owner (never the instance operator); a `guest` trip is
 * live by default, or 24h-late for everyone once the trip's own
 * `guestsLive` is `false`; a `private` trip is live for the travellers who
 * were there. A bearer token, any scope: never — no route under `/api/**`
 * ever calls `readerTrack` with `live: true`, `track-recent.json` is
 * excluded from the sync manifest (`lib/sync/manifest.ts`) and from every
 * export (`lib/exportZip.ts`), and a stale tail (derived more than 24h ago)
 * is refused regardless of who is asking.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "oma@example.test";
const ROBIN_EMAIL = "robin@example.test";
const STRANGER_EMAIL = "anyone@example.test";

let dir: string;

function config() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

/** A run long enough to survive a 500 m end-trim, ending at `endMs`. */
function recentWalk(endMs: number, lat: number, lonBase: number): Fix[] {
  return Array.from({ length: 30 }, (_, i) => ({
    t: endMs - (29 - i) * 60_000,
    lat,
    lon: lonBase + i * 0.001,
  }));
}

describe("the derived tail — B2536", () => {
  const TRIP = "algarve-2026";
  const now = Date.now();
  // Wide enough to hold both an "old" run (> 24h ago, in track.json) and a
  // "recent" one (< 24h ago, in track-recent.json) regardless of what time
  // of day the suite happens to run.
  const START_DATE = new Date(now - 30 * 3600_000).toISOString().slice(0, 10);
  const END_DATE = new Date(now).toISOString().slice(0, 10);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tail-"));
    process.env.CONTENT_DIR = dir;
    config();
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();
    writeTripFixture(OWNER, {
      id: TRIP,
      start: START_DATE,
      end: END_DATE,
      visibility: "guest",
      listed: false,
      people: [{ name: "Robin", email: ROBIN_EMAIL }],
      intro: "x",
    });
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("track.json never carries a point younger than 24h, and readerTrack(live=false) never returns one", () => {
    const old = recentWalk(now - 26 * 3600_000, 37.1, -8.5);
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, [...old, ...recent]);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const track = readTrack(OWNER, TRIP);
    expect(track).toBeDefined();
    const lats = track!.segments.flatMap((s) => s.points.map(([lat]) => lat));
    // Only the old run's latitude band ever reaches track.json.
    expect(lats.some((lat) => Math.abs(lat - 37.9) < 0.05)).toBe(false);

    const visibleDates = new Set(track!.segments.map((s) => s.day).filter((d): d is string => !!d));
    const publicView = readerTrack(OWNER, TRIP, visibleDates, false);
    const publicLats = publicView!.segments.flatMap((s) => s.points.map(([lat]) => lat));
    expect(publicLats.some((lat) => Math.abs(lat - 37.9) < 0.05)).toBe(false);
  });

  test("readerTrack(live=true) adds the tail's own points", () => {
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const tail = readTail(OWNER, TRIP);
    expect(tail).toBeDefined();

    const visibleDates = new Set(tail!.segments.map((s) => s.day).filter((d): d is string => !!d));
    expect(readerTrack(OWNER, TRIP, visibleDates, false)).toBeUndefined();
    const live = readerTrack(OWNER, TRIP, visibleDates, true);
    const lats = live!.segments.flatMap((s) => s.points.map(([lat]) => lat));
    expect(lats.some((lat) => Math.abs(lat - 37.9) < 0.05)).toBe(true);
  });

  test("liveTailStatus reports minutesAgo only once a tail segment actually survives for this reader's visible dates", () => {
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const tail = readTail(OWNER, TRIP);
    expect(tail).toBeDefined();
    const tailDates = new Set(tail!.segments.map((s) => s.day).filter((d): d is string => !!d));

    // The real dates: a status.
    const visible = liveTailStatus(OWNER, TRIP, tailDates);
    expect(visible).toBeDefined();
    expect(visible!.minutesAgo).toBeGreaterThanOrEqual(0);
    expect(visible!.minutesAgo).toBeLessThan(5);

    // A reader shown no date the tail's own segments carry (e.g. no day
    // written for today yet) — undefined, never a stray badge with nothing
    // under it.
    expect(liveTailStatus(OWNER, TRIP, new Set(["1999-01-01"]))).toBeUndefined();
  });

  test("readerTrack(live=true) drops a stale tail, and liveTailStatus reports nothing for it — never a stale \"N min ago\"", () => {
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const tail = readTail(OWNER, TRIP)!;
    const visibleDates = new Set(tail.segments.map((s) => s.day).filter((d): d is string => !!d));
    // The trip's own store still has a tail file, but nothing has
    // re-derived it in (say) two days — the file itself has aged out of
    // "the last 24h" even though nothing on disk changed.
    writeTail(OWNER, TRIP, { ...tail, generated: new Date(now - 25 * 3600_000).toISOString() });

    expect(readerTrack(OWNER, TRIP, visibleDates, true)).toBeUndefined();
    expect(liveTailStatus(OWNER, TRIP, visibleDates)).toBeUndefined();
  });

  test("the tail carries no point inside a private zone", () => {
    // Sixty points, ~170m apart (~10km end to end) — long enough that each
    // half, after the zone cut AND the 500m end-trim, still has points left
    // to assert on.
    const anchorMs = now - 60 * 60_000;
    const lonBase = -9;
    const recent: Fix[] = Array.from({ length: 60 }, (_, i) => ({
      t: anchorMs + i * 60_000,
      lat: 40,
      lon: lonBase + i * 0.002,
    }));
    const zoneLon = lonBase + 30 * 0.002; // dead centre of the run.
    writeExcludeZones(OWNER, [{ label: "home", lat: 40, lon: zoneLon, radiusM: 400 }]);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const tail = readTail(OWNER, TRIP);
    expect(tail).toBeDefined();
    const points = tail!.segments.flatMap((s) => s.points);
    expect(points.length).toBeGreaterThan(0);
    const zone = { t: 0, lat: 40, lon: zoneLon };
    for (const [lat, lon] of points) {
      expect(metresBetween(zone, { t: 0, lat, lon })).toBeGreaterThan(400);
    }
  });

  test("the tail is trimmed 500m from both ends of the raw run — the newest point is never the live position", () => {
    const anchorMs = now - 60_000; // "right now", almost
    const recent = recentWalk(anchorMs, 41, 2);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    const tail = readTail(OWNER, TRIP);
    expect(tail).toBeDefined();
    const first = { t: 0, lat: recent[0].lat, lon: recent[0].lon };
    const last = { t: 0, lat: recent[recent.length - 1].lat, lon: recent[recent.length - 1].lon };
    for (const segment of tail!.segments) {
      for (const [lat, lon] of segment.points) {
        expect(metresBetween(first, { t: 0, lat, lon })).toBeGreaterThanOrEqual(500);
        expect(metresBetween(last, { t: 0, lat, lon })).toBeGreaterThanOrEqual(500);
      }
    }
  });

  // B2610 — this walk (lat 41 / lon 2, UTC+2) must survive the tail
  // regardless of what time of day the suite runs. Pinned, rather than
  // left to the real wall clock: `test.each` below used to fail only
  // between 22:00 and 24:00 UTC, because at lat 41 / lon 2 the local date
  // has already rolled over to tomorrow while `trip.end`'s own window (one
  // local midnight to the next) still ends two hours earlier, inside
  // today's own UTC calendar date. 10:00Z has no such edge and must keep
  // passing exactly as before.
  test.each([
    ["22:33 UTC — local midnight already passed in UTC+2", "2026-09-30T22:33:00.000Z"],
    ["10:00 UTC — well inside the UTC day, no timezone edge", "2026-09-30T10:00:00.000Z"],
  ])("the tail survives a walk at lat 41 / lon 2 pinned at %s", (_label, iso) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(iso));
      const pinnedNow = Date.now();
      const start = new Date(pinnedNow - 30 * 3600_000).toISOString().slice(0, 10);
      const end = new Date(pinnedNow).toISOString().slice(0, 10);
      const edgeTrip = "edge-2026";
      writeTripFixture(OWNER, {
        id: edgeTrip,
        start,
        end,
        visibility: "guest",
        listed: false,
        people: [{ name: "Robin", email: ROBIN_EMAIL }],
        intro: "x",
      });
      const anchorMs = pinnedNow - 60_000; // "right now", almost
      const recent = recentWalk(anchorMs, 41, 2);
      appendFixes(OWNER, recent);
      deriveTripTrack(OWNER, { id: edgeTrip, start, end });

      const tail = readTail(OWNER, edgeTrip);
      expect(tail).toBeDefined();
      const points = tail!.segments.flatMap((s) => s.points);
      expect(points.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no fix at all leaves both files absent, never stale", () => {
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });
    expect(readTrack(OWNER, TRIP)).toBeUndefined();
    expect(readTail(OWNER, TRIP)).toBeUndefined();
  });

  test("purgeGpsHistory deletes the tail immediately — the live dot must not survive a purge", () => {
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });
    expect(readTail(OWNER, TRIP)).toBeDefined();

    purgeGpsHistory(OWNER, { all: true });

    expect(readTail(OWNER, TRIP)).toBeUndefined();
  });

  test("writeZones deletes every trip's tail immediately — a fresh zone must not wait for the next import to take effect on the live dot", () => {
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, recent);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });
    expect(readTail(OWNER, TRIP)).toBeDefined();

    writeZones(OWNER, [{ label: "home", lat: 37.9, lon: -8.9, radiusM: 500 }]);

    expect(readTail(OWNER, TRIP)).toBeUndefined();
  });

  test("deleting content/<user>/gps/ entirely leaves both derived files, and the trip, rendering exactly as before", () => {
    const old = recentWalk(now - 26 * 3600_000, 37.1, -8.5);
    const recent = recentWalk(now - 2 * 60_000, 37.9, -8.9);
    appendFixes(OWNER, [...old, ...recent]);
    deriveTripTrack(OWNER, { id: TRIP, start: START_DATE, end: END_DATE });

    expect(readTrack(OWNER, TRIP)).toBeDefined();
    expect(readTail(OWNER, TRIP)).toBeDefined();

    fs.rmSync(gpsDir(OWNER), { recursive: true, force: true });

    // Both derived files are their own artefacts, exactly like `track.json`
    // always was — deleting the private store changes nothing about what a
    // trip already derived from it.
    expect(readTrack(OWNER, TRIP)).toBeDefined();
    expect(readTail(OWNER, TRIP)).toBeDefined();
  });
});

/**
 * Who actually gets `live: true` — the session-level half of the same
 * question, mirroring `test/access-gate.test.ts`'s own scaffolding.
 */
describe("mayReadLiveTrack — B2536", () => {
  const LIVE_ON = "live-on-2026";
  const LIVE_OFF = "live-off-2026";
  const PUBLIC_TRIP = "public-2026";
  const PRIVATE_TRIP = "private-2026";
  const ADMIN_EMAIL = "operator@example.test";
  const tokens: Record<string, string | null> = { anonymous: null };

  function as(viewer: string) {
    jar.cookies = {};
    const token = tokens[viewer];
    if (token) jar.cookies.fs_session = token;
  }

  async function signIn(email: string): Promise<string> {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, email, "guest");
    const session = await verifyCode(OWNER, email, code, "guest");
    if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
    return session.token;
  }

  async function addApprovedContact(email: string) {
    const { confirmContact, requestContact, approveContact, listContacts } = await import("@/lib/contacts");
    const { issueCode } = await import("@/lib/auth");
    await requestContact(OWNER, {
      name: "Reader",
      email,
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "owner",
    });
    const { code } = await issueCode(OWNER, email, "guest");
    const confirmed = await confirmContact(OWNER, email, code);
    if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
    const contact = (await listContacts(OWNER)).find((c) => c.email === email);
    if (!contact) throw new Error(`no contact for ${email}`);
    await approveContact(OWNER, contact.id);
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-live-gate-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
    process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
    process.env.SESSION_SECRET = "55".repeat(32);
    // B2536 item 6 — the operator address owns every journal (`isOwner`
    // answers yes for it, B480), and `mayReadLiveTrack` must refuse it
    // anyway: an instance operator must not see where every journal's real
    // owner physically is by opening their trip.
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    config();

    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();

    writeTripFixture(OWNER, {
      id: LIVE_ON,
      start: "2026-08-25",
      end: "2026-08-26",
      visibility: "guest",
      listed: false,
      people: [{ name: "Robin", email: ROBIN_EMAIL }],
      intro: "x",
      // Absent — reads as live, the default.
    });
    writeTripFixture(OWNER, {
      id: LIVE_OFF,
      start: "2026-08-25",
      end: "2026-08-26",
      visibility: "guest",
      listed: false,
      people: [{ name: "Robin", email: ROBIN_EMAIL }],
      intro: "x",
      guestsLive: false,
    });
    writeTripFixture(OWNER, {
      id: PUBLIC_TRIP,
      start: "2026-08-25",
      end: "2026-08-26",
      visibility: "public",
      listed: true,
      people: [{ name: "Robin", email: ROBIN_EMAIL }],
      intro: "x",
      guestsLive: true, // even set true, a public trip is 24h-late for everyone but the owner.
    });
    writeTripFixture(OWNER, {
      id: PRIVATE_TRIP,
      start: "2026-08-25",
      end: "2026-08-26",
      visibility: "private",
      people: [{ name: "Robin", email: ROBIN_EMAIL }],
      intro: "x",
    });

    await addApprovedContact(GUEST_EMAIL);

    // A `people:` byline grants nothing since D3 (B2297) — being "on the
    // trip" means holding a granted `trip_people` place, the same mechanism
    // the owner's Readers page uses for a buddy. `addApprovedContact` makes
    // Robin a contact and approves the journal-wide grant; `claimTripPlace`
    // + `approveTripPlaces` is the trip-scoped place on top of it.
    await addApprovedContact(ROBIN_EMAIL);
    const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
    const { listContacts } = await import("@/lib/contacts");
    const robinContact = (await listContacts(OWNER)).find((c) => c.email === ROBIN_EMAIL);
    if (!robinContact) throw new Error("no contact for robin");
    for (const id of [LIVE_ON, LIVE_OFF, PUBLIC_TRIP, PRIVATE_TRIP]) {
      await claimTripPlace(OWNER, id, robinContact.id, null);
    }
    await approveTripPlaces(OWNER, robinContact.id);

    tokens.owner = await signIn(OWNER_EMAIL);
    tokens.robin = await signIn(ROBIN_EMAIL);
    tokens.guest = await signIn(GUEST_EMAIL);
    tokens.stranger = await signIn(STRANGER_EMAIL);
    // The instance operator, signed in to THIS journal (not its own) —
    // exactly how B480's admin reach works: one address, every journal.
    tokens.admin = await signIn(ADMIN_EMAIL);
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/lib/db");
    await closeDatabase();
    delete process.env.CONTENT_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.CONTACTS_ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.FERNSCOUT_ADMIN_EMAIL;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function trip(id: string) {
    const { getTrip, tripRef } = await import("@/lib/trips");
    const t = getTrip(tripRef(OWNER, id));
    if (!t) throw new Error(`fixture trip ${id} missing`);
    return t;
  }

  test("the owner always sees it live — even on a trip with guestsLive: false, or a public one", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    as("owner");
    expect(await mayReadLiveTrack(await trip(LIVE_ON))).toBe(true);
    expect(await mayReadLiveTrack(await trip(LIVE_OFF))).toBe(true);
    expect(await mayReadLiveTrack(await trip(PUBLIC_TRIP))).toBe(true);
    expect(await mayReadLiveTrack(await trip(PRIVATE_TRIP))).toBe(true);
  });

  test("the instance operator is not the journal's owner here, even though isOwner() says yes everywhere else", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    const { isOwner } = await import("@/lib/contacts/session");
    as("admin");
    // The premise: the operator really does pass every OTHER owner-only
    // gate on this journal (B480) — otherwise this test would prove nothing.
    expect(await isOwner(OWNER)).toBe(true);
    expect(await mayReadLiveTrack(await trip(LIVE_ON))).toBe(false);
    expect(await mayReadLiveTrack(await trip(LIVE_OFF))).toBe(false);
    expect(await mayReadLiveTrack(await trip(PRIVATE_TRIP))).toBe(false);
    expect(await mayReadLiveTrack(await trip(PUBLIC_TRIP))).toBe(false);
  });

  test("a guest trip: live by default, and not when guestsLive is false — for a traveller and for an approved guest alike", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    for (const viewer of ["robin", "guest"]) {
      as(viewer);
      expect(await mayReadLiveTrack(await trip(LIVE_ON))).toBe(true);
      expect(await mayReadLiveTrack(await trip(LIVE_OFF))).toBe(false);
    }
  });

  test("a guest trip's live setting never reaches a signed-in stranger or an anonymous reader — the gate asks who is reading, not only the setting", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    for (const viewer of ["stranger", "anonymous"]) {
      as(viewer);
      expect(await mayReadLiveTrack(await trip(LIVE_ON))).toBe(false);
    }
  });

  test("a public trip is 24h-late for everyone but the owner — a traveller and an approved guest included, whatever guestsLive says", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    for (const viewer of ["robin", "guest", "anonymous", "stranger"]) {
      as(viewer);
      expect(await mayReadLiveTrack(await trip(PUBLIC_TRIP))).toBe(false);
    }
  });

  test("a private trip is live for the traveller who was there", async () => {
    const { mayReadLiveTrack } = await import("@/lib/tripGate");
    as("robin");
    expect(await mayReadLiveTrack(await trip(PRIVATE_TRIP))).toBe(true);
  });
});

describe("no bearer door onto the tail — B2536", () => {
  test("nothing under app/api reads the tail file or asks readerTrack for the live branch", () => {
    // Structural, the same shape `gps-store.test.ts`'s own import-graph guard
    // uses: an agent token reaches `/api/**` and never a rendered page
    // (AGENTS.md), which is what keeps the tail off it — asserted here, not
    // only claimed in prose, so a future route that imports `readTail`
    // directly is caught the moment it exists.
    const hits: string[] = [];
    const walk = (root: string) => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (/\breadTail\(/.test(source) || /\bwriteTail\(/.test(source)) {
            hits.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(hits).toEqual([]);
  });
});
