import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B336 — one trip, three map surfaces, three different marker counts.
 *
 * `app/[user]/(trip)/map/page.tsx` asked `getPlan` who may see this trip's
 * drafts and then asked `getPlaces` nothing at all — so the dashed planned
 * route on a map followed `draftsVisibleTo` and the solid "where we've been"
 * markers on the very same map did not, for the owner included.
 * `app/[user]/trips/[trip]/map/page.tsx` had the identical shape, and
 * `app/[user]/trips/page.tsx` (the lifetime map) called `getPlaces` with no
 * options at all, per trip.
 *
 * The decided rule: the markers follow the same audience the planned route
 * and the journal home page already use — `draftsVisibleTo(trip)`, the
 * owner or somebody on the trip (B327) — so one viewer sees the same set of
 * places everywhere a trip's days are drawn on a map.
 *
 * One trip, `status: past`, carries both a published and a draft day so it
 * is reachable as the fallback "current" trip (`getCurrentTrip` falls back to
 * the most recent past trip) *and* at its own `/trips/<id>/map` without the
 * current-trip redirect — the same trip answers all three surfaces at once,
 * the way `viki`'s real trip did when this was found.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
  headers: async () => ({ get: () => null }),
}));

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP_ID = "ridge-2026";

let dir: string;
let ownerToken: string;

function writeConfigs() {
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
      title: "Along the Ridge",
      owner: { name: "Alex Meyer", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
}

function writeTrip() {
  const root = path.join(dir, OWNER, "trips", TRIP_ID);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${TRIP_ID}"`,
      'title: "Along the ridge"',
      'start: "2026-05-01"',
      'end: "2026-05-10"',
      'status: "past"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  // A published day in Chur, and a draft day in Basel — two distinct
  // locations so each is its own `Place` rather than collapsing into one.
  fs.writeFileSync(
    path.join(root, "entries", "2026-05-02-chur.md"),
    [
      "---",
      'title: "Chur"',
      'date: "2026-05-02"',
      'location: "Chur"',
      'country: "Switzerland"',
      'countryCode: "CH"',
      "lat: 46.8508",
      "lng: 9.5320",
      "---",
      "",
      "Arrived.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "entries", "2026-05-03-basel.md"),
    [
      "---",
      'title: "Basel"',
      'date: "2026-05-03"',
      'location: "Basel"',
      'country: "Switzerland"',
      'countryCode: "CH"',
      "lat: 47.5596",
      "lng: 7.5886",
      "status: draft",
      "---",
      "",
      "Written, not yet published.",
      "",
    ].join("\n"),
  );
}

function signOut() {
  jar.cookies = {};
}

function signInOwner() {
  jar.cookies = { fs_session: ownerToken };
}

/** The map page's own `places` prop, read off the returned element tree
 * without rendering it — the same technique `test/unlisted-owner-trip.test.tsx`
 * uses, so a client component that never runs (`useState`, etc.) is not a
 * reason this test needs jsdom. */
async function journalMapPlaces(): Promise<unknown[]> {
  const { default: MapPage } = await import("@/app/[user]/(trip)/map/page");
  const element = (await MapPage({
    params: Promise.resolve({ user: OWNER }),
  } as never)) as { props: { children: { props: { places: unknown[] } } } } | null;
  if (element === null) throw new Error("the journal map page rendered nothing");
  return element.props.children.props.places;
}

async function tripMapPlaces(): Promise<unknown[]> {
  const { default: TripMapPage } = await import("@/app/[user]/trips/[trip]/map/page");
  const element = (await TripMapPage({
    params: Promise.resolve({ user: OWNER, trip: TRIP_ID }),
  } as never)) as { props: { children: { props: { places: unknown[] } } } } | null;
  if (element === null) throw new Error("the trip-scoped map page rendered nothing");
  return element.props.children.props.places;
}

async function lifetimeMapPlaceCount(): Promise<number> {
  const { default: TripsPage } = await import("@/app/[user]/trips/page");
  const element = (await TripsPage({
    params: Promise.resolve({ user: OWNER }),
  } as never)) as { props: { routes: { points: unknown[] }[] } };
  const route = element.props.routes[0];
  return route ? route.points.length : 0;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-map-draft-places-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "66".repeat(32);
  writeConfigs();
  writeTrip();

  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  ownerToken = session.token;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner, reading their own trip", () => {
  beforeAll(() => {
    signInOwner();
  });

  test("gets both places on the journal map", async () => {
    expect(await journalMapPlaces()).toHaveLength(2);
  });

  test("gets both places on the trip-scoped map — the same trip, the same count", async () => {
    expect(await tripMapPlaces()).toHaveLength(2);
  });

  test("gets both places' worth of points on the lifetime map", async () => {
    expect(await lifetimeMapPlaceCount()).toBe(2);
  });
});

describe("a signed-out reader", () => {
  beforeAll(() => {
    signOut();
  });

  test("gets only the published place on the journal map", async () => {
    expect(await journalMapPlaces()).toHaveLength(1);
  });

  test("gets only the published place on the trip-scoped map", async () => {
    expect(await tripMapPlaces()).toHaveLength(1);
  });

  test("gets only the published place's point on the lifetime map", async () => {
    expect(await lifetimeMapPlaceCount()).toBe(1);
  });
});
