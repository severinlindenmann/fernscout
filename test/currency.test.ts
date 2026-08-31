import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import {
  crossRate,
  formatMoney,
  normalizeCurrency,
  parseRateTable,
  rateToBase,
  toBase,
} from "@/lib/currency";
import { sumBase, unconvertedIn, convertCosts, parseCostItems } from "@/lib/costFormat";
import { getAllCosts, getBudgetInBase, getCostSummary } from "@/lib/costs";
import { clearRatesCache, currencyOptions, loadEcbRates } from "@/lib/rates";
import { clearConfigCache } from "@/lib/config";
import { getTrip } from "@/lib/trips";

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "currency");

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
  clearConfigCache();
  clearRatesCache();
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearRatesCache();
  vi.restoreAllMocks();
});

describe("rate tables", () => {
  test("codes are normalised, junk is reported and dropped", () => {
    const problems: string[] = [];
    const table = parseRateTable(
      { thb: 0.0245, EUR: "0.94", NOPE: 0, TOOLONG: 2, USD: "not a number" },
      (m) => problems.push(m),
    );
    expect(table).toEqual({ THB: 0.0245, EUR: 0.94 });
    expect(problems).toHaveLength(3);
  });

  test("a currency the table says nothing about has no rate — not a rate of 1", () => {
    // Falling back to 1 is the bug this whole package exists to prevent: it
    // silently turns 450 THB into 450 CHF and the total still looks fine.
    expect(rateToBase("THB", "CHF", {})).toBeUndefined();
    expect(rateToBase("CHF", "CHF", {})).toBe(1);
    expect(toBase(450, "THB", "CHF", {})).toBeUndefined();
    expect(toBase(450, "THB", "CHF", { THB: 0.0245 })).toBeCloseTo(11.025, 6);
  });

  test("a zero or negative rate is refused rather than used", () => {
    expect(rateToBase("THB", "CHF", { THB: 0 })).toBeUndefined();
    expect(rateToBase("THB", "CHF", { THB: -1 })).toBeUndefined();
  });

  test("normalizeCurrency accepts three letters and nothing else", () => {
    expect(normalizeCurrency(" chf ")).toBe("CHF");
    expect(normalizeCurrency("CHFR")).toBe("");
    expect(normalizeCurrency(undefined, "CHF")).toBe("CHF");
  });
});

describe("the second hop, through euro-quoted ECB rates", () => {
  const eur = { CHF: 0.9364, USD: 1.1643, THB: 38.37 };

  test("cross rates go through the euro in both directions", () => {
    expect(crossRate("CHF", "USD", eur)).toBeCloseTo(1.1643 / 0.9364, 9);
    expect(crossRate("USD", "CHF", eur)).toBeCloseTo(0.9364 / 1.1643, 9);
    // Round-tripping a currency must land back where it started.
    expect(crossRate("CHF", "USD", eur)! * crossRate("USD", "CHF", eur)!).toBeCloseTo(1, 12);
  });

  test("the euro itself needs no entry of its own", () => {
    expect(crossRate("EUR", "CHF", eur)).toBeCloseTo(0.9364, 9);
    expect(crossRate("CHF", "EUR", eur)).toBeCloseTo(1 / 0.9364, 9);
  });

  test("an uncovered currency yields no rate", () => {
    expect(crossRate("CHF", "XXQ", eur)).toBeUndefined();
  });
});

describe("formatting", () => {
  test("converted values are marked with ≈ and unconverted ones are not", () => {
    expect(formatMoney(1234.4, "CHF")).toBe("CHF 1’234");
    expect(formatMoney(1234.4, "EUR", { approximate: true })).toBe("≈ EUR 1’234");
    expect(formatMoney(12.5, "THB", { decimals: true })).toBe("THB 12.50");
    expect(formatMoney(-1234, "CHF")).toBe("CHF -1’234");
  });
});

describe("the cached ECB snapshot", () => {
  test("is read from the content folder", () => {
    const snapshot = loadEcbRates();
    expect(snapshot?.date).toBe("2026-08-28");
    expect(snapshot?.rates.THB).toBe(38.37);
  });

  test("is absent, not fatal, when the content folder has none", () => {
    process.env.CONTENT_DIR = path.join(process.cwd(), "test", "fixtures", "content");
    clearConfigCache();
    clearRatesCache();
    expect(loadEcbRates()).toBeUndefined();
    // …and the reader is simply offered the base currency alone.
    expect(currencyOptions("u").currencies).toEqual(["CHF"]);
  });
});

