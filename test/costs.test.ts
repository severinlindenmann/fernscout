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
