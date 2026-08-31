import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { loadUserConfig } from "./config";
import { ECB_BASE, crossRate, normalizeCurrency, parseRateTable, type RateTable } from "./currency";

/**
 * The second hop: base currency → whatever the reader picked.
 *
 * The trip's own frozen rates handle local → base (`lib/trips.ts`). Going on
 * from there to a reader's currency needs a *current* rate, and that comes
 * from the European Central Bank reference rates cached at
 * `content/rates/ecb.json` by `npm run rates:update`.
 *
 * Read off disk, never fetched here. The build has to work on a machine with
 * no network, so the fetch is a thing you run and commit, not a thing the
 * build depends on.
 */

export type EcbSnapshot = {
  /** The ECB's publication date for these rates, `yyyy-mm-dd`. */
  date: string;
  /** Units of each currency for one euro. */
  rates: RateTable;
};

export function ecbCachePath(): string {
  return path.join(contentRoot(), "rates", "ecb.json");
}

const cache = new Map<string, EcbSnapshot | null>();

/**
 * The cached ECB table, or undefined when there isn't one.
 *
 * Undefined is a supported state, not an error: a fresh clone with its own
 * content folder and no rates file still renders, it simply offers no
 * currency but the base one. That is a visible absence rather than a wrong
 * number, which is the trade this whole package is built around.
 */
export function loadEcbRates(): EcbSnapshot | undefined {
  const file = ecbCachePath();
  if (cache.has(file)) return cache.get(file) ?? undefined;

  let snapshot: EcbSnapshot | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const rates = parseRateTable(raw.rates, (m) => console.warn(`[rates] ${file}: ${m}`));
    if (Object.keys(rates).length === 0) {
      console.warn(`[rates] ${file} holds no usable rates — ignoring it.`);
    } else {
      snapshot = { date: String(raw.date ?? ""), rates };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`[rates] ${file} could not be read (${String(err)}) — ignoring it.`);
    }
  }

  cache.set(file, snapshot);
  return snapshot ?? undefined;
}

/** Test seam — drops the memoised snapshot. */
export function clearRatesCache(): void {
  cache.clear();
}

/**
 * What a reader may switch the display to, and the multiplier for each.
 *
 * Serialisable on purpose: the root layout hands this to `CurrencyProvider`,
 * the same way it hands `siteSummary()` to `SiteProvider`, because this
 * module reads the filesystem and cannot be in the client bundle.
 */
export type CurrencyOptions = {
  /** The currency every stored total is normalised to. */
  base: string;
  /** Offered currencies, always starting with the base. */
  currencies: string[];
  /** Units of each offered currency for one unit of the base. */
  rates: Record<string, number>;
  /** The ECB publication date behind those rates, when there is one. */
  asOf?: string;
};

/**
 * Builds the reader-facing currency list.
 *
 * A configured display currency with no rate is dropped from the list rather
 * than offered and then silently wrong. `site.manualRates` fills the gaps —
 * it uses the ECB's own convention (units per euro) so the two tables merge
 * without a second mental model, and it wins where both have an entry, which
 * is what makes it an override.
 */
export function currencyOptions(username: string): CurrencyOptions {
  const site = loadUserConfig(username);
  const base = normalizeCurrency(site.baseCurrency, site.baseCurrency.toUpperCase());
  const snapshot = loadEcbRates();
  const eur: RateTable = { ...(snapshot?.rates ?? {}), ...site.manualRates };

  const currencies: string[] = [base];
  const rates: Record<string, number> = { [base]: 1 };

  for (const raw of site.displayCurrencies) {
    const code = normalizeCurrency(raw);
    if (!code || code === base || rates[code] !== undefined) continue;
    const rate = crossRate(base, code, eur);
    if (rate === undefined) {
      console.warn(
        `[rates] site.displayCurrencies lists ${code}, but neither the cached ECB table ` +
          `nor site.manualRates covers ${base}→${code}. Add it to site.manualRates ` +
          `(units of the currency per 1 ${ECB_BASE}) or run npm run rates:update.`,
      );
      continue;
    }
    currencies.push(code);
    rates[code] = rate;
  }

  return {
    base,
    currencies,
    rates,
    asOf: currencies.length > 1 ? snapshot?.date || undefined : undefined,
  };
}
