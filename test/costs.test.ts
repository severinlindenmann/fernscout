import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAllCosts, getBudget, getCostSummary, getPreparationCosts } from "@/lib/costs";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

beforeEach(() => {
  process.env.CONTENT_DIR = path.join(process.cwd(), "test", "fixtures", "content");
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("costs per trip", () => {
  test("preparation comes from that trip's costs.md", () => {
    expect(getPreparationCosts("u/alpha-2023")).toEqual([
      // No `currency:` in the frontmatter, so it reads as the site's base
      // currency and converts to itself.
      { label: "Flights", amount: 240, currency: "CHF", base: 240, category: "flights" },
    ]);
    expect(getPreparationCosts("u/beta-2026")).toEqual([]);
  });

  test("budget is read per trip and absent where undeclared", () => {
    expect(getBudget("u/alpha-2023")).toEqual({ total: 1200, days: 10 });
    expect(getBudget("u/beta-2026")).toBeUndefined();
  });

  test("totals cover preparation plus that trip's entries only", () => {
    // 240 flights + 60 accommodation + 12 transport
    expect(getCostSummary("u/alpha-2023").total).toBe(312);
    // 20 accommodation, no preparation
    expect(getCostSummary("u/beta-2026").total).toBe(20);
  });

  test("all costs carry the entry's place", () => {
    const onTheRoad = getAllCosts("u/alpha-2023").filter((c) => c.date);
    expect(onTheRoad.map((c) => c.location)).toEqual(["Faro", "Lagos"]);
  });

  test("an unknown trip totals zero rather than throwing", () => {
    expect(getCostSummary("u/no-such-trip").total).toBe(0);
  });
});

/**
 * B19 — a trip that has not left yet.
 *
 * Every "so far" figure on the costs page is arithmetic over the days already
 * logged, and before departure there are none. The arithmetic is not wrong;
 * the question is. Found on a public demo journal fourteen months ahead of its
 * own start date, where the page reported a daily average of 0, a projected
 * total of a fifth of the budget, a verdict on the pace ("exactly on plan so
 * far") and two charts drawing empty axes under headings promising a
 * day-by-day breakdown.
 *
 * The fix is one flag decided here rather than in the component, so these
 * assertions are the whole guarantee: `pace` is absent before departure and
 * unchanged after it.
 */
describe("a trip that has not begun", () => {
  // gamma-2027 leaves on 2027-04-02 and has a budget and a visa paid for.
  const beforeDeparture = new Date("2026-06-01T12:00:00Z");
  // Within the trip's own dates (2027-04-02 to 2027-04-23) — `isOver`
  // (lib/tripTime.ts) reads `trip.status`, which `getTrip` derives from the
  // *real* clock at read time, not from this injected `now`. A date past
  // the trip's own end read as "not over" only because the real clock
  // hadn't reached 2027-04-02 yet either (B1947) — pin it here so the two
  // clocks agree regardless of when the suite runs.
  const afterDeparture = new Date("2027-04-10T12:00:00Z");

  test("says so, rather than leaving it to be inferred from a zero", () => {
    expect(getCostSummary("u/gamma-2027", beforeDeparture).hasBegun).toBe(false);
    expect(getCostSummary("u/alpha-2023").hasBegun).toBe(true);
    expect(getCostSummary("u/beta-2026").hasBegun).toBe(true);
  });

  test("the budget is a plan, with nothing measured against it", () => {
    const summary = getCostSummary("u/gamma-2027", beforeDeparture);
    // What the author wrote down, and what preparation has taken out of it.
    expect(summary.budget).toEqual({
      total: 2000,
      days: 20,
      perDay: 95, // (2000 − 100 of visas) / 20
      remaining: 1900,
    });
    // No pace: no expected-to-date, no delta, no projection, no curve.
    expect(summary.budget?.pace).toBeUndefined();
  });

  test("the real numbers are still there", () => {
    const summary = getCostSummary("u/gamma-2027", beforeDeparture);
    expect(summary.preparation).toBe(100);
    expect(summary.total).toBe(100);
    expect(summary.byDay).toEqual([]);
    expect(summary.items.map((i) => i.label)).toEqual(["Visas"]);
  });

  test("the pace comes back the day the trip starts", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(afterDeparture);
    let summary;
    try {
      summary = getCostSummary("u/gamma-2027", afterDeparture);
    } finally {
      vi.useRealTimers();
    }
    expect(summary.hasBegun).toBe(true);
    expect(summary.isOver).toBe(false);
    expect(summary.budget?.pace).toEqual({
      expectedToDate: 100,
      deltaToDate: 0,
      projectedTotal: 100,
      projectedFromDays: 0,
      curve: [],
    });
  });

  /**
   * B1521 — alpha-2023 is `status: past`, and a finished trip has nothing
   * left to project. This test used to assert the opposite (a `pace` block,
   * "untouched" by the trip having ended) — that was the bug: an average of
   * the two logged days charged forward across all ten planned ones. Fixed,
   * the budget itself is still exactly what the author wrote down; only the
   * forecast is gone.
   */
  test("a finished trip keeps its plain numbers and drops the forecast", () => {
    const summary = getCostSummary("u/alpha-2023");
    expect(summary.isOver).toBe(true);
    // Every figure the panel still draws: 240 of preparation, two logged
    // days of 60 and 12, a 1200 budget over 10 days.
    expect(summary.budget).toEqual({
      total: 1200,
      days: 10,
      perDay: 96,
      remaining: 888,
    });
  });

  test("a trip under way with no declared budget is untouched", () => {
    const beta = getCostSummary("u/beta-2026");
    expect(beta.budget).toBeUndefined(); // declares none
    expect(beta.byDay).toEqual([{ date: "2026-08-15", amount: 20, cumulative: 20, unrecorded: false }]);
  });
});

/**
 * B2308 — `byCountry` used to filter `amount > 0`, so a country visited but
 * never costed vanished from it entirely. The trip hero's "days per country"
 * card is about days, not money, and needs every country the reader was
 * actually in; only the money-subject consumer (the costs page) filters
 * `amount > 0` itself now.
 */
describe("byCountry keeps a country with nothing spent in it", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-bycountry-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
    );
    fs.mkdirSync(path.join(dir, "owner"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "owner", "config.json"),
      JSON.stringify({
        title: "U",
        tagline: "t",
        owner: { name: "A B", nickname: "A" },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    );
    writeTripFixture("owner", { id: "trip", start: "2026-01-01", end: "2026-01-05" });
    writeDayFixture(dir, "owner", "trip", {
      slug: "spent",
      date: "2026-01-01",
      country: "Portugal",
      countryCode: "PT",
      costs: [{ label: "Bus", amount: 10 }],
    });
    writeDayFixture(dir, "owner", "trip", {
      slug: "free",
      date: "2026-01-02",
      country: "Spain",
      countryCode: "ES",
    });
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("both countries are in the list, the uncosted one at zero", () => {
    const summary = getCostSummary("owner/trip");
    expect(summary.byCountry).toEqual([
      { country: "Portugal", countryCode: "PT", amount: 10, nights: 1, perDay: 10 },
      { country: "Spain", countryCode: "ES", amount: 0, nights: 1, perDay: 0 },
    ]);
  });
});
