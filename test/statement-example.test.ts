import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { applyMapping, statementSample } from "@/importers/costs/mapping";
import { guessMapping } from "@/lib/studio/statementDecide";
import { STATEMENT_EXAMPLE_HREF, STATEMENT_EXAMPLE_ROWS } from "@/components/studio/statement/StatementSample";

/**
 * B2143 — the statement intro's "What the file looks like" panel and the
 * example CSV it links to. The file is the table's four rows, and it reads
 * on the mapping screen's first guess with nothing corrected.
 */

const file = path.join(process.cwd(), "public", STATEMENT_EXAMPLE_HREF);
const text = fs.readFileSync(file, "utf8");

describe("the example statement", () => {
  test("is served from public/ and holds exactly the sample rows", () => {
    const [header, ...rows] = text.trim().split("\n");
    expect(header).toBe("Date,Text,Amount,Currency");
    expect(rows.map((r) => r.split(","))).toEqual(STATEMENT_EXAMPLE_ROWS.map((r) => [...r]));
  });

  test("imports cleanly on the mapping screen's first guess", () => {
    const sample = statementSample(text)!;
    const guess = guessMapping(sample.header, sample.rows);
    expect(guess).toMatchObject({ date: "Date", amount: "Amount", description: "Text", currency: "Currency", dateFormat: "DD.MM.YYYY" });
    const payments = applyMapping(text, guess);
    expect(payments).toHaveLength(4);
    expect(payments.every((p) => p.amount < 0)).toBe(true);
  });

  test("the debit-and-credit shape reads the way the panel says: debit as amount, outflows positive", () => {
    const split = [
      "Date,Text,Debit,Credit,Currency",
      ...STATEMENT_EXAMPLE_ROWS.map(([d, t, a, c]) => `${d},${t},${a.replace("-", "")},,${c}`),
      "07.03.2026,Refund,,6.00,EUR",
    ].join("\n");
    const payments = applyMapping(split, {
      date: "Date",
      amount: "Debit",
      description: "Text",
      currency: "Currency",
      dateFormat: "DD.MM.YYYY",
      outgoingPositive: true,
    });
    expect(payments.map((p) => p.amount)).toEqual([-12.4, -6, -74, -4.2]);
  });
});
