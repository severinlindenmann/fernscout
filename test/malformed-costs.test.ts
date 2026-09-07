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

const GOOD_TRIP =
  '---\nid: asia-2023\ntitle: "A Trip"\nstart: "2024-01-01"\nend: "2024-01-09"\nstatus: past\n---\n\nx\n';

const BROKEN_COSTS = `---\nbudget: [unterminated\n---\n\nx\n`;

const GOOD_COSTS = '---\nbudget:\n  total: 1000\n  currency: CHF\n---\n\nx\n';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-costs-"));
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

function writeCosts(dir: string, body: string): void {
  fs.writeFileSync(path.join(dir, "u", "trips", "asia-2023", "costs.md"), body);
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
  test("a costs.md whose frontmatter will not parse reads as null, not thrown", () => {
    const dir = journal();
    writeTrip(dir);
    writeCosts(dir, BROKEN_COSTS);

    expect(() => readCostsFile("u/asia-2023")).not.toThrow();
    expect(readCostsFile("u/asia-2023")).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("costs.md");
  });

  test("callers built on it degrade rather than throw", () => {
    const dir = journal();
    writeTrip(dir);
    writeCosts(dir, BROKEN_COSTS);

    expect(() => hasCostsData("u/asia-2023")).not.toThrow();
    expect(hasCostsData("u/asia-2023")).toBe(false);
    expect(() => costsAvailable("u")).not.toThrow();
  });

  test("a good costs.md is unaffected by the guard", () => {
    const dir = journal();
    writeTrip(dir);
    writeCosts(dir, GOOD_COSTS);

    expect(readCostsFile("u/asia-2023")).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test("clears when the file is fixed, without a restart", () => {
    const dir = journal();
    writeTrip(dir);
    writeCosts(dir, BROKEN_COSTS);
    expect(readCostsFile("u/asia-2023")).toBeNull();

    writeCosts(dir, GOOD_COSTS);
    expect(readCostsFile("u/asia-2023")).not.toBeNull();
  });
});
