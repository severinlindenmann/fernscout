import { describe, expect, test } from "vitest";
import revolutAccount from "@/importers/costs/revolut-account";
import revolut from "@/importers/costs/revolut";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { checkCostsImporter } from "@/importers/costs/schema";

/**
 * Revolut's *other* CSV — the flat account statement.
 *
 * Every amount and merchant below is made up; the shapes are not. Each row
 * here is an edge the real file actually contains: a reverted payment with no
 * completion date, a fee on top of the amount, a description carrying a comma,
 * a payment made late one evening and settled the next morning.
 */
const STATEMENT = [
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
  "Card Payment,Current,2026-06-22 12:10:00,2026-06-23 03:48:50,Padaria Central,-12.40,0.00,CHF,COMPLETED,987.60",
  "Card Payment,Current,2026-06-22 23:40:11,2026-06-23 09:02:00,Late Dinner,-40.00,0.00,CHF,COMPLETED,947.60",
  "Card Payment,Current,2026-06-23 10:00:00,2026-06-24 10:00:00,Viator,-0.89,0.00,CHF,REVERTED,",
  "ATM,Current,2026-06-23 11:00:00,2026-06-23 11:00:00,Cash machine,-200.00,2.50,CHF,COMPLETED,745.10",
  "Transfer,Current,2026-06-24 09:00:00,2026-06-24 09:00:00,Transfer to Savings,-100.00,0.00,CHF,COMPLETED,645.10",
  'Topup,Current,2026-06-25 14:05:12,2026-06-25 14:05:12,"Payment from SOMEBODY, A",1500.00,0.00,CHF,COMPLETED,2145.10',
  "Card Refund,Current,2026-06-26 08:00:00,2026-06-26 08:00:00,Padaria Central,12.40,0.00,CHF,COMPLETED,2157.50",
].join("\n");

describe("the revolut account-statement importer", () => {
  test("meets the importer contract", () => {
    expect(checkCostsImporter(revolutAccount, revolutAccount.parse(STATEMENT))).toEqual([]);
  });

  test("files a payment under the day it was made, not the day it settled", () => {
    const late = revolutAccount.parse(STATEMENT).find((r) => r.description === "Late Dinner");
    // Completed 2026-06-23; spent on the 22nd, and that is where it belongs.
    expect(late?.date).toBe("2026-06-22");
  });

  test("drops a reverted payment", () => {
    expect(revolutAccount.parse(STATEMENT).map((r) => r.description)).not.toContain("Viator");
  });

  test("counts the fee as money that left the account", () => {
    const atm = revolutAccount.parse(STATEMENT).find((r) => r.description === "Cash machine");
    expect(atm?.amount).toBe(-202.5);
  });

  test("marks transfers and top-ups, and leaves cash and refunds alone", () => {
    const by = (d: string) => revolutAccount.parse(STATEMENT).find((r) => r.description === d);
    expect(by("Transfer to Savings")?.transfer).toBe(true);
    expect(by("Payment from SOMEBODY, A")?.transfer).toBe(true);
    // Cash taken out IS the trip's spending — it reaches a statement once.
    expect(by("Cash machine")?.transfer).toBeUndefined();
    expect(by("Padaria Central")?.transfer).toBeUndefined();
  });

  test("keeps the sign the statement wrote, so a refund is not a cost", () => {
    const refund = revolutAccount.parse(STATEMENT).filter((r) => r.amount > 0);
    expect(refund.map((r) => r.description)).toContain("Padaria Central");
  });

  test("reads a quoted description containing a comma", () => {
    expect(revolutAccount.parse(STATEMENT).map((r) => r.description)).toContain(
      "Payment from SOMEBODY, A",
    );
  });

  test("adds no charged, because one account has one currency", () => {
    expect(revolutAccount.parse(STATEMENT).every((r) => r.charged === undefined)).toBe(true);
  });

  test("detects its own format and declines the other Revolut export", () => {
    expect(revolutAccount.detect(STATEMENT, "account-statement.csv")).toBe(true);
    expect(revolutAccount.detect("lat,lon,time\n47.1,8.1,…", "track.csv")).toBe(false);
    const consolidated = [
      "Personal · CHF (CHF)",
      "Date,Description,Category,Money in/out,Balance",
      '"Jun 22, 2026",Padaria Central,Restaurants,-12.40 CHF,1000.00 CHF',
    ].join("\n");
    expect(revolutAccount.detect(consolidated, "statement.csv")).toBe(false);
    // …and the consolidated reader must not claim this one either.
    expect(revolut.detect(STATEMENT, "account-statement.csv")).toBe(false);
  });

  test("is registered, ahead of the looser consolidated reader", () => {
    const ids = COSTS_IMPORTERS.map((i) => i.id);
    expect(ids).toContain("revolut-account");
    expect(ids.indexOf("revolut-account")).toBeLessThan(ids.indexOf("revolut"));
  });
});
