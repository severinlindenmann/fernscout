import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes } from "@/lib/gps/store";
import { travelForPartOfDay } from "@/lib/gps/api";
import type { TransportMode } from "@/importers/gps/schema";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * TIX-2 — "what did we do in this part of the day?" `travelForPartOfDay`
 * (`lib/gps/api.ts`) and its one door, `GET
 * app/api/helper/[user]/day/travel`. Same owner-only, `routeRecording`-gated
 * shape as `gps/line` next door (test/gps-route-page.test.ts) — mirrored
 * here rather than imported since this is a different function's own test.
 */

const OWNER_EMAIL = "alex@example.test";
const OWNER = "alex";
const OTHER_EMAIL = "somebody-else@example.test";
const TRIP_A = "thailand";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-travel-"));
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

const at = (iso: string, lat: number, lon: number, mode?: string) => ({
  t: Date.parse(iso),
  lat,
  lon,
  ...(mode ? { mode: mode as TransportMode } : {}),
});

describe("travelForPartOfDay", () => {
  test("sums the mode with the most recorded km across the whole day when from/to are omitted", () => {
    // 08:00 local = 01:00Z, well inside the Bangkok day.
    appendFixes(OWNER, [
      at("2026-06-22T01:00:00Z", 13.75, 100.49, "on_foot"),
      at("2026-06-22T01:05:00Z", 13.76, 100.49, "on_foot"),
      at("2026-06-22T01:10:00Z", 13.77, 100.49, "on_foot"),
    ]);
    const travel = travelForPartOfDay(OWNER, TRIP_A, "2026-06-22");
    expect(travel).not.toBeNull();
    expect(travel).not.toBeUndefined();
    expect(travel?.mode).toBe("on_foot");
    expect(travel?.km).toBeGreaterThan(1);
  });

  test("a from/to window picks out only the travel inside it", () => {
    appendFixes(OWNER, [
      // Morning, on foot — 01:00Z–02:00Z = 08:00–09:00 Bangkok.
      at("2026-06-22T01:00:00Z", 13.75, 100.49, "on_foot"),
      at("2026-06-22T01:30:00Z", 13.78, 100.49, "on_foot"),
      // Afternoon, by car — 06:00Z–07:00Z = 13:00–14:00 Bangkok.
      at("2026-06-22T06:00:00Z", 13.9, 100.6, "car"),
      at("2026-06-22T06:30:00Z", 14.1, 100.8, "car"),
    ]);
    const morning = travelForPartOfDay(OWNER, TRIP_A, "2026-06-22", "07:00", "10:00");
    expect(morning?.mode).toBe("on_foot");
    const afternoon = travelForPartOfDay(OWNER, TRIP_A, "2026-06-22", "12:00", "15:00");
    expect(afternoon?.mode).toBe("car");
  });

  test("under half a kilometre is null, not a tiny number", () => {
    appendFixes(OWNER, [
      at("2026-06-22T01:00:00Z", 13.75, 100.49, "on_foot"),
      at("2026-06-22T01:00:05Z", 13.7501, 100.49, "on_foot"),
    ]);
    expect(travelForPartOfDay(OWNER, TRIP_A, "2026-06-22")).toBeNull();
  });

  test("no recorded positions at all is null", () => {
    expect(travelForPartOfDay(OWNER, TRIP_A, "2026-06-22")).toBeNull();
  });

  test("an unknown trip or a date outside it is undefined", () => {
    expect(travelForPartOfDay(OWNER, "never-existed", "2026-06-22")).toBeUndefined();
    expect(travelForPartOfDay(OWNER, TRIP_A, "2020-01-01")).toBeUndefined();
  });

  test("never a point or a coordinate — only a mode and a km total", () => {
    appendFixes(OWNER, [
      at("2026-06-22T01:00:00Z", 13.75, 100.49, "on_foot"),
      at("2026-06-22T01:05:00Z", 13.76, 100.49, "on_foot"),
    ]);
    const travel = travelForPartOfDay(OWNER, TRIP_A, "2026-06-22");
    expect(Object.keys(travel ?? {}).sort()).toEqual(["km", "mode", "modes"]);
    // B2648 — the per-mode list is the same two facts per mode, nothing more.
    for (const entry of travel!.modes) expect(Object.keys(entry).sort()).toEqual(["km", "mode"]);
    expect(JSON.stringify(travel)).not.toMatch(/13\.7|100\.4|lat|lon|time/);
  });
});

describe("GET app/api/helper/[user]/day/travel", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const url = (query: string) => `https://t.test/api/helper/${OWNER}/day/travel?${query}`;

  test("the owner's cookie gets a travel summary", async () => {
    appendFixes(OWNER, [
      at("2026-06-22T01:00:00Z", 13.75, 100.49, "on_foot"),
      at("2026-06-22T01:05:00Z", 13.76, 100.49, "on_foot"),
    ]);
    const { GET } = await import("@/app/api/helper/[user]/day/travel/route");
    const res = await GET(new Request(url(`trip=${TRIP_A}&date=2026-06-22`)), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.travel.mode).toBe("on_foot");
  });

  test("a non-owner cookie is refused", async () => {
    resolveAccess.mockResolvedValueOnce({ email: OTHER_EMAIL });
    const { GET } = await import("@/app/api/helper/[user]/day/travel/route");
    const res = await GET(new Request(url(`trip=${TRIP_A}&date=2026-06-22`)), params);
    expect(res.status).toBe(404);
  });

  test("the capability off is a 404", async () => {
    writeConfig({ routeRecording: { enabled: false } });
    clearConfigCache();
    const { GET } = await import("@/app/api/helper/[user]/day/travel/route");
    const res = await GET(new Request(url(`trip=${TRIP_A}&date=2026-06-22`)), params);
    expect(res.status).toBe(404);
  });

  test("an unknown trip is a 404", async () => {
    const { GET } = await import("@/app/api/helper/[user]/day/travel/route");
    const res = await GET(new Request(url(`trip=never-existed&date=2026-06-22`)), params);
    expect(res.status).toBe(404);
  });

  test("a malformed from/to is a 400", async () => {
    const { GET } = await import("@/app/api/helper/[user]/day/travel/route");
    const res = await GET(new Request(url(`trip=${TRIP_A}&date=2026-06-22&from=noon`)), params);
    expect(res.status).toBe(400);
  });
});

describe("B2648 — every mode of a stretch, longest first", () => {
  test("a bike ride and a longer drive come back as two modes", () => {
    appendFixes(OWNER, [
      at("2026-06-23T01:00:00Z", 13.7, 100.5, "bike"),
      at("2026-06-23T01:20:00Z", 13.75, 100.5, "bike"),
      at("2026-06-23T02:00:00Z", 13.75, 100.5, "car"),
      at("2026-06-23T03:00:00Z", 14.2, 100.5, "car"),
    ]);
    const travel = travelForPartOfDay(OWNER, TRIP_A, "2026-06-23");
    expect(travel!.modes.map((m) => m.mode)).toEqual(["car", "bike"]);
    expect(travel!.mode).toBe("car");
  });
});
