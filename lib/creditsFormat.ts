/**
 * How a person reads a `credits`-denominated figure — B987.
 *
 * Its own file, beside `pricing.ts`, for the reason a database module
 * starts with `import "server-only"`: a figure like this is rendered in the
 * browser (the photobook's print card, the postcard order page, print
 * receipts), and importing a formatter from a module that owns the database
 * pulled the whole of it — config, capabilities, Kysely — into the client
 * bundle. The build says so plainly and immediately, which is the good
 * version of this mistake.
 *
 * Nothing here touches a database or a request. It is arithmetic and a
 * string. The credit ledger this once priced against was deleted whole in
 * B2592 — plans replaced it — but some `paid/` print-order fields still
 * carry their historical `credits`/`creditsEach` name over a frozen price,
 * and still print through this.
 */
const UNITS_PER_CREDIT = 100;

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
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  // B2059: "49’950", not "49950" — the Swiss apostrophe `formatMoney` uses,
  // for the same reason (the same on the server and in the browser).
  return text.replace(/^(-?\d+)/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, "’"));
}

export function formatChf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}
