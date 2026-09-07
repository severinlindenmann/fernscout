/**
 * A statement nobody wrote an importer for — B689.
 *
 * `revolut.ts` and every file beside it knows one bank's export by heart. This
 * is the other half: a plain CSV from a bank this instance has never seen,
 * read by being *told* which column is which. The telling is somebody else's
 * job — the helper asks a model for a mapping and shows it to the owner to
 * correct (`lib/helper/model.ts`) — and everything in this file is pure and
 * knows nothing about that.
 *
 * **That split is the whole design.** A model sees the header row and a
 * handful of sample rows, once; the code below applies what it said to all two
 * thousand of them. One call for a statement, never one per line, and the
 * expensive part of the job is a `for` loop rather than a bill.
 *
 * Nothing here throws on a bad row. A statement is somebody's own file, half
 * of it is subtotals and section headings, and one unreadable line must not
 * cost the other three hundred — the same rule `../README.md` puts on every
 * importer here.
 */
import { isSanePayment, type Payment } from "./schema";

/**
 * The date shapes a statement actually uses.
 *
 * A closed list, because the ambiguity is the point: `03/04/2026` is two
 * different days and no amount of looking at the column can settle which. A
 * person reading the preview can, which is why this is a field somebody
 * confirms rather than a heuristic.
 */
export const DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD.MM.YYYY",
  "MMM D, YYYY",
  "D MMM YYYY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * Which column holds what, in the file's own words.
 *
 * Columns are named by their **header text**, not by index: a person
 * correcting this on their phone picks "Booking date" out of a list, and an
 * index would be a number nobody can check. `columnIndex` resolves it, and a
 * name that is not in the file is refused rather than guessed at.
 */
export type ColumnMapping = {
  date: string;
  amount: string;
  description: string;
  /** The column naming each row's currency, when there is one. */
  currency?: string;
  /** The whole file's currency, when there is no column for it. */
  fixedCurrency?: string;
  account?: string;
  dateFormat: DateFormat;
  /** `1.234,56` rather than `1,234.56`. */
  decimalComma?: boolean;
  /** The file writes money *out* as a positive number, so the sign is flipped
   * on the way in — a `Payment` is signed the way a statement signs it, and
   * `checkCostsImporter` complains about a file that is positive throughout. */
  outgoingPositive?: boolean;
};

/** The header and the rows under it, as read. */
export type Table = { header: string[]; rows: string[][] };

const DELIMITERS = [",", ";", "\t"] as const;

/** Fields may be quoted and contain the delimiter. Shared with `revolut.ts`,
 * which had the only copy of this. */
export function splitCsv(line: string, delimiter = ","): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else current += character;
  }
  out.push(current.replace(/\r$/, ""));
  return out;
}

/** Whichever of comma, semicolon and tab the file leans on hardest. */
function delimiterOf(text: string): string {
  const sample = text.slice(0, 4096);
  let best = ",";
  let most = 0;
  for (const candidate of DELIMITERS) {
    const count = sample.split(candidate).length - 1;
    if (count > most) {
      most = count;
      best = candidate;
    }
  }
  return best;
}

/**
 * The table inside the file, or `null` when there is not one.
 *
 * The header is the first line with three or more cells; a row is any later
 * line with exactly as many. That rule throws away section headings, blank
 * lines and the `Total,,,` a bank puts at the bottom, and it is deliberately
 * the *same* rule the model's sample is cut with — so the columns somebody
 * confirms on their screen are the columns `applyMapping` reads.
 */
export function readTable(text: string): Table | null {
  const delimiter = delimiterOf(text);
  let header: string[] | null = null;
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const cells = splitCsv(line, delimiter).map((cell) => cell.trim());
    if (!header) {
      if (cells.length >= 3) header = cells;
      continue;
    }
    if (cells.length === header.length) rows.push(cells);
  }
  return header ? { header, rows } : null;
}

/**
 * The header and the first few rows — **the only part of a statement that ever
 * leaves this machine.**
 *
 * Five rows, because that is enough to tell a date column from a value date
 * and a debit from a credit, and few enough that a person can read what they
 * are sending. The other two thousand rows stay here.
 */
export function statementSample(text: string, rows = 5): Table | null {
  const table = readTable(text);
  return table ? { header: table.header, rows: table.rows.slice(0, rows) } : null;
}

/** Where a named column sits, or -1. Exact match first, then case-insensitive,
 * because a person retyping a header will not match its capitalisation. */
