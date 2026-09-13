import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readCostsFile, hasCostsData, costsAvailable } from "@/lib/costs";

/**
 * `costs.md` may hold frontmatter `matter()` cannot parse — the same failure
 * B236 guarded against for an entry and B313 for `plan.md`. Before B342
 * `readCostsFile` threw straight out of `matter()`, and it backs
 * `hasCostsData`, `costsAvailable`, `getPreparationCosts`, `getBudget`, the
 * trip page, both costs pages, the costs API route and `app/sitemap.ts` — so
 * a typo in an optional file took the nav's Costs tab, and the sitemap, down
 * with it for the whole journal. These pin the fix: a malformed `costs.md`
 * reads as "no costs.md" and logs a warning, same shape as
 * `test/malformed-plan.test.ts`.
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

// B1606 folded `costs.md` into `trip.json`'s own `costs` section, so there is
// no longer a *separate* file to malform while the trip itself reads fine.
// The nearest equivalent is a `costs` section present with the wrong shape —
// no `budget`, which the write schema requires but `tripFromJson` casts
// through unchecked on read — and `readCostsFile` (lib/costs.ts) now guards
// against exactly that, degrading to `null` with a warning rather than
// throwing out of `section.budget.days`.
const BROKEN_TRIP = JSON.stringify({ ...TRIP_BASE, costs: {} });

const GOOD_TRIP = JSON.stringify({
  ...TRIP_BASE,
  costs: { budget: { total: 1000, currency: "CHF" } },
});

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-costs-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

// Not on writeTripFixture (B1630): the journal here is deliberately "u", a
// one-character username `isValidUsername` refuses, so `createTrip`'s
// `getUser` call fails with `no_such_journal` before it can write anything.
// Same resistance as test/malformed-entries.test.ts and test/malformed-plan.test.ts.
function writeTrip(dir: string, body: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", "asia-2023"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "trip.json"), body);
}

/** Silences the `[costs]` warning this fixture deliberately provokes. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  warn.mockRestore();
});

describe("readCostsFile", () => {
  test("a costs section with no usable budget reads as null, not thrown", () => {
    const dir = journal();
    writeTrip(dir, BROKEN_TRIP);

    expect(() => readCostsFile("u/asia-2023")).not.toThrow();
    expect(readCostsFile("u/asia-2023")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("callers built on it degrade rather than throw", () => {
    const dir = journal();
    writeTrip(dir, BROKEN_TRIP);

    expect(() => hasCostsData("u/asia-2023")).not.toThrow();
    expect(hasCostsData("u/asia-2023")).toBe(false);
    expect(() => costsAvailable("u")).not.toThrow();
  });

  test("a good costs section is unaffected by the guard", () => {
    const dir = journal();
    writeTrip(dir, GOOD_TRIP);

    expect(readCostsFile("u/asia-2023")).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("clears when the file is fixed, without a restart", () => {
    const dir = journal();
    writeTrip(dir, BROKEN_TRIP);
    expect(readCostsFile("u/asia-2023")).toBeNull();

    writeTrip(dir, GOOD_TRIP);
    expect(readCostsFile("u/asia-2023")).not.toBeNull();
  });
});
