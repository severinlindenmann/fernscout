import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, editEntry } from "@/lib/api/entries";
import { getAllEntries } from "@/lib/entries";

/**
 * B542 — a cost written without a `currency` is stamped with the day's own,
 * not the journal's `baseCurrency`, wherever the day says where it was.
 *
 * The day already knows: `country:` first, `lat`/`lng` through
 * `reverseGeocode` second, and only when neither says anything does the old
 * `baseCurrency` default survive. Resolved and written once, at write time —
 * `parseCostItems`'s read-time default (still `baseCurrency`) never sees a
 * currency-less line these paths have touched.
 */

let dir: string;
const REF = "alex/reise";

function writeTrip() {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", 'title: "Reise"', 'start: "2026-01-01"', 'end: "2026-01-31"', "status: current", "---", "", "Body.", ""].join(
      "\n",
    ),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cost-currency-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      baseCurrency: "CHF",
      features: { costs: { enabled: true } },
    }),
  );
  writeTrip();
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function firstCost() {
  return getAllEntries(REF, { includeDrafts: true })[0].costs[0];
}

describe("a currency-less cost, resolved from where the day was", () => {
  test("country: Thailand → THB", () => {
    const result = createDraft(REF, {
      title: "Noodle soup",
      date: "2026-01-05",
      country: "Thailand",
      content: "Lunch in Chiang Mai.",
      costs: [{ label: "Noodle soup", amount: 120 }],
    });
    expect(result.ok && result.costCurrency).toBe("THB");
    expect(firstCost()).toMatchObject({ amount: 120, currency: "THB" });
  });

  test("no country, but lat/lng in Chiang Mai → THB", () => {
    const result = createDraft(REF, {
      title: "Noodle soup 2",
      date: "2026-01-06",
      lat: 18.7883,
      lng: 98.9853,
      content: "Lunch again.",
      costs: [{ label: "Noodle soup", amount: 120 }],
    });
    expect(result.ok && result.costCurrency).toBe("THB");
    expect(firstCost()).toMatchObject({ currency: "THB" });
  });

  test("neither country nor coordinates → the journal's base currency", () => {
    const result = createDraft(REF, {
      title: "Somewhere",
      date: "2026-01-07",
      content: "No place recorded.",
      costs: [{ label: "Coffee", amount: 5 }],
    });
    expect(result.ok && result.costCurrency).toBe("CHF");
    expect(firstCost()).toMatchObject({ currency: "CHF" });
  });

  test("a cost line that names its own currency is untouched", () => {
    const result = createDraft(REF, {
      title: "Souvenir",
      date: "2026-01-08",
      country: "Thailand",
      content: "Bought a hat.",
      costs: [{ label: "Hat", amount: 10, currency: "USD" }],
    });
    expect(result.ok && result.costCurrency).toBeUndefined();
    expect(firstCost()).toMatchObject({ currency: "USD" });
  });

  test("a PATCH on a day with no place at all falls back rather than reading a NaN", () => {
    // `Number(undefined)` is a NaN that is typed `number`, so the coordinate
    // branch has to test for finiteness rather than for the type.
    createDraft(REF, { title: "Placeless", date: "2026-01-10", content: "Nowhere in particular." });
    const result = editEntry(REF, "placeless", { costs: [{ label: "Coffee", amount: 5 }] });
    expect(result.ok && result.costCurrency).toBe("CHF");
    expect(firstCost()).toMatchObject({ label: "Coffee", currency: "CHF" });
  });

  test("a PATCH adding costs uses the day's own country already on disk", () => {
    createDraft(REF, { title: "Chiang Mai day", date: "2026-01-09", country: "Thailand", content: "Arrived." });
    const result = editEntry(REF, "chiang-mai-day", { costs: [{ label: "Tuk-tuk", amount: 60 }] });
    expect(result.ok && result.costCurrency).toBe("THB");
    expect(firstCost()).toMatchObject({ label: "Tuk-tuk", currency: "THB" });
  });
});
