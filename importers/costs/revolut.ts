import { isSanePayment, type CostsImporter, type Payment } from "./schema";

/**
 * A Revolut consolidated statement, as the app exports it.
 *
 * Ported from `fernscout-helper`'s `revolut-costs/parse.mjs`, which did this
 * on the owner's own laptop — where a change to the format was one checkout at
 * a time and everybody else's copy stayed broken. Nothing about parsing a CSV
 * needs the machine the file came from.
 *
 * The file is **sections**, one per account, each with its own little table:
 *
 *     Personal · CHF (CHF)          ← an account heading
 *     Date,Description,Category,Money in/out,Money in/out,Balance
 *     Jun 26, 2026,Padaria Central,Restaurants,-€12.40,-13.05 CHF,…
 *     Total,…                       ← ends the table
 *
 * The money columns are **one or two**: one when the account is already in the
 * currency it was charged in, two when it was not — the merchant's amount
 * first, what it actually cost second. That second column is where a real
 * exchange rate comes from, and reading it as the primary amount is how a trip
 * ends up recorded in the wrong currency.
 */

/** "-€50.00" · "1,150.69 CHF" · "-46.09 CHF" · "€0.00" */
const SYMBOL: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };

function money(cell: string | undefined): { amount: number; currency: string } | null {
  if (!cell) return null;
  const m = cell.trim().match(/^(-?)\s*([€$£¥]?)\s*(-?[\d,.]+)\s*([A-Z]{3})?$/);
  if (!m) return null;
  const [, sign, symbol, digits, code] = m;
  const currency = code ?? SYMBOL[symbol];
  if (!currency) return null;
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { amount: (sign === "-" ? -1 : 1) * value, currency };
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "Jun 26, 2026" → "2026-06-26" */
function isoDate(cell: string): string | null {
  const m = cell.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Fields may be quoted and contain commas. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      out.push(current);
      current = "";
    } else current += character;
  }
  out.push(current.replace(/\r$/, ""));
  return out;
}

/**
 * Moving your own money between your own pots is not a trip cost.
 *
 * Marked, never dropped: a row nobody can see is a row nobody can correct, and
 * "Transfer" is a word banks use for things that are genuinely spending.
 */
function looksLikeTransfer(category: string, description: string): boolean {
  return (
    /^(Exchange|Transfers?|Top-Up)$/i.test(category) ||
    /^Transfer (to|from) Revolut/i.test(description)
  );
}

const importer: CostsImporter = {
  id: "revolut",
  label: "Revolut consolidated statement (CSV)",

  detect(head, filename) {
    if (!/\.csv$/i.test(filename) && !head.includes("Money in/out")) return false;
    return head.includes("Money in/out") || /^Date,Description,/m.test(head);
  },

  parse(text) {
    const out: Payment[] = [];
    let account = "";
    let columns: { dual: boolean } | null = null;

    for (const line of text.split(/\r?\n/)) {
      const cells = splitCsv(line);
      const first = cells[0]?.trim();

      // "Personal · CHF (CHF)" — an account heading starts a new section, and
      // the header row that follows says how many money columns it has.
      if (first && /^[A-Za-z].*\([A-Z]{3}\)$/.test(first)) {
        account = first;
        columns = null;
        continue;
      }
      if (first === "Date" && cells[1] === "Description") {
        columns = { dual: cells[3] === "Money in/out" && cells[4] === "Money in/out" };
        continue;
      }
      if (!columns || !first) continue;

      const date = isoDate(first);
      if (!date) {
        // "Total" closes the section. Anything else unparseable is skipped
        // rather than thrown on — one odd row must not cost the statement.
        if (first === "Total") columns = null;
        continue;
      }

      const local = money(cells[3]);
      const charged = columns.dual ? money(cells[4]) : local;
      if (!local || !charged) continue;

      const description = cells[1] ?? "";
      const row: Payment = {
        date,
        amount: local.amount,
        currency: local.currency,
        description,
        account: account || undefined,
        transfer: looksLikeTransfer(cells[2] ?? "", description) || undefined,
      };
      if (charged.currency !== local.currency || charged.amount !== local.amount)
        row.charged = charged;
      if (isSanePayment(row)) out.push(row);
    }

    if (out.length === 0 && !text.includes("Money in/out"))
      throw new Error("not a Revolut consolidated statement");
    return out;
  },
};

export default importer;
