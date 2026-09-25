import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes, readRange } from "@/lib/gps/store";
import { deleteTripRecording, ownerTripLine, recordedTrips } from "@/lib/gps/api";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * "Your route" — B2226. `recordedTrips`, `ownerTripLine` and
 * `deleteTripRecording` (`lib/gps/api.ts`), and their three cookie-only
 * doors under `app/api/helper/[user]/gps/`.
 */

const OWNER_EMAIL = "alex@example.test";
const OWNER = "alex";
const OTHER_EMAIL = "somebody-else@example.test";
const ADMIN_EMAIL = "operator@example.test";
const TRIP_A = "thailand";
const TRIP_B = "japan";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

let dir: string;

function writeConfig(features: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, ...features },
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-route-page-"));
  process.env.CONTENT_DIR = dir;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  writeConfig({ routeRecording: { enabled: true } });
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { routeRecording: { enabled: true } },
    }),
  );
  writeTripFixture(OWNER, {
    id: TRIP_A,
    title: "Thailand",
    start: "2026-06-20",
    end: "2026-06-25",
    status: "past",
    visibility: "private",
  });
  writeTripFixture(OWNER, {
    id: TRIP_B,
    title: "Japan",
    start: "2026-08-01",
    end: "2026-08-05",
    status: "past",
    visibility: "private",
  });
  // A day carrying its own timezone, so deletion's day-window test can prove
  // it is respected rather than assumed to be UTC.
  writeDayFixture(dir, OWNER, TRIP_A, {
    slug: "day-1",
    date: "2026-06-22",
    content: "Written.",
    status: "published",
    timezone: "Asia/Bangkok", // UTC+7
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string, lat: number, lon: number) => ({ t: Date.parse(iso), lat, lon });

describe("lib/gps/api.ts — recordedTrips", () => {
  test("counts and a last-received instant, and nothing that looks like a coordinate", () => {
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.7501, 100.4901),
      at("2026-06-22T10:00:00Z", 13.7502, 100.4902),
      at("2026-06-23T08:00:00Z", 13.76, 100.5),
    ]);
    const trips = recordedTrips(OWNER);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ tripId: TRIP_A, daysRecorded: 2, tripDays: 6 });
    expect(new Date(trips[0].lastReceived).toISOString()).toBe("2026-06-23T08:00:00.000Z");

    const serialised = JSON.stringify(trips);
    // Every lat/lon fed in, rounded or not, at one to five decimal places.
    for (const needle of ["13.75", "13.750", "13.7501", "100.49", "100.490", "100.4901", "13.76", "100.5"]) {
      expect(serialised).not.toContain(needle);
    }
  });

  test("a trip with no fix inside its own dates is left out entirely", () => {
    // Outside both trips' date ranges.
    appendFixes(OWNER, [at("2026-01-01T08:00:00Z", 1, 1)]);
    expect(recordedTrips(OWNER)).toEqual([]);
  });

  test("two trips each report their own dates, and nothing leaks across", () => {
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.75, 100.49),
      at("2026-08-02T08:00:00Z", 35.68, 139.69),
    ]);
    const trips = recordedTrips(OWNER).sort((a, b) => a.tripId.localeCompare(b.tripId));
    expect(trips.map((t) => t.tripId)).toEqual([TRIP_B, TRIP_A]);
    expect(trips[0].daysRecorded).toBe(1);
    expect(trips[1].daysRecorded).toBe(1);
  });
});

describe("lib/gps/api.ts — ownerTripLine", () => {
  test("draws a segment for today, unlike the reader-facing track", () => {
    const now = Date.now();
    appendFixes(OWNER, [
      // Six minutes apart and a kilometre on, so thinning (5 min OR 250 m)
      // keeps both — a single surviving fix draws no line at all.
      { t: now - 6 * 60_000, lat: 13.75, lon: 100.49 },
      { t: now, lat: 13.759, lon: 100.49 },
    ]);
    // The trip's own dates cover this instant, however far in the future —
    // pick a trip that spans "now" for the test's own sake.
    writeTripFixture(OWNER, {
      id: "ongoing",
      title: "Ongoing",
      start: "2026-01-01",
      end: "2099-01-01",
      status: "current",
      visibility: "private",
    });
    const line = ownerTripLine(OWNER, "ongoing");
    expect(line).not.toBeNull();
    // A run of two points at least a few metres apart lands as one segment —
    // the run-length-1 rule drops singletons, so this proves the recent fix
    // was not clipped by the reader-facing 24h cap (it isn't applied here).
    const totalPoints = line!.segments.reduce((n, s) => n + s.points.length, 0);
    expect(totalPoints).toBeGreaterThan(0);
  });

  test("an unknown trip gives null", () => {
    expect(ownerTripLine(OWNER, "never-existed")).toBeNull();
  });
});

