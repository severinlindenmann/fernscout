import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes, gpsDir } from "@/lib/gps/store";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { AS_AUTHOR, getDays } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { fillDays, proposeDays, unplacedDays } from "@/lib/gps/nameDays";
import { storeInboxFile } from "@/lib/inbox";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2303 — "Days without a place". Bangkok is a real place in the offline
 * index (test/place-for-day.test.ts anchors on it); every position is
 * invented.
 */

const OWNER_EMAIL = "alex@example.test";
const OWNER = "alex";
const OTHER_EMAIL = "somebody-else@example.test";
const ADMIN_EMAIL = "operator@example.test";
const TRIP = "thailand";
const TRIP_2 = "japan";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-name-days-"));
  process.env.CONTENT_DIR = dir;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, routeRecording: { enabled: true } },
    }),
  );
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
  writeTripFixture(OWNER, { id: TRIP, title: "Thailand", start: "2026-06-20", end: "2026-06-25", status: "past", visibility: "private" });
  writeTripFixture(OWNER, { id: TRIP_2, title: "Japan", start: "2026-08-01", end: "2026-08-03", status: "past", visibility: "private" });
  // Published, no place; draft, no place; one that already has a place; one with no positions.
  writeDayFixture(dir, OWNER, TRIP, { slug: "day-1", date: "2026-06-22", status: "published" });
  writeDayFixture(dir, OWNER, TRIP, { slug: "day-2", date: "2026-06-23", status: "draft" });
  writeDayFixture(dir, OWNER, TRIP, { slug: "day-3", date: "2026-06-24", status: "draft", location: "Phuket", country: "Thailand" });
  writeDayFixture(dir, OWNER, TRIP, { slug: "day-0", date: "2026-06-21", status: "draft" });
  // The second trip, a day with Tokyo positions.
  writeDayFixture(dir, OWNER, TRIP_2, { slug: "tokyo-day", date: "2026-08-02", status: "draft" });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string, lat: number, lon: number) => ({ t: Date.parse(iso), lat, lon });
const bangkokDay = (date: string) => [
  at(`${date}T08:00:00Z`, 13.7501, 100.4901),
  at(`${date}T10:00:00Z`, 13.7502, 100.4902),
  at(`${date}T12:00:00Z`, 13.7503, 100.4903),
];
const placeOf = (trip: string, slug: string) =>
  getDays(tripRef(OWNER, trip), AS_AUTHOR).flatMap((d) => d.entries).find((e) => e.slug === slug)?.location;

describe("lib/gps/nameDays.ts", () => {
  test("lists existing days without a place that the history can name, published ones marked, none without positions", () => {
    appendFixes(OWNER, [...bangkokDay("2026-06-22"), ...bangkokDay("2026-06-23"), ...bangkokDay("2026-06-24")]);
    expect(unplacedDays(OWNER, TRIP).map((d) => d.date)).toEqual(["2026-06-21", "2026-06-22", "2026-06-23"]);
    const proposed = proposeDays(OWNER, TRIP);
    // 06-21 has no positions, 06-24 already has a place.
    expect(proposed.map((d) => [d.date, d.name, d.published])).toEqual([
      ["2026-06-22", "Bangkok", true],
      ["2026-06-23", "Bangkok", false],
    ]);
  });

  test("a day inside a private zone is not listed", () => {
    fs.mkdirSync(gpsDir(OWNER), { recursive: true });
    fs.writeFileSync(path.join(gpsDir(OWNER), "exclude.json"), JSON.stringify([{ label: "home", lat: 13.75, lon: 100.49, radiusM: 5000 }]));
    appendFixes(OWNER, bangkokDay("2026-06-22"));
    expect(proposeDays(OWNER, TRIP)).toEqual([]);
  });

  test("fills only the ticked days, never a day that already has a place, never creates a day", () => {
    appendFixes(OWNER, [...bangkokDay("2026-06-22"), ...bangkokDay("2026-06-23"), ...bangkokDay("2026-06-24"), ...bangkokDay("2026-06-25")]);
    const before = getDays(tripRef(OWNER, TRIP), AS_AUTHOR).length;
    const result = fillDays(OWNER, TRIP, ["2026-06-23", "2026-06-24", "2026-06-25"]);
    expect(result.filled).toEqual(["2026-06-23"]);
    expect(result.skipped.sort()).toEqual(["2026-06-24", "2026-06-25"]);
    expect(placeOf(TRIP, "day-2")).toBe("Bangkok");
    expect(placeOf(TRIP, "day-1")).toBe(""); // not ticked
    expect(placeOf(TRIP, "day-3")).toBe("Phuket"); // existing place unchanged
    expect(getDays(tripRef(OWNER, TRIP), AS_AUTHOR)).toHaveLength(before);
  });
});

