import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getPlan } from "@/lib/plan";

/**
 * `plan.md` may hold frontmatter `matter()` cannot parse — the same failure
 * B236 guarded against for an entry and B83 for `trip.md`. Before B313 that
 * one file threw straight out of `readPlanFile` and `getPlan`, and `getPlan`
 * is called from the trip page itself, both map pages, and the photobook
 * source — so a typo in a nice-to-have file took the trip page down with it,
 * which is exactly what `getPlan`'s own doc comment says was ruled out. These
 * pin the fix: a malformed `plan.md` reads as an empty plan and logs a
 * warning, same shape as `test/malformed-entries.test.ts` and
 * `test/malformed-trips.test.ts`.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

const TRIP_BASE = {
  id: "asia-2023",
  title: "A Trip",
  dates: { from: "2024-01-01", to: "2024-01-09" },
};

// FINDING (B1630, not a fixture problem — reported alongside this repoint):
// B1606 folded `plan.md` into `trip.json`'s own `plan` section, so there is
// no longer a *separate* file that can be malformed while the trip itself
// reads fine — a `trip.json` that fails to parse at all is "the whole trip
// is malformed" (test/malformed-trips.test.ts), a different case. The
// nearest equivalent to the old "route: [unterminated" case is a `plan`
// section present with the wrong shape: `tripFromJson` casts `data.plan`
// through with no validation (`lib/api/v2/documents.ts`), so a `route` that
// is not an array is what reaches `readPlanFile`'s own defensive
// `Array.isArray` check.
const BROKEN_TRIP = JSON.stringify({ ...TRIP_BASE, plan: { route: "not-an-array" } });

const GOOD_TRIP = JSON.stringify({
  ...TRIP_BASE,
  plan: { route: [{ location: "Faro", country: "Portugal", lat: 37.0194, lng: -7.9304 }] },
});

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-plan-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

// Not on writeTripFixture (B1630): the journal here is deliberately "u", a
// one-character username `isValidUsername` refuses, so `createTrip`'s
// `getUser` call fails with `no_such_journal` before it can write anything.
// Same resistance as test/malformed-entries.test.ts.
function writeTrip(dir: string, body: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", "asia-2023"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "trip.json"), body);
}

/** Silences the `[plan]` warning this fixture deliberately provokes. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  warn.mockRestore();
});

describe("getPlan", () => {
  test("a plan section with an unusable route reads as empty, not thrown", () => {
    const dir = journal();
    writeTrip(dir, BROKEN_TRIP);

    expect(() => getPlan("u/asia-2023")).not.toThrow();
    expect(getPlan("u/asia-2023")).toEqual({ stops: [], reachedCount: 0, next: undefined });
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("no usable");
  });

  test("a good plan section is unaffected by the guard", () => {
    const dir = journal();
    writeTrip(dir, GOOD_TRIP);

    const plan = getPlan("u/asia-2023");
    expect(plan.stops.map((s) => s.location)).toEqual(["Faro"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("clears when the file is fixed, without a restart", () => {
    const dir = journal();
    writeTrip(dir, BROKEN_TRIP);
    expect(getPlan("u/asia-2023").stops).toEqual([]);

    writeTrip(dir, GOOD_TRIP);
    expect(getPlan("u/asia-2023").stops.map((s) => s.location)).toEqual(["Faro"]);
  });
});
