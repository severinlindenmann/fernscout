/**
 * Payments — the row type for every importer in this folder.
 *
 * The generic shape is one level up in `../schema.ts`; what is here is only
 * what a *statement* importer needs. A row is what a bank line **is**, not what
 * a journal entry is: an amount, a currency, a date and whatever the merchant
 * called itself.
 *
 * **There is deliberately no category.** Whether a payment was "food" or "the
 * one good dinner" is an editorial decision about somebody's trip, and
 * AGENTS.md's rule covers it: an agent does not decide what happened. A
 * category is asked for and agreed, one merchant at a time, and only then
 * written — which is why importing a statement writes nothing into a trip by
 * itself.
 *
 * A statement is also a record of somebody's whole financial life for the
 * period it covers, most of which has nothing to do with any trip. Same shape
 * as `../gps/`: the import reads it and reports; a second, explicit call says
 * which rows were the trip's.
 */
import type { Importer } from "../schema";

export { parseInstant } from "../schema";

export type Payment = {
  /** ISO calendar date, `YYYY-MM-DD`. A cost belongs to a day, not an instant:
   * that is the granularity a journal records and the one a statement gives. */
  date: string;
  /**
   * **Signed as the statement wrote it** — negative is money out.
   *
   * Not normalised to "an amount spent", because a statement carries both
   * directions and a refund is not a cost of −1 × a cost. The caller decides
   * what to do with the sign; `lib/costs/import.ts` treats outgoing rows as
   * the trip's spending and reports the rest separately rather than dropping
   * it silently.
   */
  amount: number;
  /** ISO-4217, upper case, as charged. */
  currency: string;
  /** What the merchant called itself. Never rewritten into something tidier —
   * it is the only thing tying a row to a receipt somebody can find. */
  description: string;
  /** Which account or card, where the statement says. */
  account?: string;
  /**
   * What it actually cost in the account's own currency, when the payment was
   * in another one. This is where a real exchange rate comes from — the money
   * the bank moved, divided by the money the merchant received — rather than
   * from any published table.
   */
  charged?: { amount: number; currency: string };
  /**
   * The bank's own word for it was a transfer, an exchange or a top-up.
   *
   * Moving your own money between your own pots is not a trip cost. Marked
   * rather than dropped: a row nobody can see is a row nobody can correct, and
   * banks call things transfers that are not.
   */
  transfer?: boolean;
};

export type CostsImporter = Importer<Payment>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** A row that could be a real payment. */
export function isSanePayment(row: Payment): boolean {
  return (
    DATE.test(row.date) &&
    Number.isFinite(row.amount) &&
    CURRENCY.test(row.currency) &&
    typeof row.description === "string"
  );
}

/**
 * **Run this against your own importer.** Same contract as the GPS folder's:
 * bring the row above, call this, fix what it lists.
 *
 * It is what `POST /api/v1/<user>/import` runs with `"dryRun": true`, so the
 * API is the same check without an import statement.
 */
export function checkCostsImporter(importer: CostsImporter, rows: Payment[]): string[] {
  const problems: string[] = [];
  const say = (problem: string) => problems.push(problem);

  if (!/^[a-z0-9-]+$/.test(importer.id))
    say(`id ${JSON.stringify(importer.id)} must be lowercase letters, digits and dashes`);
  if (!importer.label) say("label is empty — it is what the caller lists");

  if (rows.length === 0) {
    say(
      "parse returned nothing. Either this is the wrong importer for the file, or the " +
        "statement holds no transactions — or every row was skipped as unreadable, which " +
        "is what happens when the date or the amount column is not where it was expected",
    );
    return problems;
  }

  const badDate = rows.filter((r) => !DATE.test(r.date));
  if (badDate.length > 0)
    say(
      `${badDate.length} of ${rows.length} rows have no ISO date — first: ` +
        `${JSON.stringify(badDate[0].date)}. A statement's own "Jun 26, 2026" has to be ` +
        "turned into 2026-06-26 by the importer, not passed on",
    );

  const badCurrency = rows.filter((r) => !CURRENCY.test(r.currency));
  if (badCurrency.length > 0)
    say(
      `${badCurrency.length} rows have no ISO-4217 currency — first: ` +
        `${JSON.stringify(badCurrency[0].currency)}. A symbol is not a currency: € has to ` +
        "become EUR here, because a journal converts by code",
    );

  const badAmount = rows.filter((r) => !Number.isFinite(r.amount));
  if (badAmount.length > 0)
    say(
      `${badAmount.length} rows have no usable amount. Thousands separators and a currency ` +
        "symbol in the same cell are the usual cause",
    );

  // 2001 to 2100, the same window the GPS check uses and for the same reason.
  const outOfTime = rows.filter((r) => r.date < "2001-01-01" || r.date > "2100-01-01");
  if (outOfTime.length > 0)
    say(`${outOfTime.length} rows are dated outside 2001–2100 — first: ${outOfTime[0].date}`);

  if (rows.every((r) => r.amount >= 0))
    say(
      "every row is positive. A statement's outgoing payments are negative here — if this " +
        "importer strips the sign, nothing downstream can tell a payment from a refund",
    );

  return problems;
}
