/** Shared shapes for `StatementFlow` — B1822, spec §7.7. */

/** One line as `.../statement/apply` reads it back — date, amount and
 *  currency come straight off the export; `validateRows` needs a `label`
 *  and a `category` beside them, which is exactly what the decide step
 *  collects (spec: "the two fields validateRows needs and no export
 *  supplies"). */
export type SpendingRow = { date: string; label: string; amount: number; currency: string };

/** One merchant, grouped for the decide step's bulk-assign — a statement
 *  repeats itself, so a category is agreed once per merchant rather than
 *  once per line. */
export type MerchantGroup = {
  merchant: string;
  label: string;
  currency: string;
  total: number;
  rows: SpendingRow[];
  category: string | null;
};
