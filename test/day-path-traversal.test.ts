import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { moveDayTransactional, splitDayTransactional, mergeDaysTransactional } from "@/lib/studio/reshapeDay";

/**
 * B1892 — one journal must not be able to address another's days.
 *
 * `path.join` collapses `..`, and a trip id, a day slug and a date all become
 * parts of a filename. They arrive in a JSON body (the studio's reshape door)
 * or as a URL parameter (`/api/web/{user}/trips/{trip}/days/{slug}`), so
 * nothing normalises them on the way in. The gate on both doors is the right
 * one — the owner's cookie — and the hole is that being *an* owner was enough
 * to reach *any* journal.
 *
 * Every assertion here is about the victim's files still being the victim's
 * afterwards, not only about the status code: a refusal that had already
 * renamed a media folder would pass a status assertion.
 */

const OWNER = "alex";
const VICTIM = "vicky";

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

function writeJournal(user: string) {
  fs.mkdirSync(path.join(dir, user), { recursive: true });
  fs.writeFileSync(
    path.join(dir, user, "config.json"),
    JSON.stringify({
      title: user,
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: `${user}@example.test` },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "public",
      features: {},
    }),
  );
}

/** The victim's day, on disk, exactly as it was written. */
const victimDay = () => path.join(dir, VICTIM, "trips", "secret", "entries", "2026-03-01-private.json");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-traversal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "traversal-test-secret-b1892";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  writeJournal(OWNER);
  writeJournal(VICTIM);
  await migrateToLatest(await getDatabase());

  isOwnerMock = (await import("@/lib/contacts/session")).isOwner as unknown as ReturnType<typeof vi.fn>;
  isOwnerMock.mockResolvedValue(true);

  writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2026-01-01", end: "2026-01-10", status: "past", visibility: "public" });
  writeDayFixture(dir, OWNER, "alps", { slug: "arrival", date: "2026-01-02", title: "Arrival", status: "draft", content: "mine" });

  writeTripFixture(VICTIM, { id: "secret", title: "Secret", start: "2026-03-01", end: "2026-03-10", status: "past", visibility: "private" });
  writeDayFixture(dir, VICTIM, "secret", { slug: "private", date: "2026-03-01", title: "Private", content: "private words" });
});

afterEach(async () => {
  await closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a trip id that is a path", () => {
  test("move refuses another journal's trip as its source, and moves nothing", () => {
    const result = moveDayTransactional(OWNER, `../../${VICTIM}/trips/secret`, "private", {
      tripId: "alps",
      date: "2026-01-05",
    });
    expect(result).toEqual({ ok: false, error: "unknown_trip" });
    expect(fs.existsSync(victimDay())).toBe(true);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-05-private.json"))).toBe(false);
  });

  test("split refuses it too", () => {
    const result = splitDayTransactional(OWNER, `../../${VICTIM}/trips/secret`, "private", {
      photoCutIndex: 0,
      firstContent: "a",
      secondTitle: "Second",
      secondContent: "b",
    });
    expect(result).toEqual({ ok: false, error: "unknown_trip" });
    expect(fs.existsSync(victimDay())).toBe(true);
  });

  test("merge refuses it too", () => {
    const traversed = `../../${VICTIM}/trips/secret`;
    const result = mergeDaysTransactional(OWNER, traversed, "private", traversed, "private");
    expect(result).toEqual({ ok: false, error: "unknown_trip" });
    expect(fs.existsSync(victimDay())).toBe(true);
  });
});

describe("a date that is a path", () => {
  test("move refuses it, and writes no day document outside the trip", () => {
    const result = moveDayTransactional(OWNER, "alps", "arrival", {
      tripId: "alps",
      date: `../../../${VICTIM}/trips/secret/entries/2026-03-01`,
    });
    expect(result).toEqual({ ok: false, error: "invalid_date" });
    expect(fs.readdirSync(path.join(dir, VICTIM, "trips", "secret", "entries"))).toEqual([
      "2026-03-01-private.json",
    ]);
    // And the day it was asked to move is still where it was.
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-02-arrival.json"))).toBe(true);
  });
});

describe("the store itself, which is what every door passes through", () => {
  test("refuses to write a day file through a trip id or a slug carrying a path", async () => {
    const { writeDayFile, readDayFile, listDaySlugs } = await import("@/lib/api/v2/store");
    const day = { date: "2026-03-02", title: "X", content: "x", status: "draft" } as never;
    expect(() => writeDayFile(OWNER, `../../${VICTIM}/trips/secret`, "2026-03-02-pwned", day)).toThrow();
    expect(() => writeDayFile(OWNER, "alps", `../../../${VICTIM}/trips/secret/entries/2026-03-02-pwned`, day)).toThrow();
    expect(fs.readdirSync(path.join(dir, VICTIM, "trips", "secret", "entries"))).toEqual([
      "2026-03-01-private.json",
    ]);
    // A reader answers "there is nothing there" rather than throwing, so a
    // door that only reads stays a 404 instead of becoming a 500.
    expect(readDayFile(OWNER, `../../${VICTIM}/trips/secret`, "2026-03-01-private")).toBeNull();
    expect(listDaySlugs(OWNER, `../../${VICTIM}/trips/secret`)).toEqual([]);
  });
});

describe("the [trip] URL parameter door", () => {
  test("GET .../trips/{trip}/days/{slug} cannot name another journal's trip", async () => {
    const { GET } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await GET(
      new Request("https://t.test/api/web/alex/trips/x/days/private"),
      { params: Promise.resolve({ user: OWNER, trip: `../../${VICTIM}/trips/secret`, slug: "private" }) } as never,
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("unknown_trip");
  });

  test("PATCH cannot either, and the victim's day is untouched", async () => {
    const before = fs.readFileSync(victimDay(), "utf8");
    const { PATCH } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
    const response = await PATCH(
      new Request("https://t.test/api/web/alex/trips/x/days/private", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "taken" }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: `../../${VICTIM}/trips/secret`, slug: "private" }) } as never,
    );
    expect(response.status).toBe(404);
    expect(fs.readFileSync(victimDay(), "utf8")).toBe(before);
  });
});
