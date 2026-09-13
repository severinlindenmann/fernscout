// GET /api/v2/{user}/statements/{src}, POST /api/v2/{user}/trips/{trip}/costs/apply
// — B1624, phase 2 step 4. docs/plans/2026-09-12-api-v2/content.md §3.
import { z } from "zod";
import { COST_CATEGORIES } from "../../../costFormat";
import { isoDate } from "./shared";

/** The read-only report a bank export produces — never written anywhere
 * until a person agrees the rows and sends them to `costsApplyRequest`. */
export const statementRead = z.strictObject({
  src: z.string(),
  trip: z.string().optional(),
  dateRange: z.strictObject({ from: isoDate.nullable(), to: isoDate.nullable() }),
  merchants: z.array(
    z.strictObject({
      name: z.string(),
      total: z.number(),
      currency: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  payments: z.array(
    z.strictObject({
      date: isoDate,
      label: z.string(),
      amount: z.number(),
      currency: z.string(),
      merchant: z.string(),
    }),
  ),
  /** Any currency the statement paid in that the trip's own rates don't
   * cover — the median rate actually paid, not a published table. */
  rates: z.record(z.string(), z.number()),
});

/** One agreed row, as a caller sends it back — `category` is required per
 * row, since the whole point of this call is that a person chose it. */
const costsApplyRow = z.strictObject({
  date: isoDate,
  label: z.string().trim().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
  category: z.enum(COST_CATEGORIES),
});

export const costsApplyRequest = z.strictObject({
  rows: z.array(costsApplyRow).min(1),
  /** Which statement these rows came from — purely informational, never
   * re-validated against the parsed report. */
  statement: z.string().optional(),
});

export type StatementRead = z.infer<typeof statementRead>;
export type CostsApplyRequest = z.infer<typeof costsApplyRequest>;
