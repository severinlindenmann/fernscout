import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { daysForEditPicker, dayForEdit } from "@/lib/studio/editDay";

/**
 * B1831, E1 — "Change a day"'s own picker read: entries grouped by date,
 * within a trip, drafts and published marked, and the same lookup the deep
 * link (D4) and the collision screen's own "Change instead" link
 * (`AddDayFlow`) both send a person to.
 *
 * B1881 rewrote the shape: D3 (spec §1) settled that several entries may
 * share a date, and the picker used to collapse a date down to one row —
 * its lead entry only — so a second entry was never findable by its own
 * title, and opening that row edited every entry on the date at once. This
 * lists entries, not days.
 */

const OWNER = "alex";

let dir: string;

function writeJournal() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-edit-day-"));
  process.env.CONTENT_DIR = dir;
  clearUserCache();
  writeJournal();

  writeTripFixture(OWNER, {
    id: "alps",
    title: "Round the Alps",
    start: "2026-01-01",
    end: "2026-01-10",
    status: "past",
    visibility: "public",
  });
  writeTripFixture(OWNER, {
    id: "kyoto",
    title: "Kyoto",
    start: "2026-06-01",
    end: "2026-06-10",
    status: "past",
    visibility: "public",
  });
  writeDayFixture(dir, OWNER, "alps", { slug: "arrival", date: "2026-01-02", title: "Arrival day", status: "published" });
  writeDayFixture(dir, OWNER, "alps", { slug: "still-unpacking", date: "2026-01-03", title: "Still unpacking", status: "draft" });
  writeDayFixture(dir, OWNER, "kyoto", { slug: "temples", date: "2026-06-02", title: "Temples", status: "published" });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("daysForEditPicker — E1's own list", () => {
  test("every trip is its own group, days in date order, each marked draft or published", () => {
    // getTrips (lib/trips.ts) orders past trips most-recent-first by `end` —
    // Kyoto's trip ends later than the Alps', so it sorts first here too;
    // this is that ordering, not a bug in the picker.
    const groups = daysForEditPicker(OWNER);
    expect(groups.map((g) => g.tripTitle)).toEqual(["Kyoto", "Round the Alps"]);

    // `slug` here is the bare, app-facing slug (`Entry.slug`,
    // `entrySlugFromFile` in lib/entries.ts) — the same value `OwnerTools`'
    // own deep link and `AddDayFlow`'s collision screen already address a
    // day by, not the date-prefixed on-disk filename stem.
    const alps = groups.find((g) => g.tripId === "alps")!;
    expect(alps.days).toEqual([
      { date: "2026-01-02", entries: [{ slug: "arrival", title: "Arrival day", time: undefined, status: "published" }] },
      { date: "2026-01-03", entries: [{ slug: "still-unpacking", title: "Still unpacking", time: undefined, status: "draft" }] },
    ]);
  });

  // B1954 — the picker's own order is by the most recent *entry* date in a
  // trip, not the trip's own declared date range, so a trip still being
  // added to today surfaces first even when its own dates are the oldest of
  // the three. This is the fixture that pulls those two orders apart: by
  // trip dates, Alps (Jan) < Kyoto (Jun) < Patagonia (Mar) — Kyoto wins. By
  // last-entry date, Patagonia's own entry (2026-08-01) is the newest of
  // the three, and it must lead.
  test("orders trips by their most recently written entry, not their own declared dates — B1954", () => {
    writeTripFixture(OWNER, {
      id: "patagonia",
      title: "Patagonia",
      start: "2026-03-01",
      end: "2026-03-15",
      status: "past",
      visibility: "public",
    });
    writeDayFixture(dir, OWNER, "patagonia", { slug: "torres", date: "2026-08-01", title: "Torres del Paine, finally written up", status: "published" });

    const groups = daysForEditPicker(OWNER);
    expect(groups.map((g) => g.tripId)).toEqual(["patagonia", "kyoto", "alps"]);
  });

  test("a trip with no days yet is still listed, with an empty list — never silently dropped", () => {
    writeTripFixture(OWNER, { id: "empty-trip", title: "Not started", start: "2026-09-01", end: "2026-09-05", status: "upcoming", visibility: "private" });
    const groups = daysForEditPicker(OWNER);
    const empty = groups.find((g) => g.tripId === "empty-trip");
    expect(empty).toBeDefined();
    expect(empty!.days).toEqual([]);
  });

  // B1881's own case — the example journal's two Lisbon entries, both dated
  // 2025-11-15, told apart only by their own titles and times.
  test("a second entry sharing a date is its own row, findable by its own title — B1881", () => {
    writeTripFixture(OWNER, { id: "portugal", title: "Portugal", start: "2025-11-10", end: "2025-11-20", status: "past", visibility: "public" });
    writeDayFixture(dir, OWNER, "portugal", {
      slug: "into-italy",
      date: "2025-11-15",
      title: "Into Italy",
      status: "published",
      time: "09:00",
    });
    writeDayFixture(dir, OWNER, "portugal", {
      slug: "we-stayed-for-dinner",
      date: "2025-11-15",
      title: "We stayed for dinner",
      status: "published",
      time: "19:30",
    });

    const groups = daysForEditPicker(OWNER);
    const portugal = groups.find((g) => g.tripId === "portugal")!;

    // One date, one group — not two rows that both claim 2025-11-15.
    expect(portugal.days).toHaveLength(1);
    const [day] = portugal.days;
    expect(day.date).toBe("2025-11-15");

    // Both entries present, each under its own title and time — this is
    // the assertion a picker that still collapsed to one lead-entry row
    // per day would fail: "We stayed for dinner" would not appear at all.
    expect(day.entries).toEqual([
      { slug: "into-italy", title: "Into Italy", time: "09:00", status: "published" },
      { slug: "we-stayed-for-dinner", title: "We stayed for dinner", time: "19:30", status: "published" },
    ]);
  });
});

