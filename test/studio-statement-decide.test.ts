import { describe, expect, test } from "vitest";
import { costRowsFrom, groupByMerchant, guessMapping, leftOutCount } from "@/lib/studio/statementDecide";
import type { SpendingRow } from "@/components/studio/statement/types";

/**
 * The decide step's own arithmetic — B1822, spec §7.7's "bulk-assign by
 * merchant, because a statement repeats itself." Pulled out of the flow
 * component so it is checkable without mounting React: a statement that
 * repeats a merchant six times must become one row to decide about, and a
 * merchant left uncategorised must never contribute costs silently.
 */

const ROWS: SpendingRow[] = [
  { date: "2026-09-12", label: "SBB Mobile", amount: 34, currency: "CHF" },
  { date: "2026-09-12", label: "Coop Pronto", amount: 18.4, currency: "CHF" },
  { date: "2026-09-13", label: "Coop Pronto", amount: 9.2, currency: "CHF" },
  { date: "2026-09-13", label: "Hotel Grimsel", amount: 145, currency: "CHF" },
];

describe("grouping by merchant", () => {
  test("six lines from one merchant become one group", () => {
    const groups = groupByMerchant(ROWS);
    expect(groups).toHaveLength(3);
    const coop = groups.find((g) => g.merchant === "Coop Pronto")!;
    expect(coop.rows).toHaveLength(2);
    expect(coop.total).toBeCloseTo(27.6);
  });

  test("biggest total first", () => {
    const groups = groupByMerchant(ROWS);
    expect(groups[0].merchant).toBe("Hotel Grimsel");
  });
});

describe("expanding agreed merchants back into rows", () => {
  test("a category on the merchant reaches every one of its lines", () => {
    const groups = groupByMerchant(ROWS).map((g) => (g.merchant === "Coop Pronto" ? { ...g, category: "food" } : g));
    const rows = costRowsFrom(groups);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === "food" && r.label === "Coop Pronto")).toBe(true);
  });

  test("a merchant with no category contributes nothing, and is counted as left out", () => {
    const groups = groupByMerchant(ROWS);
    expect(costRowsFrom(groups)).toEqual([]);
    expect(leftOutCount(groups)).toBe(4);
  });

  test("an edited label travels to every line of that merchant", () => {
    const groups = groupByMerchant(ROWS).map((g) =>
      g.merchant === "SBB Mobile" ? { ...g, label: "Train", category: "transport" } : g,
    );
    const rows = costRowsFrom(groups);
    expect(rows.find((r) => r.date === "2026-09-12" && r.amount === 34)?.label).toBe("Train");
  });
});

describe("the mapping screen's first guess — B2083", () => {
  test("an invented bank's header and sample preselect every column, the currency included", () => {
    const header = ["Booking date", "Value date", "Text", "Turnover", "Cur.", "Account"];
    const sample = [
      ["04.03.2026", "05.03.2026", "Kiosk am Hafen", "12,40", "EUR", "Everyday"],
      ["05.03.2026", "06.03.2026", "Pension Seeblick", "74,00", "EUR", "Everyday"],
    ];
    expect(guessMapping(header, sample)).toEqual({
      date: "Booking date",
      amount: "Turnover",
      description: "Text",
      currency: "Cur.",
      dateFormat: "DD.MM.YYYY",
      decimalComma: true,
    });
  });

  test("an unnamed currency column is found by its codes; an unplaceable column stays empty", () => {
    const guess = guessMapping(["When", "Sum", "Unit"], [["2026-03-04", "-12.40", "CHF"]]);
    expect(guess).toMatchObject({ date: "", amount: "", description: "", currency: "Unit", decimalComma: false });
  });

  test("a slash date whose middle number cannot be a month reads month first", () => {
    const guess = guessMapping(["Date", "Amount"], [["03/04/2026", "1"], ["03/24/2026", "2"]]);
    expect(guess.dateFormat).toBe("MM/DD/YYYY");
  });
});
