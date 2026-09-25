import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Only the layout test at the bottom needs this — the API route tests never
// touch `next/headers`. Mocked at the top of the file (hoisted) rather than
// per-test, matching `test/current-trip.test.ts`'s own approach for `cookies`.
let mockPath: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => (key === "x-fernscout-path" ? mockPath : null) }),
  cookies: async () => ({ get: () => undefined }),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { createTrip } from "@/lib/tripWrite";
import { tripWriteScope } from "@/lib/tripPeople";
import { issueCode, verifyCode } from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { getTrip, tripRef } from "@/lib/trips";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { readTrack, trackFile, writeTrack } from "@/lib/gps/track";
import { writeDayFixture } from "./fixtures/content";
import { renameTrip, readRenamedMap, resolveRenamedTripId, isValidTripId } from "@/lib/tripRename";
import { GET as getTripRoute, PATCH as patchTripRoute } from "@/app/api/v2/[user]/trips/[trip]/route";
import { POST as renameRoute } from "@/app/api/v2/[user]/trips/[trip]/rename/route";
import TripLayout from "@/app/[user]/trips/[trip]/layout";

/**
 * Renaming a trip's id — B2015.
 *
 * Same harness as `test/deletions.test.ts`: a real temp content dir, a real
 * sqlite db, real sessions minted through `lib/auth`.
 */

let dir: string;
const OWNER_EMAIL = "owner@example.test";
const USER = "anna";
const DATES = { start: "2027-04-01", end: "2027-04-20" };

function serverConfig(): void {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: { signup: { inviteOnly: false }, auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-rename-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-trip-rename";
  serverConfig();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: USER,
    title: "Anna's journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Anna Traveller",
    ownerNickname: "Anna",
  });
  if (!created.ok) throw new Error(created.message);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeTrip(id: string): string {
  const created = createTrip(USER, { id, title: "Japan", ...DATES, visibility: "public" });
  if (!created.ok) throw new Error(created.message);
  return id;
}

function writeDay(tripId: string, slug: string, date: string) {
  const trip = path.join(dir, USER, "trips", tripId);
  fs.mkdirSync(path.join(trip, "media"), { recursive: true });
  writeDayFixture(dir, USER, tripId, { slug, date, title: slug, location: "Kyoto", country: "Japan", content: "Words." });
}

async function ownerToken(): Promise<string> {
  const { code } = await issueCode(USER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(USER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not open an owner session: ${verified.reason}`);
  return verified.token;
}

async function tripScopedToken(tripId: string): Promise<string> {
  const { code } = await issueCode(USER, OWNER_EMAIL, "agent", { trip: tripId });
  const verified = await verifyCode(USER, OWNER_EMAIL, code, "agent", tripWriteScope(tripId));
  if (!verified.ok) throw new Error(`could not open a scoped session: ${verified.reason}`);
  return verified.token;
}

/** One row keyed by (owner_id, trip_id) — a reaction on a day. */
async function insertReaction(tripId: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .insertInto("reactions")
    .values({
      id: crypto.randomUUID(),
      owner_id: USER,
      trip_id: tripId,
      day_slug: "2027-04-02-kyoto-in-the-rain",
      voter_id: "v1",
      emoji: "❤️",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .execute();
}

async function reactionTripId(): Promise<string | undefined> {
  const { db } = await getDatabase();
  const row = await db.selectFrom("reactions").selectAll().where("owner_id", "=", USER).executeTakeFirst();
  return row?.trip_id ?? undefined;
}

describe("renameTrip", () => {
  test("moves the folder, the id, the track, a database row, and finds nothing at the old id", async () => {
    const oldId = "japan-2027";
    makeTrip(oldId);
    writeDay(oldId, "2027-04-02-kyoto-in-the-rain", "2027-04-02");
    writeDay(oldId, "2027-04-03-osaka", "2027-04-03");
    writeTrack(USER, oldId, {
      generated: new Date().toISOString(),
      segments: [{ from: "2027-04-02T00:00:00Z", points: [[35, 135], [35.1, 135.1]] }],
    });
    await insertReaction(oldId);

    const newId = "japan-2027-fixed";
    const result = await renameTrip(USER, oldId, newId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.id).toBe(newId);

    // The new address has everything.
    const trip = getTrip(tripRef(USER, newId));
    expect(trip?.id).toBe(newId);
    expect(trip?.title).toBe("Japan");
    expect(getAllEntries(tripRef(USER, newId), AS_AUTHOR)).toHaveLength(2);
    expect(readTrack(USER, newId)?.segments).toHaveLength(1);
    expect(await reactionTripId()).toBe(newId);

    // Nothing is left at the old one.
    expect(getTrip(tripRef(USER, oldId))).toBeUndefined();
    expect(getAllEntries(tripRef(USER, oldId), AS_AUTHOR)).toHaveLength(0);
    expect(fs.existsSync(trackFile(USER, oldId))).toBe(false);
    expect(fs.existsSync(path.join(dir, USER, "trips", oldId))).toBe(false);

    // `trip.json` on disk carries the new id.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, USER, "trips", newId, "trip.json"), "utf8"));
    expect(raw.id).toBe(newId);

    // The redirect record.
    expect(readRenamedMap(USER)).toEqual({ [oldId]: newId });
    expect(resolveRenamedTripId(USER, oldId)).toBe(newId);
  });

  test("a chain resolves by following it to the end", async () => {
    const a = "trip-a";
    makeTrip(a);
    const b = (await renameTrip(USER, a, "trip-b")) as { ok: true; id: string };
    expect(b.ok).toBe(true);
    const c = await renameTrip(USER, "trip-b", "trip-c");
    expect(c.ok).toBe(true);

    expect(resolveRenamedTripId(USER, a)).toBe("trip-c");
    expect(resolveRenamedTripId(USER, "trip-b")).toBe("trip-c");
    expect(getTrip(tripRef(USER, "trip-c"))?.id).toBe("trip-c");
  });

  test("refuses a new id that already belongs to another trip", async () => {
    makeTrip("first-trip");
    makeTrip("second-trip");
    const result = await renameTrip(USER, "first-trip", "second-trip");
    expect(result).toEqual({ ok: false, error: "trip_id_taken" });
    expect(getTrip(tripRef(USER, "first-trip"))).toBeTruthy();
  });

  test("refuses an id that is not a valid slug", async () => {
    makeTrip("first-trip");
    expect(await renameTrip(USER, "first-trip", "Not A Slug!")).toEqual({ ok: false, error: "invalid_trip_id" });
    expect(await renameTrip(USER, "first-trip", "a".repeat(61))).toEqual({ ok: false, error: "invalid_trip_id" });
    expect(isValidTripId("alps-2026")).toBe(true);
    expect(isValidTripId("Alps-2026")).toBe(false);
  });

  test("refuses renaming to the same id", async () => {
    makeTrip("first-trip");
    expect(await renameTrip(USER, "first-trip", "first-trip")).toEqual({ ok: false, error: "same_id" });
  });

  test("refuses an unknown trip", async () => {
    expect(await renameTrip(USER, "no-such-trip", "anything-else")).toEqual({ ok: false, error: "unknown_trip" });
  });
});

describe("POST /api/v2/{user}/trips/{trip}/rename", () => {
  async function rename(user: string, trip: string, id: unknown, token?: string) {
    const response = await renameRoute(
      new Request(`https://t.test/api/v2/${user}/trips/${trip}/rename`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id }),
      }),
      { params: Promise.resolve({ user, trip }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  test("an owner-scoped token renames the trip", async () => {
    makeTrip("japan-2027");
    const token = await ownerToken();
    const { status, body } = await rename(USER, "japan-2027", "japan-2027-fixed", token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, id: "japan-2027-fixed" });
    expect(getTrip(tripRef(USER, "japan-2027-fixed"))).toBeTruthy();
  });

  test("refuses with no token", async () => {
    makeTrip("japan-2027");
    const { status } = await rename(USER, "japan-2027", "japan-2027-fixed");
    expect(status).toBe(401);
  });

  test("refuses a trip-scoped (buddy) token — renaming is the owner's", async () => {
    makeTrip("japan-2027");
    const token = await tripScopedToken("japan-2027");
    const { status, body } = await rename(USER, "japan-2027", "japan-2027-fixed", token);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(getTrip(tripRef(USER, "japan-2027"))).toBeTruthy();
  });

  test("refuses an id that already belongs to another trip", async () => {
    makeTrip("first-trip");
    makeTrip("second-trip");
    const token = await ownerToken();
    const { status, body } = await rename(USER, "first-trip", "second-trip", token);
    expect(status).toBe(409);
    expect(body.error).toBe("trip_id_taken");
  });

  test("refuses an id that is not a valid slug", async () => {
    makeTrip("first-trip");
    const token = await ownerToken();
    const { status, body } = await rename(USER, "first-trip", "Not A Slug!", token);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });
});

