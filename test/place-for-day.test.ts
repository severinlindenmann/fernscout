import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes, gpsDir } from "@/lib/gps/store";
import { placeForDay } from "@/lib/gps/api";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeTripFixture } from "./fixtures/content";

/**
 * `placeForDay` — B2200, D1.
 *
 * A real place in the offline index (`test/ingest-cluster.test.ts` already
 * anchors on it): Bangkok, 13.75/100.49. A day mostly spent there, with a
 * short unrelated stop elsewhere, should name Bangkok and nothing about
 * either fix's own coordinates.
 */

const OWNER_EMAIL = "alex@example.test";
const OWNER = "alex";
const TRIP = "thailand";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-place-for-day-"));
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
    id: TRIP,
    title: "Thailand",
    start: "2026-06-20",
    end: "2026-06-25",
    status: "past",
    visibility: "private",
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string, lat: number, lon: number) => ({ t: Date.parse(iso), lat, lon });

describe("lib/gps/api.ts — placeForDay", () => {
  test("exactly {name, country}, and never a coordinate — even rounded", () => {
    appendFixes(OWNER, [
      // Four hours around Bangkok, five decimal places — the exact fix.
      at("2026-06-22T08:00:00Z", 13.7501, 100.4901),
      at("2026-06-22T10:00:00Z", 13.7502, 100.4902),
      at("2026-06-22T12:00:00Z", 13.7503, 100.4903),
      // A short unrelated stop far away — outweighed by Bangkok's dwell time.
      at("2026-06-22T18:00:00Z", 18.7883, 98.9853),
      at("2026-06-22T18:20:00Z", 18.7884, 98.9854),
    ]);

    const place = placeForDay(OWNER, TRIP, "2026-06-22");
    expect(place).not.toBeNull();
    expect(Object.keys(place!).sort()).toEqual(["country", "name"]);
    expect(place!.name).toBe("Bangkok");

    const serialised = JSON.stringify(place);
    for (const needle of [
      "13.75",
      "13.750",
      "13.7501",
      "100.49",
      "100.490",
      "100.4901",
      "18.78",
      "18.788",
      "98.98",
      "98.985",
    ]) {
      expect(serialised).not.toContain(needle);
    }
  });

  test("a day entirely inside a private zone gives null", () => {
    fs.mkdirSync(gpsDir(OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(gpsDir(OWNER), "exclude.json"),
      JSON.stringify([{ label: "home", lat: 13.75, lon: 100.49, radiusM: 5000 }]),
    );
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.751, 100.491),
      at("2026-06-22T10:00:00Z", 13.752, 100.492),
    ]);

    expect(placeForDay(OWNER, TRIP, "2026-06-22")).toBeNull();
  });

  test("an unreadable exclusion list fails closed rather than exposing a fix", () => {
    fs.mkdirSync(gpsDir(OWNER), { recursive: true });
    fs.writeFileSync(path.join(gpsDir(OWNER), "exclude.json"), "not json");
    appendFixes(OWNER, [at("2026-06-22T08:00:00Z", 13.75, 100.49)]);

    expect(placeForDay(OWNER, TRIP, "2026-06-22")).toBeNull();
  });

  test("no fixes that day gives null, not an error", () => {
    expect(placeForDay(OWNER, TRIP, "2026-06-23")).toBeNull();
  });

  test("a date outside the trip's own range gives null", () => {
    appendFixes(OWNER, [at("2026-07-01T08:00:00Z", 13.75, 100.49)]);
    expect(placeForDay(OWNER, TRIP, "2026-07-01")).toBeNull();
  });

  test("a date after today gives null", () => {
    const farFuture = "2099-01-01";
    writeTripFixture(OWNER, {
      id: "later",
      title: "Later",
      start: "2098-12-01",
      end: "2099-02-01",
      status: "upcoming",
      visibility: "private",
    });
    expect(placeForDay(OWNER, "later", farFuture)).toBeNull();
  });

  test("an unknown trip gives null", () => {
    expect(placeForDay(OWNER, "never-existed", "2026-06-22")).toBeNull();
  });
});

describe("app/api/helper/[user]/day/place — the one door", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const url = (q: string) => `https://t.test/api/helper/${OWNER}/day/place?${q}`;

  test("the owner's cookie gets a suggestion", async () => {
    appendFixes(OWNER, [
      at("2026-06-22T08:00:00Z", 13.751, 100.491),
      at("2026-06-22T12:00:00Z", 13.752, 100.492),
    ]);
    const { GET } = await import("@/app/api/helper/[user]/day/place/route");
    const res = await GET(new Request(url(`trip=${TRIP}&date=2026-06-22`)), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.place.name).toBe("Bangkok");
  });

  test("a non-owner cookie gets 404, the same as any other journal that is not theirs", async () => {
    resolveAccess.mockResolvedValueOnce({ email: "somebody-else@example.test" });
    const { GET } = await import("@/app/api/helper/[user]/day/place/route");
    const res = await GET(new Request(url(`trip=${TRIP}&date=2026-06-22`)), params);
    expect(res.status).toBe(404);
  });

  test("the operator's admin cookie is refused too, and the answer is never cached", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = "operator@example.test";
    try {
      resolveAccess.mockResolvedValue({ email: "operator@example.test" });
      const { GET } = await import("@/app/api/helper/[user]/day/place/route");
      const refused = await GET(new Request(url(`trip=${TRIP}&date=2026-06-22`)), params);
      expect(refused.status).toBe(404);
      resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
      const owner = await GET(new Request(url(`trip=${TRIP}&date=2026-06-22`)), params);
      expect(owner.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      delete process.env.FERNSCOUT_ADMIN_EMAIL;
    }
  });

  // Bearer refusal proper — a real, unmocked `resolveAccess` reading a real
  // (empty) cookie jar with a valid token on the request — lives in
  // `test/helper-routes-bearer-refused.test.ts`; this file mocks
  // `resolveAccess` itself, so it cannot exercise that distinction honestly.

  test("the capability off is a 404, not a silent null", async () => {
    writeConfig({ routeRecording: { enabled: false } });
    clearConfigCache();
    const { GET } = await import("@/app/api/helper/[user]/day/place/route");
    const res = await GET(new Request(url(`trip=${TRIP}&date=2026-06-22`)), params);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("capability_off");
  });
});