describe("dayForEdit — the deep link's own lookup, by entry slug", () => {
  test("finds the day and the trip it belongs to, whichever trip that is", () => {
    const found = dayForEdit(OWNER, "temples");
    expect(found?.tripId).toBe("kyoto");
    expect(found?.tripTitle).toBe("Kyoto");
    expect(found?.day.lead.title).toBe("Temples");
  });

  test("a slug nobody wrote answers null — E1's own honest 'not found', not a crash", () => {
    expect(dayForEdit(OWNER, "does-not-exist")).toBeNull();
  });

  // B1881 — selecting one entry of a shared date edits that entry alone.
  test("a second entry sharing a date resolves to itself alone, not the whole day", () => {
    writeTripFixture(OWNER, { id: "portugal", title: "Portugal", start: "2025-11-10", end: "2025-11-20", status: "past", visibility: "public" });
    writeDayFixture(dir, OWNER, "portugal", { slug: "into-italy", date: "2025-11-15", title: "Into Italy", status: "published", time: "09:00" });
    writeDayFixture(dir, OWNER, "portugal", { slug: "we-stayed-for-dinner", date: "2025-11-15", title: "We stayed for dinner", status: "published", time: "19:30" });

    const found = dayForEdit(OWNER, "we-stayed-for-dinner");
    expect(found?.day.lead.title).toBe("We stayed for dinner");
    // Not both — the day object carries only the entry that was asked for.
    expect(found?.day.entries).toHaveLength(1);
    expect(found?.day.entries[0].slug).toBe("we-stayed-for-dinner");

    // And the other entry on the same date resolves independently, to
    // itself and nothing else.
    const other = dayForEdit(OWNER, "into-italy");
    expect(other?.day.entries).toHaveLength(1);
    expect(other?.day.entries[0].slug).toBe("into-italy");
  });
});
