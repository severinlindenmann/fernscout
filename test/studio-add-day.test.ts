import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { writeTripFixture } from "./fixtures/content";
import { createDayTransactional } from "@/lib/studio/createDay";
import { readDayFile } from "@/lib/api/v2/store";
import { declinableFieldsFor, autoVisibilityDecline } from "@/lib/studio/declinables";
import { findDayForDate } from "@/lib/studio/day";
import { NO_PROSE } from "@/lib/helper/draft";

/**
 * B1830 — "Add a day", the studio's own transactional writer
 * (`lib/studio/createDay.ts`) and the two pure helpers beside it
 * (`lib/studio/declinables.ts`, `lib/studio/day.ts`). None of the 1512 lines
 * this ticket shipped had a test naming them; this file is that coverage,
 * against the checklist in `.claude/runs/2026-09-19-the-studio/spec.md` §9.
 */

const OWNER = "alex";
const TRIP_ID = "reise";

let dir: string;

function tripsDir(): string {
  return path.join(dir, OWNER, "trips", TRIP_ID, "entries");
}

function writeTrip(overrides: Partial<Parameters<typeof writeTripFixture>[1]> = {}) {
  writeTripFixture(OWNER, {
    id: TRIP_ID,
    title: "Reise",
    start: "2025-11-01",
    end: "2025-11-30",
    status: "current",
    visibility: "public",
    ...overrides,
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-add-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "studio-add-day-test-secret-b1830";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  writeTrip();
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * C2 — the most important claim in the ticket. `attachStagedFiles` fails
 * outright when an inbox id resolves to nothing (`unknown_inbox_file`), which
 * needs no real upload or staged file on disk to trigger — a made-up id is
 * already enough, and it is exactly the "a size limit, a quota" kind of
 * rejection the doc comment names as the one thing downstream of the day
 * write that can fail on something the caller does not fully control.
 */
describe("createDayTransactional — C2, one transaction", () => {
  test("attaching photographs fails and nothing is left behind: no day file", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-10",
      title: "A day that never lands",
      content: "Something happened.",
      mediaInboxIds: ["not-a-real-inbox-id"],
      declined: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the attach to fail");
    expect(result.error).toBe("unknown_inbox_file");

    // The claim is not just "the function said no" — it is that the day
    // `createDraft` wrote before the attach step is genuinely gone from disk.
    expect(fs.existsSync(path.join(tripsDir(), "2025-11-10-a-day-that-never-lands.json"))).toBe(false);
    expect(fs.readdirSync(tripsDir(), { withFileTypes: true }).filter((e) => e.isFile())).toHaveLength(0);
  });

  test("the happy path (no photographs) leaves the day present — the failure above is not just the write never happening", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-11",
      title: "A day that lands",
      content: "Something happened.",
      declined: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    expect(fs.existsSync(path.join(tripsDir(), `${result.slug}.json`))).toBe(true);
  });
});

/** C4 — publishing is never a side effect of this flow. */
describe("createDayTransactional — C4, arrives as a draft", () => {
  test("a day created by this flow reads back status: draft", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-12",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.status).toBe("draft");
  });
});

/** C7 — no invented content: an empty title stays absent, an empty body is
 *  NO_PROSE and never a composed sentence. */
describe("createDayTransactional — C7, no invented content", () => {
  test("an empty title stays absent, not generated", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-13",
      title: "",
      content: "Something happened.",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    // `buildDayFile` (`lib/api/entries.ts`) always stores `title` as a
    // string, never an absent key — `input.title ?? ""` — so "absent" for
    // a day's title is spelled the empty string, the same as "no title yet"
    // (B1442) in `helper-day-flow.test.ts`. The claim under test is that
    // nothing was invented to fill it, not that the key is missing.
    expect(stored?.title).toBe("");
  });

  test("an empty body is written as NO_PROSE, not a composed sentence", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-14",
      title: "A day with nothing said",
      content: "",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.content).toBe(NO_PROSE);
    expect(stored?.content).not.toMatch(/[a-zA-Z]/);
  });
});

/** C8 — a decline never carries an empty or too-short reason. */
describe("createDayTransactional — C8, the decline floor", () => {
  test("a too-short reason is dropped", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-15",
      declined: { costs: "n/a" }, // under declineReason's 10-character floor
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.declined?.costs).toBeUndefined();
  });

  test("a real reason (10+ characters) is kept", async () => {
    const reason = "nothing spent today, tracked elsewhere";
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-16",
      declined: { costs: reason },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.declined?.costs).toBe(reason);
  });
});

/** The "both provided and declined" guard — a field the day already carries
 *  a real answer for is never also written into the declined map. */
describe("createDayTransactional — a field with a real answer is never also declined", () => {
  test("location is provided, so a decline for location is dropped even though the caller sent one", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-17",
      location: "Lisbon",
      declined: { location: "no specific location named for this day" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.location).toBe("Lisbon");
    expect(stored?.declined?.location).toBeUndefined();
  });
});

/** The automatic visibility decline is always written, with the system's own
 *  sentence — this flow never has a "who sees this" question of its own. */
describe("createDayTransactional — visibility is always auto-declined", () => {
  test("visibility is declined with autoVisibilityDecline()'s exact sentence, even with no other declines", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-18",
      declined: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.declined?.visibility).toBe(autoVisibilityDecline());
  });

  test("a caller-supplied visibility decline never overrides the system's own sentence", async () => {
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-19",
      declined: { visibility: "a made-up reason that is not the system's own" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug);
    expect(stored?.declined?.visibility).toBe(autoVisibilityDecline());
  });
});

