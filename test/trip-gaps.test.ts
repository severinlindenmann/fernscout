import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { forgetEntries } from "@/lib/entries";
import { tripGaps } from "@/lib/api/tripGaps";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "@/lib/api/v2/documents";

/**
 * B532 — a trip with a budget and no day-level spending read as complete.
 *
 * The import run behind B531 wrote fourteen days and left the money behind.
 * B531 stops the next one at the moment a day is written; this is the reading
 * that would have caught the trip that already had — a budget over ten days
 * beside zero days recording anything, and a date in the middle of the trip
 * with three receipts and no day to hang them on.
 */

let dir: string;
const REF = "alex/reise";

// Not on writeDayFixture (B1630): `costs` is a real day field
// (lib/api/v2/documents.ts's `DayFile`), not a frontmatter detail, but the
// shared fixture does not expose it yet. Written through the production
// serialiser so it cannot drift from what the reader parses.
function writeDay(date: string, slug: string, costs = false) {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  const day: DayFile = {
    slug,
    title: slug,
    date,
    location: "Basel",
    country: "Schweiz",
    content: "Etwas.",
    status: "published",
    ...(costs ? { costs: [{ label: "Kaffee", amount: 4.5, category: "food" }] } : {}),
  };
  fs.writeFileSync(path.join(dir, "alex", "trips", "reise", "entries", `${date}-${slug}.json`), dayToJson(day));
  forgetEntries(REF);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-gaps-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  const trip: TripFile = {
    id: "reise",
    title: "Reise",
    dates: { from: "2026-06-26", to: "2026-06-30" },
    visibility: "public",
    people: [],
    intro: "Body.",
  };
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "trips", "reise", "trip.json"), tripToJson(trip));
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a trip is visibly missing", () => {
  test("a budget beside days that record nothing is said out loud", () => {
    writeDay("2026-06-26", "eins");
    writeDay("2026-06-27", "zwei");
    const gaps = tripGaps(REF, true)!;
    expect(gaps.days).toBe(2);
    expect(gaps.daysWithCosts).toBe(0);
    expect(gaps.note).toMatch(/budget and not one of its 2 days/);
    // Said, not blamed: a trip may perfectly well keep only a budget.
    expect(gaps.note).toMatch(/That may be right/);
  });

  test("days that do record spending say nothing", () => {
    writeDay("2026-06-26", "eins", true);
    const gaps = tripGaps(REF, true)!;
    expect(gaps.daysWithCosts).toBe(1);
    expect(gaps.note ?? "").not.toMatch(/budget and not one/);
  });

  test("a date inside the trip with no day at all is named", () => {
    // The reporting run's own gap: three bookings on 28 June and no day.
    writeDay("2026-06-26", "eins", true);
    writeDay("2026-06-27", "zwei", true);
    writeDay("2026-06-29", "drei", true);
    writeDay("2026-06-30", "vier", true);
    const gaps = tripGaps(REF, true)!;
    expect(gaps.datesWithoutADay).toEqual(["2026-06-28"]);
    expect(gaps.datesWithoutADayCount).toBe(1);
    expect(gaps.note).toMatch(/nowhere to hang/);
  });

  test("a trip with no days at all is not nagged about every date in its range", () => {
    // An upcoming trip is empty on purpose, and listing sixty dates as gaps
    // is noise rather than a finding.
    const gaps = tripGaps(REF, true)!;
    expect(gaps.days).toBe(0);
    expect(gaps.note).toBeUndefined();
  });

  test("the named dates are capped, and the true number is still reported", () => {
    const tripFile = path.join(dir, "alex", "trips", "reise", "trip.json");
    const trip = JSON.parse(fs.readFileSync(tripFile, "utf8"));
    trip.dates.to = "2026-08-30";
    fs.writeFileSync(tripFile, JSON.stringify(trip));
    clearConfigCache();
    writeDay("2026-06-26", "eins");
    const gaps = tripGaps(REF, false)!;
    expect(gaps.datesWithoutADay).toHaveLength(14);
    expect(gaps.datesWithoutADayCount).toBeGreaterThan(60);
  });
});