function columnIndex(header: string[], name: string | undefined): number {
  if (!name) return -1;
  const exact = header.indexOf(name);
  if (exact >= 0) return exact;
  return header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

function pad(value: string): string {
  return value.padStart(2, "0");
}

/** One cell, in the format somebody confirmed, to `YYYY-MM-DD` — or null. */
function parseDate(cell: string, format: DateFormat): string | null {
  const value = cell.trim();
  // A statement often carries a time after the date; the day is the whole of
  // what a journal records.
  const head = value.split(/[T ]/)[0];
  const numbers = head.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numbers) {
    const [, a, b, c] = numbers;
    if (format === "YYYY-MM-DD") return `${a.padStart(4, "0")}-${pad(b)}-${pad(c)}`;
    if (format === "DD/MM/YYYY" || format === "DD.MM.YYYY")
      return `${c.padStart(4, "0")}-${pad(b)}-${pad(a)}`;
    if (format === "MM/DD/YYYY") return `${c.padStart(4, "0")}-${pad(a)}-${pad(b)}`;
    return null;
  }
  const named = value.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})$/);
  if (named && format === "MMM D, YYYY") {
    const month = MONTHS.indexOf(named[1].toLowerCase()) + 1;
    return month ? `${named[3]}-${pad(String(month))}-${pad(named[2])}` : null;
  }
  const dayFirst = value.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
  if (dayFirst && format === "D MMM YYYY") {
    const month = MONTHS.indexOf(dayFirst[2].toLowerCase()) + 1;
    return month ? `${dayFirst[3]}-${pad(String(month))}-${pad(dayFirst[1])}` : null;
  }
  return null;
}

const SYMBOL: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };

/** A money cell to a number. `(12.40)` and `12.40-` are both a debit; banks
 * write a minus sign in three places and none of them is wrong. */
function parseAmount(cell: string, decimalComma = false): number | null {
  let value = cell.trim();
  if (value === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(value)) {
    sign = -1;
    value = value.slice(1, -1);
  }
  if (value.endsWith("-")) {
    sign = -1;
    value = value.slice(0, -1);
  }
  if (value.startsWith("-")) {
    sign = -1;
    value = value.slice(1);
  }
  value = value.replace(/[^\d.,]/g, "");
  value = decimalComma ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) && value !== "" ? sign * number : null;
}

/** A currency cell — a code, or a symbol a bank used instead of one. */
function parseCurrency(cell: string | undefined): string | null {
  if (!cell) return null;
  const code = cell.trim().toUpperCase().match(/[A-Z]{3}/);
  if (code) return code[0];
  for (const [symbol, iso] of Object.entries(SYMBOL)) if (cell.includes(symbol)) return iso;
  return null;
}

/** What a mapping is wrong about, before a single row is read. Words rather
 * than a boolean: it is shown to whoever has to correct it. */
export function checkMapping(header: string[], mapping: ColumnMapping): string[] {
  const problems: string[] = [];
  for (const field of ["date", "amount", "description"] as const) {
    if (columnIndex(header, mapping[field]) < 0)
      problems.push(
        `no column called ${JSON.stringify(mapping[field] ?? "")} for the ${field}. ` +
          `This file has: ${header.join(", ")}`,
      );
  }
  if (mapping.currency && columnIndex(header, mapping.currency) < 0)
    problems.push(`no column called ${JSON.stringify(mapping.currency)} for the currency`);
  if (!mapping.currency && !/^[A-Za-z]{3}$/.test(mapping.fixedCurrency ?? ""))
    problems.push("no currency column and no currency for the whole file");
  if (!(DATE_FORMATS as readonly string[]).includes(mapping.dateFormat))
    problems.push(`${JSON.stringify(mapping.dateFormat)} is not one of ${DATE_FORMATS.join(", ")}`);
  return problems;
}

/**
 * The mapping, applied to every row in the file.
 *
 * This is the loop the whole design exists to keep away from a model. It reads
 * the table once, takes the cells the mapping names, and drops anything that
 * will not parse — a subtotal, a carried balance, a row of dashes.
 */
export function applyMapping(text: string, mapping: ColumnMapping): Payment[] {
  const table = readTable(text);
  if (!table) return [];
  const at = {
    date: columnIndex(table.header, mapping.date),
    amount: columnIndex(table.header, mapping.amount),
    description: columnIndex(table.header, mapping.description),
    currency: columnIndex(table.header, mapping.currency),
    account: columnIndex(table.header, mapping.account),
  };
  if (at.date < 0 || at.amount < 0) return [];

  const out: Payment[] = [];
  for (const cells of table.rows) {
    const date = parseDate(cells[at.date] ?? "", mapping.dateFormat);
    const amount = parseAmount(cells[at.amount] ?? "", mapping.decimalComma);
    if (date === null || amount === null) continue;
    const currency =
      (at.currency >= 0 ? parseCurrency(cells[at.currency]) : null) ??
      parseCurrency(mapping.fixedCurrency) ??
      // Falling back to the amount cell's own symbol, which is where a file
      // with no currency column usually keeps it.
      parseCurrency(cells[at.amount]);
    if (!currency) continue;
    const row: Payment = {
      date,
      amount: mapping.outgoingPositive ? -amount : amount,
      currency,
      description: (at.description >= 0 ? cells[at.description] : "") ?? "",
      account: at.account >= 0 ? cells[at.account] || undefined : undefined,
    };
    if (isSanePayment(row)) out.push(row);
  }
  return out;
}