describe("the old address, after a rename", () => {
  test("GET answers 308 to the new one", async () => {
    makeTrip("japan-2027");
    const token = await ownerToken();
    const renamed = await renameTrip(USER, "japan-2027", "japan-2027-fixed");
    expect(renamed.ok).toBe(true);

    const response = await getTripRoute(
      new Request(`https://t.test/api/v2/${USER}/trips/japan-2027`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: USER, trip: "japan-2027" }) },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://t.test/api/v2/${USER}/trips/japan-2027-fixed`);
  });

  test("PATCH answers 308 to the new one too", async () => {
    makeTrip("japan-2027");
    const token = await ownerToken();
    await renameTrip(USER, "japan-2027", "japan-2027-fixed");

    const response = await patchTripRoute(
      new Request(`https://t.test/api/v2/${USER}/trips/japan-2027`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ tagline: "x" }),
      }),
      { params: Promise.resolve({ user: USER, trip: "japan-2027" }) },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://t.test/api/v2/${USER}/trips/japan-2027-fixed`);
  });

  test("a trip nobody ever renamed still answers unknown_trip, not a redirect", async () => {
    const token = await ownerToken();
    const response = await getTripRoute(
      new Request(`https://t.test/api/v2/${USER}/trips/never-existed`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: USER, trip: "never-existed" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("unknown_trip");
  });
});

describe("the reader-facing trip page, after a rename", () => {
  test("permanently redirects to the same path at the new id", async () => {
    mockPath = `/${USER}/trips/japan-2027/gallery`;
    makeTrip("japan-2027");
    await renameTrip(USER, "japan-2027", "japan-2027-fixed");

    let digest = "";
    try {
      await TripLayout({
        params: Promise.resolve({ user: USER, trip: "japan-2027" }),
        children: null,
      } as never);
    } catch (err) {
      digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
    }
    expect(digest).toContain(`;/${USER}/trips/japan-2027-fixed/gallery;`);
    mockPath = null;
  });

  test("a trip nobody ever renamed still 404s, no redirect", async () => {
    mockPath = `/${USER}/trips/never-existed`;
    let notFoundThrew = false;
    try {
      await TripLayout({
        params: Promise.resolve({ user: USER, trip: "never-existed" }),
        children: null,
      } as never);
    } catch (err) {
      const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
      notFoundThrew = digest.includes("NEXT_HTTP_ERROR_FALLBACK;404");
    }
    expect(notFoundThrew).toBe(true);
    mockPath = null;
  });
});