describe("the reader's currency list", () => {
  test("offers the base first, then everything a rate reaches", () => {
    const options = currencyOptions("u");
    expect(options.base).toBe("CHF");
    expect(options.currencies).toEqual(["CHF", "EUR", "USD", "VND"]);
    expect(options.rates.CHF).toBe(1);
    expect(options.rates.USD).toBeCloseTo(1.1643 / 0.9364, 9);
    expect(options.asOf).toBe("2026-08-28");
  });

  test("site.manualRates covers what the ECB does not publish", () => {
    // VND is absent from the ECB table; the manual rate is euro-quoted, so
    // 1 CHF = 30000 / 0.9364 VND.
    expect(currencyOptions("u").rates.VND).toBeCloseTo(30000 / 0.9364, 6);
  });

  test("a configured currency with no rate anywhere is dropped, loudly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = currencyOptions("u");
    expect(options.currencies).not.toContain("XXQ");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("XXQ"));
  });
});

describe("aggregation across currencies", () => {
  // thai-2026: 300 CHF prep, then 450 THB + 20 EUR + 15 CHF + 800 THB,
  // at this trip's rates of THB 0.0245 and EUR 0.94.
  const FOOD = 450 * 0.0245; // 11.025
  const BED = 20 * 0.94; //     18.8
  const SIM = 15; //            15
  const TRAIN = 800 * 0.0245; // 19.6
  const TOTAL = 300 + FOOD + BED + SIM + TRAIN; // 364.425

  test("three currencies in one trip are converted, then summed", () => {
    const summary = getCostSummary("u/thai-2026");
    expect(summary.baseCurrency).toBe("CHF");
    expect(summary.total).toBeCloseTo(TOTAL, 9);
    expect(summary.preparation).toBeCloseTo(300, 9);
    expect(summary.onTheRoad).toBeCloseTo(FOOD + BED + SIM + TRAIN, 9);
    expect(summary.unconverted).toEqual([]);
  });

  test("the raw numbers are never added together", () => {
    // 300 + 450 + 20 + 15 + 800. A plausible-looking, badly wrong total, and
    // the single failure this whole design is arranged to make impossible.
    expect(getCostSummary("u/thai-2026").total).not.toBeCloseTo(1585, 6);
  });

  test("the original amount and currency survive conversion untouched", () => {
    const food = getAllCosts("u/thai-2026").find((c) => c.label === "Street food")!;
    expect(food.amount).toBe(450);
    expect(food.currency).toBe("THB");
    expect(food.base).toBeCloseTo(FOOD, 9);
  });

  test("a cost with no currency is read as the base currency", () => {
    const sim = getAllCosts("u/thai-2026").find((c) => c.label === "SIM card")!;
    expect(sim.currency).toBe("CHF");
    expect(sim.base).toBe(15);
  });

  test("category and country splits are converted too, and reconcile", () => {
    const summary = getCostSummary("u/thai-2026");
    const food = summary.byCategory.find((c) => c.category === "food")!;
    expect(food.amount).toBeCloseTo(FOOD, 9);
    expect(summary.byCategory.reduce((n, c) => n + c.amount, 0)).toBeCloseTo(TOTAL, 9);

    const thailand = summary.byCountry.find((c) => c.country === "Thailand")!;
    expect(thailand.amount).toBeCloseTo(FOOD + BED + SIM + TRAIN, 9);
  });

  test("the per-day series and its running total are in the base currency", () => {
    const summary = getCostSummary("u/thai-2026");
    expect(summary.byDay.map((d) => d.amount)).toEqual([
      expect.closeTo(FOOD + BED + SIM, 9),
      expect.closeTo(TRAIN, 9),
    ]);
    expect(summary.byDay.at(-1)!.cumulative).toBeCloseTo(TOTAL, 9);
  });
});

describe("two trips, the same currency, different rates", () => {
  test("450 THB is worth what it was worth on each trip", () => {
    const then = getCostSummary("u/thai-2026").items.find((c) => c.label === "Street food")!;
    const later = getCostSummary("u/thai-2029").items.find((c) => c.label === "Street food")!;

    expect(then.amount).toBe(later.amount);
    expect(then.currency).toBe(later.currency);
    expect(then.base).toBeCloseTo(450 * 0.0245, 9);
    expect(later.base).toBeCloseTo(450 * 0.03, 9);
    expect(then.base).not.toBeCloseTo(later.base!, 6);
  });

  test("neither trip's table leaks into the other", () => {
    expect(getTrip("u/thai-2026")!.rates).toEqual({ THB: 0.0245, EUR: 0.94 });
    expect(getTrip("u/thai-2029")!.rates).toEqual({ THB: 0.03 });
    // gap-2026 knows nothing about baht even though its sibling trips do.
    expect(getTrip("u/gap-2026")!.rates.THB).toBeUndefined();
  });
});

