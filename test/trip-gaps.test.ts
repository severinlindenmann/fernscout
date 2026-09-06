import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { forgetEntries } from "@/lib/entries";
import { tripGaps } from "@/lib/api/tripGaps";

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

function writeDay(date: string, slug: string, costs = false) {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      'location: "Basel"',
      'country: "Schweiz"',
      ...(costs ? ["costs:", '  - { label: "Kaffee", amount: 4.5, category: "food" }'] : []),
      "---",
      "",
      "Etwas.",
      "",
    ].join("\n"),
  );
  forgetEntries(REF);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-gaps-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise"), { recursive: true });
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
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-06-26"',
      'end: "2026-06-30"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
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
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "trip.md"),
      fs
        .readFileSync(path.join(dir, "alex", "trips", "reise", "trip.md"), "utf8")
        .replace('end: "2026-06-30"', 'end: "2026-08-30"'),
    );
    clearConfigCache();
    writeDay("2026-06-26", "eins");
    const gaps = tripGaps(REF, false)!;
    expect(gaps.datesWithoutADay).toHaveLength(14);
    expect(gaps.datesWithoutADayCount).toBeGreaterThan(60);
  });
});