describe("POST /api/helper/[user]/gps/name-days", () => {
  const params = { params: Promise.resolve({ user: OWNER }) };
  const post = async (body: object) => {
    const { POST } = await import("@/app/api/helper/[user]/gps/name-days/route");
    return POST(new Request(`https://t.test/api/helper/${OWNER}/gps/name-days`, { method: "POST", body: JSON.stringify(body) }), params);
  };

  test("the owner's cookie fills the ticked day, recomputed on the server", async () => {
    appendFixes(OWNER, bangkokDay("2026-06-22"));
    const res = await post({ trip: TRIP, dates: ["2026-06-22"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, filled: ["2026-06-22"], skipped: [] });
    expect(placeOf(TRIP, "day-1")).toBe("Bangkok");
  });

  test("a second covered trip is filled from the same history", async () => {
    appendFixes(OWNER, [...bangkokDay("2026-06-22"), at("2026-08-02T08:00:00Z", 35.6762, 139.6503), at("2026-08-02T10:00:00Z", 35.6763, 139.6504), at("2026-08-02T12:00:00Z", 35.6764, 139.6505)]);
    expect(proposeDays(OWNER, TRIP_2).map((d) => d.date)).toEqual(["2026-08-02"]);
    const res = await post({ trip: TRIP_2, dates: ["2026-08-02"] });
    expect((await res.json()).filled).toEqual(["2026-08-02"]);
    expect(placeOf(TRIP_2, "tokyo-day")).toMatch(/Tokyo/);
  });

  test("a non-owner cookie and the operator's cookie are refused, nothing written", async () => {
    appendFixes(OWNER, bangkokDay("2026-06-22"));
    resolveAccess.mockResolvedValueOnce({ email: OTHER_EMAIL });
    expect((await post({ trip: TRIP, dates: ["2026-06-22"] })).status).toBe(404);
    process.env.FERNSCOUT_ADMIN_EMAIL = ADMIN_EMAIL;
    try {
      resolveAccess.mockResolvedValue({ email: ADMIN_EMAIL });
      expect((await post({ trip: TRIP, dates: ["2026-06-22"] })).status).toBe(404);
    } finally {
      delete process.env.FERNSCOUT_ADMIN_EMAIL;
    }
    expect(placeOf(TRIP, "day-1")).toBe("");
  });

  test("bad bodies and an unknown trip are refused", async () => {
    expect((await post({ trip: "nope", dates: ["2026-06-22"] })).status).toBe(404);
    expect((await post({ trip: TRIP, dates: [] })).status).toBe(400);
    expect((await post({ trip: TRIP, dates: [1] })).status).toBe(400);
  });
});

describe("the import's commit says how many days it can name — a count, never a place", () => {
  test("daysToName is a number", async () => {
    const { POST } = await import("@/app/api/helper/[user]/import/route");
    const jsonl = bangkokDay("2026-06-22")
      .map((f) => JSON.stringify([f.t / 1000, f.lat, f.lon]))
      .join("\n");
    const { entry } = storeInboxFile(OWNER, "files", "walk.jsonl", Buffer.from(jsonl), {});
    const res = await POST(
      new Request(`https://t.test/api/helper/${OWNER}/import`, { method: "POST", body: JSON.stringify({ inbox: entry.id, commit: true, trips: [TRIP] }) }),
      { params: Promise.resolve({ user: OWNER }) } as never,
    );
    const body = await res.json();
    expect(body.drawn[0]).toMatchObject({ tripId: TRIP, daysToName: 1 });
    expect(JSON.stringify(body)).not.toContain("Bangkok");
    // Nothing was filled by the import.
    expect(placeOf(TRIP, "day-1")).toBe("");
  });
});