describe("lib/gps/api.ts — deleteTripRecording", () => {
  test("a day delete removes exactly that day's window, in its own timezone, and leaves the rest", () => {
    // 2026-06-22 local Bangkok midnight is 2026-06-21T17:00:00Z.
    appendFixes(OWNER, [
      at("2026-06-21T17:00:00Z", 13.75, 100.49), // just inside 06-22 Bangkok-local
      at("2026-06-22T12:00:00Z", 13.76, 100.5), // well inside 06-22
      at("2026-06-21T16:00:00Z", 13.74, 100.48), // still 06-21 Bangkok-local — must survive
      at("2026-06-23T08:00:00Z", 13.77, 100.51), // a different day of the same trip — must survive
    ]);
    const result = deleteTripRecording(OWNER, TRIP_A, "2026-06-22");
    expect(result).not.toBeNull();
    expect(result!.removed).toBe(2);

    const left = readRange(OWNER, 0, Date.now() + 1e10);
    expect(left.map((f) => [f.lat, f.lon]).sort()).toEqual(
      [
        [13.74, 100.48],
        [13.77, 100.51],
      ].sort(),
    );
  });

  test("a trip delete removes the whole trip's window and leaves another trip untouched", () => {
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.75, 100.49),
      at("2026-06-24T08:00:00Z", 13.76, 100.5),
      at("2026-08-02T08:00:00Z", 35.68, 139.69), // TRIP_B — must survive
    ]);
    const result = deleteTripRecording(OWNER, TRIP_A);
    expect(result).not.toBeNull();
    expect(result!.removed).toBe(2);

    const left = readRange(OWNER, 0, Date.now() + 1e10);
    expect(left).toHaveLength(1);
    expect([left[0].lat, left[0].lon]).toEqual([35.68, 139.69]);
  });

  test("re-derives the trip's own track.json, deleting it when nothing is left", () => {
    const trackFile = path.join(dir, OWNER, "trips", TRIP_A, "track.json");
    appendFixes(OWNER, [at("2026-06-22T08:00:00Z", 13.75, 100.49)]);
    fs.writeFileSync(
      trackFile,
      JSON.stringify({ generated: "x", segments: [{ from: "x", day: "2026-06-22", points: [[1, 1], [2, 2]] }] }),
    );
    const result = deleteTripRecording(OWNER, TRIP_A);
    expect(result!.track.written).toBe(false);
    expect(fs.existsSync(trackFile)).toBe(false);
  });

  test("a fix at exactly the next local midnight belongs to the next day and survives", () => {
    // 2026-06-23 00:00 Bangkok-local is 2026-06-22T17:00:00Z.
    appendFixes(OWNER, [at("2026-06-22T12:00:00Z", 13.75, 100.49), at("2026-06-22T17:00:00Z", 13.76, 100.5)]);
    const result = deleteTripRecording(OWNER, TRIP_A, "2026-06-22");
    expect(result!.removed).toBe(1);
    const left = readRange(OWNER, 0, Date.now() + 1e10);
    expect(left.map((f) => [f.lat, f.lon])).toEqual([[13.76, 100.5]]);
  });

  test("a date that names no real day gives null, and deletes nothing", () => {
    appendFixes(OWNER, [at("2026-06-22T12:00:00Z", 13.75, 100.49)]);
    expect(deleteTripRecording(OWNER, TRIP_A, "2026-06-31")).toBeNull();
    expect(readRange(OWNER, 0, Date.now() + 1e10)).toHaveLength(1);
  });

  test("a date outside the trip gives null", () => {
    expect(deleteTripRecording(OWNER, TRIP_A, "2099-01-01")).toBeNull();
  });

  test("an unknown trip gives null", () => {
    expect(deleteTripRecording(OWNER, "never-existed")).toBeNull();
  });
});

describe("app/api/helper/[user]/gps/trips — the one door onto recordedTrips", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const url = `https://t.test/api/helper/${OWNER}/gps/trips`;

  test("the owner's cookie gets the list", async () => {
    appendFixes(OWNER, [at("2026-06-22T08:00:00Z", 13.75, 100.49)]);
    const { GET } = await import("@/app/api/helper/[user]/gps/trips/route");
    const res = await GET(new Request(url), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.trips).toHaveLength(1);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a non-owner cookie is refused", async () => {
    resolveAccess.mockResolvedValueOnce({ email: OTHER_EMAIL });
    const { GET } = await import("@/app/api/helper/[user]/gps/trips/route");
    const res = await GET(new Request(url), params);
    expect(res.status).toBe(404);
  });

  test("the operator's admin cookie is refused too", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    try {
      resolveAccess.mockResolvedValue({ email: ADMIN_EMAIL });
      const { GET } = await import("@/app/api/helper/[user]/gps/trips/route");
      const res = await GET(new Request(url), params);
      expect(res.status).toBe(404);
    } finally {
      delete process.env.FERNSCOUT_ADMIN_EMAIL;
    }
  });

  test("the capability off is a 404", async () => {
    writeConfig({ routeRecording: { enabled: false } });
    clearConfigCache();
    const { GET } = await import("@/app/api/helper/[user]/gps/trips/route");
    const res = await GET(new Request(url), params);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("capability_off");
  });
});