describe("budget against actual, with mixed currencies", () => {
  test("the plan and the spend are compared in the same currency", () => {
    const summary = getCostSummary("u/thai-2026");
    const budget = summary.budget!;

    expect(budget.total).toBe(1000);
    expect(budget.days).toBe(10);
    // (1000 planned − 300 already spent on preparation) / 10 days
    expect(budget.perDay).toBeCloseTo(70, 9);
    // Two days logged, so 300 + 2 × 70 if we were exactly on plan.
    expect(budget.expectedToDate).toBeCloseTo(440, 9);
    expect(budget.deltaToDate).toBeCloseTo(summary.total - 440, 9);
    expect(budget.remaining).toBeCloseTo(1000 - summary.total, 9);
    // Under plan — which it is not if the raw baht are added in as francs.
    expect(budget.deltaToDate).toBeLessThan(0);
  });

  test("a budget written in a foreign currency is converted before it is shown", () => {
    // The countdown page shows a planned budget with no spend beside it; it
    // must still be in the base currency, not whatever the budget was
    // written in.
    expect(getBudgetInBase("u/thai-2026")).toEqual({ total: 1000, days: 10 });
    expect(getBudgetInBase("u/budget-thb-2027")).toBeUndefined();
  });

  test("a budget in an unrateable currency draws no comparison at all", () => {
    const summary = getCostSummary("u/budget-thb-2027");
    expect(summary.budget).toBeUndefined();
    expect(summary.unconverted).toEqual([{ currency: "THB", amount: 50000, count: 1 }]);
    // The spend that could be converted is still reported.
    expect(summary.total).toBe(5);
  });
});

describe("a missing rate degrades visibly", () => {
  test("the unconvertible cost is named, not folded into the total", () => {
    const summary = getCostSummary("u/gap-2026");

    // 60 EUR prep + 20 EUR bed at 0.94; the 450 THB has no rate.
    expect(summary.total).toBeCloseTo(60 * 0.94 + 20 * 0.94, 9);
    expect(summary.unconverted).toEqual([{ currency: "THB", amount: 450, count: 1 }]);
  });

  test("the unconvertible cost is not counted at face value", () => {
    const summary = getCostSummary("u/gap-2026");
    expect(summary.total).not.toBeCloseTo(60 * 0.94 + 20 * 0.94 + 450, 6);
  });

  test("it still appears in the itemised list, with its own currency and no base", () => {
    const food = getCostSummary("u/gap-2026").items.find((c) => c.label === "Street food")!;
    expect(food).toMatchObject({ amount: 450, currency: "THB" });
    expect(food.base).toBeUndefined();
  });

  test("every category and country split leaves it out consistently", () => {
    const summary = getCostSummary("u/gap-2026");
    expect(summary.byCategory.find((c) => c.category === "food")).toBeUndefined();
    expect(summary.byCountry.find((c) => c.country === "Thailand")!.amount).toBeCloseTo(
      20 * 0.94,
      9,
    );
  });
});

describe("the shipped example content", () => {
  // A fresh clone copies content/example/, and its entries are already
  // written in two currencies. If that set stops converting, the first thing
  // anyone sees is wrong.
  beforeEach(() => {
    process.env.CONTENT_DIR = path.join(process.cwd(), "content");
    clearConfigCache();
    clearRatesCache();
  });

  test("every trip converts, in every currency it was spent in", () => {
    // Three trips between them spend in CHF, EUR, THB, VND and USD. If any
    // rate is missing the amount is reported as unconverted rather than
    // silently summed, so this asserting empty is the whole guarantee.
    for (const ref of ["example/alps-2024", "example/asia-2023", "example/usa-2026"]) {
      const summary = getCostSummary(ref);
      expect(summary.unconverted, `${ref} has amounts it could not convert`).toEqual([]);
      expect(summary.total).toBeGreaterThan(0);
      expect(summary.budget?.total).toBeGreaterThan(0);
    }
  });

  test("a foreign-currency cost is converted at that trip's own rate", () => {
    // The Alps trip declares EUR at 0.94; its Italian day spends 11 + 34 EUR.
    const alps = getCostSummary("example/alps-2024");
    const eur = alps.items.filter((i) => i.currency === "EUR");
    expect(eur.length).toBeGreaterThan(0);
    for (const item of eur) {
      expect(item.base).toBeCloseTo(item.amount * 0.94, 9);
    }
  });

  test("it ships a rate cache, so a fresh clone can offer a currency switch", () => {
    const options = currencyOptions("example");
    expect(options.currencies).toEqual(["CHF", "EUR", "USD"]);
    expect(options.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the summing helpers", () => {
  const items = convertCosts(
    parseCostItems(
      [
        { label: "a", amount: 450, currency: "THB", category: "food" },
        { label: "b", amount: 100, currency: "THB", category: "food" },
        { label: "c", amount: 10, currency: "CHF", category: "food" },
      ],
      "CHF",
    ),
    "CHF",
    {},
  );

  test("sumBase counts only what has a base value", () => {
    expect(sumBase(items)).toBe(10);
  });

  test("unconvertedIn groups the remainder by currency", () => {
    expect(unconvertedIn(items)).toEqual([{ currency: "THB", amount: 550, count: 2 }]);
  });
});
