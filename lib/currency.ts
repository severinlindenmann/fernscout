/**
 * Currency, in three layers.
 *
 * 1. **The original is stored.** A cost written as `450 THB` stays `450 THB`
 *    for ever. Nothing here mutates what was written down.
 * 2. **Local → base uses the trip's own historical rates.** Each trip carries
 *    its own `rates:` table (see `lib/trips.ts`), so the same currency in a
 *    2026 trip and a 2029 trip converts at each trip's own rate. That is the
 *    entire point: a later trip must not restate an earlier one's spending.
 * 3. **Base → the reader's currency uses a current rate.** Those come from the
 *    European Central Bank reference rates, cached in the content folder by
 *    `npm run rates:update` (see `lib/rates.ts`).
 *
 * This module is deliberately free of filesystem and config access so that it
 * can be imported from client components — the same split as
 * `lib/costFormat.ts` versus `lib/costs.ts`.
 */

/**
 * A rate table.
 *
 * For a **trip** table the value is *units of the base currency per one unit
 * of the keyed currency* — `{ THB: 0.0245 }` reads "1 THB = 0.0245 CHF".
 *
 * For the **ECB** table the value is *units of the keyed currency per one
 * euro* — `{ CHF: 0.9351 }` reads "1 EUR = 0.9351 CHF", which is the
 * convention the ECB itself publishes in.
 */
export type RateTable = Readonly<Record<string, number>>;

/** The currency the ECB quotes everything against. */
export const ECB_BASE = "EUR";

const CODE_RE = /^[A-Z]{3}$/;

/** An ISO-4217-shaped code, upper-cased, or `fallback` when unusable. */
export function normalizeCurrency(raw: unknown, fallback = ""): string {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  return CODE_RE.test(v) ? v : fallback;
}

function usable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Reads a `{ CODE: number }` map out of frontmatter or JSON.
 *
 * Anything unusable is dropped and reported rather than thrown: one mistyped
 * rate must not take a trip's whole page down, and a dropped rate is visible
 * later anyway — the amounts it would have converted are reported as
 * unconverted rather than counted at face value.
 */
export function parseRateTable(raw: unknown, onProblem?: (message: string) => void): RateTable {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      onProblem?.(`rates must be a mapping of currency code to number, got ${typeof raw}`);
    }
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const code = normalizeCurrency(key);
    if (!code) {
      onProblem?.(`"${key}" is not a three-letter currency code — ignored`);
      continue;
    }
    const n = typeof value === "string" ? Number(value) : value;
    if (!usable(n)) {
      onProblem?.(`rate for ${code} must be a positive number, got ${JSON.stringify(value)}`);
      continue;
    }
    out[code] = n;
  }
  return out;
}

/**
 * Units of `base` for one unit of `currency`, or undefined when the table
 * says nothing about it.
 *
 * Undefined rather than 1 on purpose. Falling back to 1 is exactly the silent
 * failure this whole module exists to prevent: it turns 450 THB into 450 CHF
 * and the total still looks plausible.
 */
export function rateToBase(
  currency: string,
  base: string,
  rates: RateTable,
): number | undefined {
  if (currency === base) return 1;
  const r = rates[currency];
  return usable(r) ? r : undefined;
}

/** `amount` of `currency` expressed in `base`, or undefined with no rate. */
export function toBase(
  amount: number,
  currency: string,
  base: string,
  rates: RateTable,
): number | undefined {
  const rate = rateToBase(currency, base, rates);
  return rate === undefined ? undefined : amount * rate;
}

/**
 * Units of `to` for one unit of `from`, derived from a euro-quoted table.
 *
 * The ECB publishes 1 EUR = X CCY, so any pair is `to / from` with EUR itself
 * standing in as 1.
 */
export function crossRate(from: string, to: string, eurRates: RateTable): number | undefined {
  if (from === to) return 1;
  const f = from === ECB_BASE ? 1 : eurRates[from];
  const t = to === ECB_BASE ? 1 : eurRates[to];
  if (!usable(f) || !usable(t)) return undefined;
  return t / f;
}

/**
 * Money as text: `CHF 1’234`, or `≈ EUR 1’291` once it has been converted.
 *
 * The `≈` is not decoration. Every number on the costs page that is not in the
 * currency actually spent is an approximation through two rates, and saying so
 * is cheaper than being asked.
 *
 * Grouped with the Swiss apostrophe regardless of locale, because the
 * alternative — `toLocaleString` — differs between the build server and the
 * browser and would produce hydration mismatches, the same reason
 * `lib/i18n.ts` carries its own month names.
 */
export function formatMoney(
  amount: number,
  currency: string,
  opts: { decimals?: boolean; approximate?: boolean } = {},
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const rounded = opts.decimals ? safe.toFixed(2) : Math.round(safe).toString();
  const grouped = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return `${opts.approximate ? "≈ " : ""}${currency} ${grouped}`;
}
