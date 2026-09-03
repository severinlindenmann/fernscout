import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import { getAllCosts, getBudget, getCostSummary, getPreparationCosts } from "@/lib/costs";

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
  const afterDeparture = new Date("2027-06-01T12:00:00Z");

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
    const summary = getCostSummary("u/gamma-2027", afterDeparture);
    expect(summary.hasBegun).toBe(true);
    expect(summary.budget?.pace).toEqual({
      expectedToDate: 100,
      deltaToDate: 0,
      projectedTotal: 100,
      curve: [],
    });
  });

  test("a trip under way and a finished trip are untouched", () => {
    // Every figure the panel draws for alpha-2023, spelled out: 240 of
    // preparation, two logged days of 60 and 12, a 1200 budget over 10 days.
    expect(getCostSummary("u/alpha-2023").budget).toEqual({
      total: 1200,
      days: 10,
      perDay: 96,
      remaining: 888,
      pace: {
        expectedToDate: 432,
        deltaToDate: -120,
        projectedTotal: 600,
        curve: [336, 432],
      },
    });
    const beta = getCostSummary("u/beta-2026");
    expect(beta.budget).toBeUndefined(); // declares none
    expect(beta.byDay).toEqual([{ date: "2026-08-15", amount: 20, cumulative: 20 }]);
  });
});