describe("app/api/helper/[user]/gps/line — the one door onto ownerTripLine", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const url = (trip: string) => `https://t.test/api/helper/${OWNER}/gps/line?trip=${trip}`;

  test("the owner's cookie gets the raw segments", async () => {
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.75, 100.49),
      at("2026-06-22T08:05:00Z", 13.751, 100.491),
    ]);
    const { GET } = await import("@/app/api/helper/[user]/gps/line/route");
    const res = await GET(new Request(url(TRIP_A)), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.segments)).toBe(true);
  });

  test("a non-owner cookie is refused", async () => {
    resolveAccess.mockResolvedValueOnce({ email: OTHER_EMAIL });
    const { GET } = await import("@/app/api/helper/[user]/gps/line/route");
    const res = await GET(new Request(url(TRIP_A)), params);
    expect(res.status).toBe(404);
  });

  test("the operator's admin cookie is refused too", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    try {
      resolveAccess.mockResolvedValue({ email: ADMIN_EMAIL });
      const { GET } = await import("@/app/api/helper/[user]/gps/line/route");
      const res = await GET(new Request(url(TRIP_A)), params);
      expect(res.status).toBe(404);
    } finally {
      delete process.env.FERNSCOUT_ADMIN_EMAIL;
    }
  });

  test("the capability off is a 404", async () => {
    writeConfig({ routeRecording: { enabled: false } });
    clearConfigCache();
    const { GET } = await import("@/app/api/helper/[user]/gps/line/route");
    const res = await GET(new Request(url(TRIP_A)), params);
    expect(res.status).toBe(404);
  });

  test("an unknown trip is a 404", async () => {
    const { GET } = await import("@/app/api/helper/[user]/gps/line/route");
    const res = await GET(new Request(url("never-existed")), params);
    expect(res.status).toBe(404);
  });
});

describe("app/api/helper/[user]/gps/trip — the delete door", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const OWN_ORIGIN = "https://t.test";
  const del = (query: string, origin = OWN_ORIGIN) =>
    new Request(`https://t.test/api/helper/${OWNER}/gps/trip?${query}`, {
      method: "DELETE",
      headers: { origin },
    });

  test("an impossible date is a 400, not a 500", async () => {
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del(`trip=${TRIP_A}&date=2026-02-30`), params);
    expect(res.status).toBe(400);
  });

  test("the owner's cookie deletes a named day", async () => {
    appendFixes(OWNER, [at("2026-06-22T12:00:00Z", 13.75, 100.49)]);
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del(`trip=${TRIP_A}&date=2026-06-22`), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.removed).toBe(1);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a non-owner cookie is refused", async () => {
    resolveAccess.mockResolvedValueOnce({ email: OTHER_EMAIL });
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del(`trip=${TRIP_A}`), params);
    expect(res.status).toBe(404);
  });

  test("the operator's admin cookie is refused too", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    try {
      resolveAccess.mockResolvedValue({ email: ADMIN_EMAIL });
      const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
      const res = await DELETE(del(`trip=${TRIP_A}`), params);
      expect(res.status).toBe(404);
    } finally {
      delete process.env.FERNSCOUT_ADMIN_EMAIL;
    }
  });

  test("a foreign origin is refused before anything is deleted", async () => {
    appendFixes(OWNER, [at("2026-06-22T12:00:00Z", 13.75, 100.49)]);
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del(`trip=${TRIP_A}`, "https://evil.example"), params);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("foreign_origin");
    expect(readRange(OWNER, 0, Date.now() + 1e10)).toHaveLength(1);
  });

  test("the capability off is a 404", async () => {
    writeConfig({ routeRecording: { enabled: false } });
    clearConfigCache();
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del(`trip=${TRIP_A}`), params);
    expect(res.status).toBe(404);
  });

  test("an unknown trip is a 404", async () => {
    const { DELETE } = await import("@/app/api/helper/[user]/gps/trip/route");
    const res = await DELETE(del("trip=never-existed"), params);
    expect(res.status).toBe(404);
  });
});
