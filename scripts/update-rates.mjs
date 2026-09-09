// Reading the European Central Bank's reference rate documents.
//
// Parsing only, plus the read-only cross-rate lookup below. **The refresh that
// writes this instance's table is scripts/rates-refresh.mts** — it needs to
// know where this instance keeps its data and whether it does money at all,
// and neither question belongs in a file whose other half is pure parsing
// (B1084). Nothing here touches the disk.
//
// The ECB publishes one euro-quoted table a day, free, with no API key:
// https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// Every value is "units of this currency for one euro". Around 30 currencies
// are covered; anything outside that list gets a manual rate in
// site/config.json under site.manualRates.
//
// A second, read-only mode — B216 — looks up the cross-rate an author needs
// to freeze into a trip's own `rates:` block, in *that* block's convention
// (base per one unit of the keyed currency, the inverse of the ECB's own):
//
//   npm run rates:update -- --pair THB --base CHF --on 2026-03-14
//
// It prints a pasteable line and touches nothing on disk — a frozen trip rate
// is a judgement about what the trip actually cost, and this only hands over
// the reference number, never decides for anyone. See docs/currencies.md.

/**
 * Where the daily table comes from.
 *
 * Overridable because not everyone can reach ecb.europa.eu: an air-gapped
 * install may hold a mirror, and CI should not need the open internet to check
 * that this script still writes where it says it does. The document format is
 * the ECB's either way.
 */
export const DAILY_URL =
  process.env.ECB_RATES_URL ||
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/**
 * The 90-day history, same document and same override variable
 * `lib/ecbHistory.ts` reads server-side for `fillTripRates` — one day per
 * `<Cube time=…>` block instead of the daily file's one. `--pair` asks it for
 * a rate on a date in the past; a date older than the window is refused
 * rather than guessed past. The ECB's full multi-year history is a separate,
 * much larger `eurofxref-hist.zip` this script does not fetch — a trip that
 * old is asking for judgement call 1 or 3 in docs/currencies.md, not a lookup.
 */
const HISTORY_URL =
  process.env.ECB_HISTORY_URL || "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";


/**
 * The document is a fixed, tiny shape that has not changed in twenty years,
 * so it is read with a regex rather than by adding an XML parser to the
 * dependency list for one file.
 */
export function parseEcbXml(xml) {
  const date = xml.match(/<Cube\s+time=['"]([\d-]{10})['"]/)?.[1];
  if (!date) throw new Error("no <Cube time=…> in the ECB document");

  const rates = {};
  const re = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  for (const [, code, value] of xml.matchAll(re)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) rates[code] = n;
  }
  if (Object.keys(rates).length === 0) throw new Error("no rates in the ECB document");
  return { date, rates };
}

/** One `{ date, rates }` per `<Cube time=…>` block — see lib/ecbHistory.ts's
 * `parseEcbHistory`, which this mirrors for the same document. */
export function parseEcbHistoryXml(xml) {
  const days = [];
  for (const [, date, body] of xml.matchAll(/<Cube\s+time=['"]([\d-]{10})['"]>([\s\S]*?)<\/Cube>/g)) {
    const rates = {};
    for (const [, code, value] of body.matchAll(
      /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g,
    )) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) rates[code] = n;
    }
    if (Object.keys(rates).length > 0) days.push({ date, rates });
  }
  return days;
}

/** The nearest publication day on or before `target` — the ECB does not
 * publish on weekends — or undefined when `target` precedes the window. */
export function ecbDayOnOrBefore(days, target) {
  let best;
  for (const day of days) {
    if (day.date > target) continue;
    if (!best || day.date > best.date) best = day;
  }
  return best;
}

/**
 * Units of `to` for one unit of `from`, from a euro-quoted table — the same
 * arithmetic as `crossRate` in lib/currency.ts, kept as its own copy for the
 * reason this whole file already gives itself: a plain script reading a
 * fixed document should not have to import the server-only app to do it.
 */
export function crossRate(from, to, eurRates) {
  if (from === to) return 1;
  const f = from === "EUR" ? 1 : eurRates[from];
  const t = to === "EUR" ? 1 : eurRates[to];
  if (!Number.isFinite(f) || f <= 0 || !Number.isFinite(t) || t <= 0) return undefined;
  return t / f;
}

/** Six significant figures — plenty for a number somebody is about to
 * retype by hand, and short enough that `VND: 0.000034` stays legible. */
export function readableRate(rate) {
  const short = Number(rate.toPrecision(6));
  return String(short).includes("e") ? rate : short;
}

/**
 * The read-only mode: print the trip-convention cross-rate for `--pair`
 * against `--base` on `--on`, and nothing else. Never touches disk.
 */
export async function printCrossRate({ pair, base, on }, { fetchImpl = fetch, log = console.log, error = console.error } = {}) {
  let xml;
  try {
    const res = await fetchImpl(HISTORY_URL, { headers: { accept: "application/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    error(`Could not reach the ECB: ${err.message}`);
    return false;
  }

  const days = parseEcbHistoryXml(xml);
  if (days.length === 0) {
    error("No rates in the ECB history document.");
    return false;
  }

  const day = ecbDayOnOrBefore(days, on);
  if (!day) {
    const oldest = days.reduce((min, d) => (d.date < min ? d.date : min), days[0].date);
    error(
      `${on} is before this window's earliest day (${oldest}). The 90-day history ` +
        "does not reach back that far — the ECB's own full history is at " +
        "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip, or use what the trip actually paid.",
    );
    return false;
  }

  const rate = crossRate(pair, base, day.rates);
  if (rate === undefined) {
    error(`The ECB does not publish ${pair} (on ${day.date} or otherwise).`);
    return false;
  }

  log(
    `Trip convention (${base} per 1 ${pair}), from the ECB rate on ${day.date}` +
      `${day.date === on ? "" : ` (the nearest publication day on or before ${on})`}:\n` +
      `  ${pair}: ${readableRate(rate)}`,
  );
  return true;
}
