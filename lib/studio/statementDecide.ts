import type { CostCategory } from "@/lib/costFormat";
import type { DateFormat } from "@/importers/costs/mapping";
import type { CostRow } from "@/lib/statements/apply";
import type { MerchantGroup, SpendingRow } from "@/components/studio/statement/types";

/**
 * Grouping a statement's own lines by merchant — B1822, spec §7.7:
 * "Bulk-assign by merchant, because a statement repeats itself."
 *
 * A category is agreed **once per merchant**, not once per line — the decide
 * screen's whole reason to exist. Grouped by the export's own description
 * (never rewritten), so "Coop Pronto" appearing six times is one row to
 * decide about, not six.
 */
export function groupByMerchant(rows: SpendingRow[]): MerchantGroup[] {
  const byMerchant = new Map<string, MerchantGroup>();
  for (const row of rows) {
    const existing = byMerchant.get(row.label);
    if (existing) {
      existing.total += row.amount;
      existing.rows.push(row);
    } else {
      byMerchant.set(row.label, {
        merchant: row.label,
        label: row.label,
        currency: row.currency,
        total: row.amount,
        rows: [row],
        category: null,
      });
    }
  }
  // Biggest total first — the same order `lib/statements/read.ts`'s own
  // merchant list uses, so the rows most worth a bulk decision are on top.
  return [...byMerchant.values()].sort((a, b) => b.total - a.total);
}

/**
 * The merchant groups with a category chosen, expanded back into the rows
 * `validateRows` wants — date and amount and currency straight off the
 * export, `label` the (possibly edited) merchant name, `category` the one
 * choice this screen exists to collect.
 *
 * A merchant left at "pick one" (`category` still `null`) contributes
 * nothing — those lines are the ones the decide screen's own "N lines left
 * out" button names, never filed under a guessed category.
 */
export function costRowsFrom(groups: MerchantGroup[]): CostRow[] {
  const rows: CostRow[] = [];
  for (const group of groups) {
    if (!group.category) continue;
    for (const row of group.rows) {
      rows.push({
        date: row.date,
        label: group.label,
        amount: row.amount,
        currency: row.currency,
        category: group.category as CostCategory,
      });
    }
  }
  return rows;
}

/** How many individual lines are left out because their merchant has no
 *  category chosen yet — the count the "left out" button names. */
export function leftOutCount(groups: MerchantGroup[]): number {
  return groups.filter((g) => !g.category).reduce((sum, g) => sum + g.rows.length, 0);
}

export type MappingGuess = {
  date: string;
  amount: string;
  description: string;
  currency: string;
  dateFormat: DateFormat;
  decimalComma: boolean;
};

/**
 * A first guess at which column is which, for a bank nothing here knows —
 * B2083. Header words first (English, German, Hungarian, the few a bank
 * actually uses), then the sample: a column of three-letter codes is the
 * currency, and the date and amount cells say their own format. Only ever a
 * preselection on the mapping screen, which a person confirms or changes;
 * a column it cannot place is left empty rather than filled at random.
 */
export function guessMapping(header: string[], sample: string[][]): MappingGuess {
  const find = (re: RegExp) => header.find((h) => re.test(h)) ?? "";
  const column = (name: string) => sample.map((row) => (row[header.indexOf(name)] ?? "").trim()).filter(Boolean);
  const date = find(/date|datum|dátum|buchung|valuta|időpont/i);
  const amount = find(/amount|betrag|összeg|turnover|umsatz|debit|belastung/i);
  const description = find(/desc|text|merchant|payee|beschreibung|empfänger|details|memo|közlemény|partner/i);
  const currency =
    find(/curr|cur\.|ccy|währung|pénznem|deviza/i) ||
    (header.find((h) => {
      const cells = column(h);
      return cells.length > 0 && cells.every((c) => /^[A-Z]{3}$/.test(c));
    }) ?? "");
  const dates = date ? column(date) : [];
  const amounts = amount ? column(amount) : [];
  return { date, amount, description, currency, dateFormat: guessDateFormat(dates), decimalComma: amounts.some((a) => /\d,\d{1,2}$/.test(a)) };
}

function guessDateFormat(cells: string[]): DateFormat {
  const first = cells[0] ?? "";
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(first)) return "YYYY-MM-DD";
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(first)) return "DD.MM.YYYY";
  if (/^[A-Za-z]{3}/.test(first)) return "MMM D, YYYY";
  if (/^\d{1,2} [A-Za-z]{3}/.test(first)) return "D MMM YYYY";
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(first)) {
    // Month first only when a middle number cannot be a month.
    return cells.some((c) => Number(c.split("/")[1]) > 12) ? "MM/DD/YYYY" : "DD/MM/YYYY";
  }
  return "DD.MM.YYYY";
}
