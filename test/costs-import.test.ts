import { describe, expect, test } from "vitest";
import revolut from "@/importers/costs/revolut";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { checkCostsImporter, type Payment } from "@/importers/costs/schema";
import { readStatement } from "@/lib/statements/read";

/**
 * Reading a bank statement — B677.
 *
 * The parser came from `fernscout-helper`, where it ran on the owner's own
 * laptop; what is asserted here is the behaviour that made it worth moving,
 * plus the two properties that keep it honest: **no category is ever
 * invented**, and money that is not spending is counted rather than hidden.
 *
 * Every amount and merchant below is made up.
 */

/**
 * A statement in the shape the app exports: sections, one per account, and the
 * money columns are one or two depending on the account's own currency.
 *
 * **The date is quoted**, because "Jun 22, 2026" contains a comma. Written
 * unquoted here first, and every row silently vanished — the split put "Jun
 * 22" in the date column and shifted everything after it. The contract check
 * catches that as "parse returned nothing", which is the loud failure it
 * should be; the fixture is only worth having if it is what a bank writes.
 */
const STATEMENT = [
  "Personal · CHF (CHF)",
  "Date,Description,Category,Money in/out,Money in/out,Balance",
  '"Jun 22, 2026",Padaria Central,Restaurants,-€12.40,-11.65 CHF,1000.00 CHF',
  '"Jun 22, 2026",Combustíveis Sul,Transport,-€60.00,-56.40 CHF,940.00 CHF',
  '"Jun 23, 2026",Padaria Central,Restaurants,-€8.20,-7.71 CHF,930.00 CHF',
  '"Jun 23, 2026",Transfer from Revolut,Transfers,-100.00 CHF,-100.00 CHF,830.00 CHF',
  '"Jun 24, 2026",Salary,Income,2000.00 CHF,2000.00 CHF,2830.00 CHF',
  "Total,,,,,",
  "",
  "Savings · CHF (CHF)",
  "Date,Description,Category,Money in/out,Balance",
  '"Jun 25, 2026",Hotel Boa Vista,Travel,-240.00 CHF,500.00 CHF',
  "Total,,,,",
].join("\n");

describe("the revolut importer", () => {
  test("reads every section, and keeps the sign the statement wrote", () => {
    const rows = revolut.parse(STATEMENT);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      date: "2026-06-22",
      amount: -12.4,
      currency: "EUR",
      description: "Padaria Central",
    });
    // The second money column is what it actually cost the account, and it is
    // the number a rate comes from. Reading the first as the cost is how a
    // trip ends up recorded in the wrong currency.
    expect(rows[0].charged).toEqual({ amount: -11.65, currency: "CHF" });
  });

  test("handles the single-column section too", () => {
    const rows = revolut.parse(STATEMENT);
    const hotel = rows.find((r) => r.description === "Hotel Boa Vista");
    expect(hotel).toMatchObject({ amount: -240, currency: "CHF", account: "Savings · CHF (CHF)" });
    expect(hotel?.charged).toBeUndefined();
  });

  test("marks a transfer rather than dropping it", () => {
    // A row nobody can see is a row nobody can correct, and banks call things
    // transfers that are genuinely spending.
    const transfer = revolut.parse(STATEMENT).find((r) => r.description.startsWith("Transfer"));
    expect(transfer?.transfer).toBe(true);
  });

  test("invents no category, from a file that has one in it", () => {
    // The statement says "Restaurants". That is the bank's guess about a
    // merchant, not a person's decision about their trip.
    expect(JSON.stringify(revolut.parse(STATEMENT))).not.toContain("Restaurants");
  });

  test("recognises a statement and not somebody else's CSV", () => {
    expect(revolut.detect(STATEMENT, "statement.csv")).toBe(true);
    expect(revolut.detect("lat,lon,time\n47.1,8.1,…", "track.csv")).toBe(false);
  });

  test("is in the list the server bundles", () => {
    expect(COSTS_IMPORTERS.map((i) => i.id)).toContain("revolut");
  });
});

