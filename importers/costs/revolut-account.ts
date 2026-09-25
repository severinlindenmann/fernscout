import { isSanePayment, type CostsImporter, type Payment } from "./schema";
import { splitCsv } from "./mapping";

/**
 * A Revolut **account statement**, as the app exports it — the other CSV.
 *
 * Revolut has two exports and they share neither shape nor route. The
 * consolidated statement in `./revolut.ts` is a document: sections per
 * account, balances, crypto gains, and a little table inside each section.
 * This one is a single flat table of one account's transactions:
 *
 *     Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 *     Card Payment,Current,2025-08-28 16:17:04,2025-08-29 03:48:50,Som Tam Kata,-11.40,0.00,CHF,COMPLETED,977.01
 *
 * Written because an owner reached for the export their app actually offered
 * and got `unknown_format` back. Both are Revolut statements; only one was
 * readable, and which one you get depends on which menu you found. A format
 * this server cannot read is an importer somebody has to write, once, here —
 * not a conversion script on the laptop the file happened to land on.
 *
 * Three decisions this file makes, each of which changes what a trip costs:
 *
 * - **The date is `Started Date`, not `Completed Date`.** A card payment made
 *   at 23:40 settles the following morning, and the settlement date would file
 *   the last dinner of the holiday under the day everybody flew home. The day
 *   the money was spent is the one a journal records.
 * - **The fee is folded into the amount.** `Amount` is what the merchant took;
 *   `Fee` is what Revolut took on top, in the same currency, and both left the
 *   account. There is no fee field on `Payment` and inventing one would be a
 *   worse answer than reporting what the account actually lost.
 * - **`REVERTED` rows are dropped.** A reversed payment is money that came
 *   back, and it has no completion date to file it under either.
 *
 * There is no `charged` here, and that is not an omission: this export is one
 * account with one `Currency` column, so every row is already in the account's
 * own currency and there is no second number to read a rate from. A trip paid
 * in baht from a franc account shows its real rate in the *consolidated*
 * statement, not this one.
 */

/** Revolut's own words for moving your own money about, not spending it. */
const NOT_SPENDING = /^(Transfer|Exchange|Topup|Top-Up)$/i;

const importer: CostsImporter = {
  id: "revolut-account",
  label: "Revolut account statement (CSV)",

  detect(head, filename) {
    if (!/\.csv$/i.test(filename) && !/Started Date/.test(head)) return false;
    // The whole header, because a CSV is the easiest file in the world to
    // claim and `./revolut.ts` is sitting right next to this one.
    return /^Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State/m.test(
      head,
    );
  },

  parse(text) {
    const lines = text.split(/\r?\n/);
    const headerAt = lines.findIndex((l) => /^Type,Product,Started Date/.test(l));
    if (headerAt < 0) throw new Error("not a Revolut account statement");

    // By name rather than by position: the columns have moved between exports
    // before, and a shifted index reads the balance as the amount in silence.
    const header = splitCsv(lines[headerAt]).map((c) => c.trim());
    const at = (name: string) => header.indexOf(name);
    const iStarted = at("Started Date");
    const iCompleted = at("Completed Date");
    const iDescription = at("Description");
    const iAmount = at("Amount");
    const iFee = at("Fee");
    const iCurrency = at("Currency");
    const iState = at("State");
    const iType = at("Type");
    const iProduct = at("Product");
    if (iStarted < 0 || iAmount < 0 || iCurrency < 0)
      throw new Error("Revolut account statement is missing a column it needs");

    const out: Payment[] = [];
    for (const line of lines.slice(headerAt + 1)) {
      if (!line.trim()) continue;
      const cells = splitCsv(line);

      const state = (cells[iState] ?? "").trim().toUpperCase();
      if (state && state !== "COMPLETED") continue;

      // "2025-08-28 16:17:04" — already ISO, so the day is the first ten
      // characters. Falls back to the completion date only when the statement
      // wrote no start date at all.
      const stamp = (cells[iStarted] || cells[iCompleted] || "").trim();
      const date = stamp.slice(0, 10);

      const amount = Number((cells[iAmount] ?? "").trim());
      const fee = Number((cells[iFee] ?? "0").trim()) || 0;
      if (!Number.isFinite(amount)) continue;

      const type = (cells[iType] ?? "").trim();
      const row: Payment = {
        date,
        // The fee always leaves the account, whichever way the payment went.
        amount: amount - Math.abs(fee),
        currency: (cells[iCurrency] ?? "").trim().toUpperCase(),
        description: (cells[iDescription] ?? "").trim(),
        account: (cells[iProduct] ?? "").trim() || undefined,
        // An ATM withdrawal is deliberately NOT marked: cash spent on a trip
        // reaches a statement exactly once, at the machine, and marking it a
        // transfer is how a fortnight of cash disappears from the total.
        transfer: NOT_SPENDING.test(type) || undefined,
      };
      if (isSanePayment(row)) out.push(row);
    }

    if (out.length === 0) throw new Error("Revolut account statement held no readable rows");
    return out;
  },
};

export default importer;
