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

const GOOD_TRIP =
  '---\nid: asia-2023\ntitle: "A Trip"\nstart: "2024-01-01"\nend: "2024-01-09"\nstatus: past\n---\n\nx\n';

const BROKEN_PLAN = `---\nroute: [unterminated\n---\n\nx\n`;

const GOOD_PLAN =
  '---\nroute:\n  - location: "Faro"\n    country: "Portugal"\n    lat: 37.0194\n    lng: -7.9304\n---\n\nx\n';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-plan-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

function writeTrip(dir: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", "asia-2023"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "trip.md"), GOOD_TRIP);
}

function writePlan(dir: string, body: string): void {
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "plan.md"), body);
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
  test("a plan.md whose frontmatter will not parse reads as empty, not thrown", () => {
    const dir = journal();
    writeTrip(dir);
    writePlan(dir, BROKEN_PLAN);

    expect(() => getPlan("u/asia-2023")).not.toThrow();
    expect(getPlan("u/asia-2023")).toEqual({ stops: [], reachedCount: 0, next: undefined });
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("plan.md");
  });

  test("a good plan.md is unaffected by the guard", () => {
    const dir = journal();
    writeTrip(dir);
    writePlan(dir, GOOD_PLAN);

    const plan = getPlan("u/asia-2023");
    expect(plan.stops.map((s) => s.location)).toEqual(["Faro"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("clears when the file is fixed, without a restart", () => {
    const dir = journal();
    writeTrip(dir);
    writePlan(dir, BROKEN_PLAN);
    expect(getPlan("u/asia-2023").stops).toEqual([]);

    writePlan(dir, GOOD_PLAN);
    expect(getPlan("u/asia-2023").stops.map((s) => s.location)).toEqual(["Faro"]);
  });
});