describe("checkCostsImporter", () => {
  const ok = { id: "mine", label: "Mine" } as never;
  const row = (over: Partial<Payment> = {}): Payment => ({
    date: "2026-06-22",
    amount: -10,
    currency: "CHF",
    description: "A shop",
    ...over,
  });

  test("passes a good row", () => {
    expect(checkCostsImporter(ok, [row()])).toEqual([]);
  });

  test("names a statement's own date format", () => {
    expect(checkCostsImporter(ok, [row({ date: "Jun 22, 2026" })]).join(" ")).toMatch(/ISO date/);
  });

  test("names a symbol left where a currency code belongs", () => {
    expect(checkCostsImporter(ok, [row({ currency: "€" })]).join(" ")).toMatch(/ISO-4217/);
  });

  test("catches an importer that stripped the sign", () => {
    // Without the sign nothing downstream can tell a payment from a refund.
    expect(checkCostsImporter(ok, [row({ amount: 10 })]).join(" ")).toMatch(/every row is positive/);
  });

  test("says what an empty parse usually means", () => {
    expect(checkCostsImporter(ok, []).join(" ")).toMatch(/returned nothing/);
  });
});

describe("reading a statement into a report", () => {
  test("groups the spending by day, and leaves the rest out of it", () => {
    const out = readStatement(STATEMENT, "statement.csv");
    if ("refusal" in out) throw new Error(out.message);

    expect(out.format).toBe("revolut");
    expect(out.spending.payments).toBe(4);
    expect(out.spending.days.map((d) => d.date)).toEqual([
      "2026-06-22",
      "2026-06-23",
      "2026-06-25",
    ]);
    // Counted, not hidden: one transfer and one payment coming in.
    expect(out.skipped).toEqual({ transfers: 1, incoming: 1 });
  });

  test("a day's total is what the account was charged", () => {
    const out = readStatement(STATEMENT, "statement.csv");
    if ("refusal" in out) throw new Error(out.message);
    const first = out.spending.days[0];
    expect(first.currency).toBe("CHF");
    expect(first.total).toBeCloseTo(11.65 + 56.4, 2);
  });

  test("merchants come back biggest first, which is the list to agree", () => {
    const out = readStatement(STATEMENT, "statement.csv");
    if ("refusal" in out) throw new Error(out.message);
    expect(out.spending.merchants[0].description).toBe("Hotel Boa Vista");
    // One decision per merchant covers every payment to it — the bakery twice.
    const bakery = out.spending.merchants.find((m) => m.description === "Padaria Central");
    expect(bakery?.payments).toBe(2);
    expect(bakery?.total).toBeCloseTo(11.65 + 7.71, 2);
  });

  test("the rate is what the money actually cost, not a published one", () => {
    const out = readStatement(STATEMENT, "statement.csv");
    if ("refusal" in out) throw new Error(out.message);
    // 11.65 / 12.40 and 7.71 / 8.20 and 56.40 / 60.00 — the median of those.
    expect(out.rates.EUR).toBeCloseTo(0.94, 2);
  });

  test("a date window keeps the trip and drops the fortnight either side", () => {
    const out = readStatement(STATEMENT, "statement.csv", { from: "2026-06-23", to: "2026-06-24" });
    if ("refusal" in out) throw new Error(out.message);
    expect(out.spending.days.map((d) => d.date)).toEqual(["2026-06-23"]);
  });

  test("nothing it answers with carries a category", () => {
    const out = readStatement(STATEMENT, "statement.csv");
    if ("refusal" in out) throw new Error(out.message);
    expect(JSON.stringify(out)).not.toContain("category");
  });

  test("a file nothing recognises is refused with the formats named", () => {
    const out = readStatement("nothing,useful\n1,2\n", "budget.csv");
    expect("refusal" in out && out.refusal).toBe("unknown_format");
  });

  test("a named format that does not exist is refused", () => {
    const out = readStatement(STATEMENT, "statement.csv", { format: "monzo" });
    expect("refusal" in out && out.refusal).toBe("unknown_format");
    expect("refusal" in out && out.message).toMatch(/revolut/);
  });
});