/**
 * D1 — `declinableFieldsFor` is pure (no fs, no fixture), so it is tested
 * directly against the vocabulary it filters rather than through a route.
 */
describe("declinableFieldsFor — D1", () => {
  test("status and visibility are excluded always, single-locale journal", () => {
    const fields = declinableFieldsFor(["en"]).map((d) => d.field);
    expect(fields).not.toContain("status");
    expect(fields).not.toContain("visibility");
  });

  test("status and visibility are excluded always, multi-locale journal", () => {
    const fields = declinableFieldsFor(["en", "de"]).map((d) => d.field);
    expect(fields).not.toContain("status");
    expect(fields).not.toContain("visibility");
  });

  test("translations drops out for a single-locale journal", () => {
    const fields = declinableFieldsFor(["en"]).map((d) => d.field);
    expect(fields).not.toContain("translations");
  });

  test("translations is kept for a multi-locale journal", () => {
    const fields = declinableFieldsFor(["en", "de"]).map((d) => d.field);
    expect(fields).toContain("translations");
  });
});

/**
 * D3 — an occupied date reports the existing day, and a second entry on that
 * date is still allowed. Two days, same date, Lisbon — the shape the spec's
 * own D3 example uses.
 */
describe("findDayForDate — D3", () => {
  test("an occupied date reports the existing day", async () => {
    const first = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-15",
      title: "Arriving in Lisbon",
      location: "Lisbon",
      country: "Portugal",
      declined: {},
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected the first day to be written");

    // `findDayForDate` reads through `getAllEntries`, which answers the
    // BARE slug (no date prefix) — `first.slug` is `createDayTransactional`'s
    // own v2 (`YYYY-MM-DD-slug`) form, built by `v2Slug(date, bareSlug)`
    // (`lib/api/v2/days.ts`). Stripping the date prefix back off is what
    // proves the two are the same day, not two different spellings.
    const bareSlug = first.slug.slice("2025-11-15-".length);
    const found = findDayForDate(OWNER, TRIP_ID, "2025-11-15");
    expect(found).toMatchObject({ slug: bareSlug, status: "draft" });
  });

  test("a second entry on the occupied date is still allowed — the flow's own guard, not this function", async () => {
    const first = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-15",
      title: "Arriving in Lisbon",
      time: "09:00",
      location: "Lisbon",
      declined: {},
    });
    expect(first.ok).toBe(true);

    // `createDayTransactional` itself never refuses a second entry on an
    // occupied date — D3's collision check lives in the route
    // (`app/api/helper/[user]/day/new/route.ts`), which is what `findDayForDate`
    // exists to serve. A second day-of, distinguished by `time` as the spec
    // requires, writes cleanly at this layer.
    const second = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-15",
      title: "Out for dinner",
      time: "20:30",
      location: "Lisbon",
      declined: {},
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) throw new Error("expected both days to be written");
    expect(second.slug).not.toBe(first.slug);
    expect(fs.readdirSync(tripsDir(), { withFileTypes: true }).filter((e) => e.isFile())).toHaveLength(2);
  });

  test("no day on the date answers null", () => {
    expect(findDayForDate(OWNER, TRIP_ID, "2025-12-25")).toBeNull();
  });
});

/** B2233 — costs, how you travelled and tags ride the composer's one save. */
describe("createDayTransactional — B2233, costs, transport and tags", () => {
  test("given values are written and read back, and none is declined", async () => {
    const costs = [{ label: "Bus to the pass", amount: 12.4, currency: "CHF" }];
    const result = await createDayTransactional(OWNER, {
      tripId: TRIP_ID,
      date: "2025-11-13",
      costs,
      transportMode: "bus",
      tags: ["pass", "snow-day"],
      declined: { costs: "nothing was spent on this day", tags: "no tags for this day at all" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug)!;
    expect(stored.costs).toEqual(costs);
    expect(stored.transportMode).toBe("bus");
    expect(stored.tags).toEqual(["pass", "snow-day"]);
    // A value wins over a decline sent alongside it: never both.
    expect(stored.declined?.costs).toBeUndefined();
    expect(stored.declined?.tags).toBeUndefined();
  });

  test("blank stays blank: nothing given, nothing written and nothing declined", async () => {
    const result = await createDayTransactional(OWNER, { tripId: TRIP_ID, date: "2025-11-14", costs: [], tags: [], declined: {} });
    if (!result.ok) throw new Error("expected the day to be written");
    const stored = readDayFile(OWNER, TRIP_ID, result.slug)!;
    expect(stored.costs).toBeUndefined();
    expect(stored.transportMode).toBeUndefined();
    expect(stored.tags).toBeUndefined();
    expect(Object.keys(stored.declined ?? {})).toEqual(["visibility"]);
  });

  test.each([
    ["a zero amount", { costs: [{ label: "Lunch", amount: 0, currency: "CHF" }] }],
    ["a currency that is not a code", { costs: [{ label: "Lunch", amount: 5, currency: "Euros" }] }],
    ["a way of travelling that is not on the list", { transportMode: "rocket" }],
    ["a tag that is not a slug", { tags: ["Old Town"] }],
  ])("%s is refused and no day is left behind", async (_what, extra) => {
    const result = await createDayTransactional(OWNER, { tripId: TRIP_ID, date: "2025-11-15", declined: {}, ...extra });
    expect(result.ok).toBe(false);
    expect(fs.readdirSync(tripsDir(), { withFileTypes: true }).filter((e) => e.isFile())).toHaveLength(0);
  });
});
