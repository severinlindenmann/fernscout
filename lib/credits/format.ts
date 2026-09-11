/**
 * The unit credits are stored in, and how a person reads one — B987.
 *
 * Its own file, beside `pricing.ts` and away from `lib/credits.ts`, for the
 * reason that file starts with `import "server-only"`: a balance is rendered
 * in the browser (the notify panel, the photobook's print card, the admin
 * table), and importing the formatter from the module that owns the database
 * pulled the whole of it — config, capabilities, Kysely — into the client
 * bundle. The build says so plainly and immediately, which is the good
 * version of this mistake.
 *
 * Nothing here touches a database or a request. It is arithmetic and a string.
 */

/**
 * What one row of `credits.balance` holds: a **hundredth of a credit**, and an
 * integer.
 *
 * The only arrangement that both survives concurrency — the debit stays one
 * conditional `UPDATE` — and can price a six-second spoken question. A `real`
 * column would have been the obvious change and the wrong one: 0.1 + 0.2 is
 * not 0.3 anywhere money is counted.
 *
 * **The unit stops at `lib/credits.ts`'s edge.** Every caller passes and
 * receives *credits* — `POSTCARD_CREDITS` is still 20 and still means twenty
 * — and `spend`, `grant`, `refund` and `balanceOf` convert. That is what kept
 * a change of unit from becoming a sweep through every price in the codebase,
 * each one a chance to forget a zero.
 */
const UNITS_PER_CREDIT = 100;

/**
 * Credits in, stored units out — and a refusal for anything finer than a
 * hundredth.
 *
 * The guard is the same shape `spend`'s `Number.isInteger` had and is there
 * for the same reason: a caller that means 0.005 has a pricing bug, and
 * rounding it silently would keep that bug invisible until an invoice
 * disagreed. Rounded rather than truncated after the multiplication because
 * `0.29 * 100` is `28.999999999999996` in binary floating point, and 28 is not
 * what anybody wrote.
 */
export function toUnits(credits: number, what: string): number {
  const units = Math.round(credits * UNITS_PER_CREDIT);
  if (!Number.isFinite(credits) || Math.abs(units - credits * UNITS_PER_CREDIT) > 1e-6) {
    throw new Error(`credits: ${what} must be a whole number of hundredths, got ${credits}`);
  }
  return units;
}

/** Stored units back into credits, for anything a person reads. */
export function creditsFromUnits(units: number): number {
  return units / UNITS_PER_CREDIT;
}

/**
 * Two decimals when there is a fraction, none when there is not — and never a
 * float's idea of either.
 *
 * `9.97` prints as itself, but arithmetic on balances does not: a page showing
 * `balance - price` would otherwise be capable of "0.30000000000000004", so
 * the value is always rounded to hundredths first. Trailing zeros are kept
 * once there is any fraction at all — "8.50" rather than "8.5" — because
 * "1.50" and "1.5" being the same number is obvious to a programmer and not
 * to somebody reading a receipt. A whole number, though, gets no ".00": that
 * reads like a database column rather than an answer to "how many credits".
 */
export function formatCredits(credits: number): string {
  const rounded = Math.round(credits * UNITS_PER_CREDIT) / UNITS_PER_CREDIT;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
