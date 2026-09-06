import "server-only";

/**
 * The half of B543 that talks to the ECB's 90-day history — the same split
 * `lib/weatherFetch.ts` is for B325: everything about a *trip's* rate — which
 * currency needs one, what date it freezes at, how it is written — stays in
 * `lib/api/tripRates.ts`, and the network lives in the one file you can read
 * in a minute to see every request this software makes about currency.
 *
 * No API key, no dependency: the document is the same fixed, twenty-year-old
 * shape `scripts/update-rates.mjs` already reads with a regex, just with one
 * `<Cube time=…>` block per day instead of one for the whole document.
 */
export type EcbDay = {
  /** `yyyy-mm-dd`, the ECB's own publication date for this block. */
  date: string;
  /** Units of each currency for one euro — the ECB's own convention. */
  rates: Record<string, number>;
};

/**
 * Overridable for the same reason `ECB_RATES_URL` is in
 * scripts/update-rates.mjs and `OPEN_METEO_ARCHIVE_URL` is in
 * lib/weatherFetch.ts: an air-gapped install may hold a mirror, and a test
 * that checks this software reads the document correctly should not need the
 * open internet to do it.
 */
const HISTORY_URL =
  process.env.ECB_HISTORY_URL || "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

/**
 * The whole 90-day document — or undefined on any failure, timeout or empty
 * answer. Every caller treats that the same way `fetchDayWeather` treats a
 * missing reading: "not yet", never an error worth failing a write over.
 */
export async function fetchEcbHistory(options?: { signal?: AbortSignal }): Promise<EcbDay[] | undefined> {
  let xml: string;
  try {
    const res = await fetch(HISTORY_URL, {
      headers: { accept: "application/xml" },
      signal: options?.signal ?? AbortSignal.timeout(8_000),
    });
    if (!res.ok) return undefined;
    xml = await res.text();
  } catch {
    return undefined;
  }
  return parseEcbHistory(xml);
}

/** Exported so its test can feed a fixed document rather than the network. */
export function parseEcbHistory(xml: string): EcbDay[] | undefined {
  const days: EcbDay[] = [];
  // Each day is `<Cube time="…">…self-closing currency Cubes…</Cube>`, so the
  // first `</Cube>` after `<Cube time=` is that day's own closing tag.
  for (const [, date, body] of xml.matchAll(/<Cube\s+time=['"]([\d-]{10})['"]>([\s\S]*?)<\/Cube>/g)) {
    const rates: Record<string, number> = {};
    for (const [, code, value] of body.matchAll(
      /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g,
    )) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) rates[code] = n;
    }
    if (Object.keys(rates).length > 0) days.push({ date, rates });
  }
  return days.length > 0 ? days : undefined;
}

/**
 * The ECB's own rates for `target`, or the nearest earlier publication day
 * when the ECB did not publish on `target` itself (it does not, on weekends).
 * Undefined when `target` precedes every date the document covers — the
 * 90-day window's own edge, reported rather than guessed past.
 *
 * `days` need not be sorted; this does not assume the document's own order.
 */
export function ecbRatesOnOrBefore(days: EcbDay[], target: string): EcbDay | undefined {
  let best: EcbDay | undefined;
  for (const day of days) {
    if (day.date > target) continue;
    if (!best || day.date > best.date) best = day;
  }
  return best;
}
