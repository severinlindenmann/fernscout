import "server-only";
import { isEnabled } from "../capabilities";
import { loadUserConfig } from "../config";
import { conversionFor, getAllCosts } from "../costs";
import { crossRate, normalizeCurrency, type RateTable } from "../currency";
import { fileUnchangedSince } from "../entries";
import { ecbRatesOnOrBefore, fetchEcbHistory } from "../ecbHistory";
import { getTrip, parseTripRef, type TripRef } from "../trips";
import { eurManualRates, ratesBlock } from "../tripWrite";
import { readTripJson, writeTripJson } from "./tripFile";

/**
 * Amending a trip's rates after it has been created — B352.
 *
 * `createTrip` (lib/tripWrite.ts) could only ever write rates once, at the
 * moment the folder is made, because nothing edited the trip's own file
 * afterwards (B207). The costs page then tells an owner with an unrated
 * currency to "add the missing rates to the trip's file" — advice with
 * nowhere to go on a hosted instance, where nobody has a shell. This is the
 * door that instruction was missing.
 *
 * Merges rather than replaces: a currency already in the table keeps its rate
 * unless this call names it again, so filling in the one THB rate a trip is
 * missing does not require resending every rate already on it. `ratesBlock`
 * — the same validator `createTrip` uses — both checks the merged table and
 * hands back the plain code→number map, in the direction a caller sends it
 * (base units per one unit of the keyed currency); this file is what turns
 * that into `trip.json`'s `rates.manual` (units per 1 EUR, the ECB table's
 * own convention — `eurManualRates` in lib/tripWrite.ts, a B1598 finding).
 *
 * **Merges onto the stored `manual` table, not onto `getTrip()`'s resolved
 * `rates`.** The resolved table (what `lib/trips.ts` hands every reader)
 * blends the ECB's own daily rates in for every currency a ledger uses, not
 * only the ones an owner set by hand — merging a request into *that* would
 * freeze every ECB default into a permanent manual override the moment
 * anybody touched one currency. The stored `trip.json` is read directly
 * (`readTripJson`) for exactly the value that must be merged onto: what an
 * owner actually asked to pin.
 */

export type RatesWriteResult =
  | { ok: true; rates: RateTable }
  | { ok: false; error: string; message?: string; bug?: true };

/**
 * Merge `raw` (a currency-code → number map, same shape `createTrip` takes)
 * into the trip's own stored manual rates and write the result back.
 */
export function patchTripRates(ref: TripRef, raw: unknown): RatesWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_rates",
      message:
        'rates must be an object of currency code to number, e.g. {"THB": 0.0245} — units of ' +
        "the journal's base currency for one unit of the keyed currency.",
    };
  }
  if (Object.keys(raw).length === 0) {
    return {
      ok: false,
      error: "invalid_rates",
      message: "rates is empty — name at least one currency to add or change.",
    };
  }

  const read = readTripJson(ref);
  if (!read) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.json could not be read. Edit the file by hand.",
    };
  }

  // v1's own "base per one unit of code" convention — merged as such, then
  // converted once, below.
  const storedManual = storedBasePerCode(ref, read.trip.rates?.manual);
  const merged = { ...storedManual, ...(raw as Record<string, unknown>) };
  const block = ratesBlock(merged);
  if (!block.ok) return { ok: false, error: block.error, message: block.message };

  const username = parseTripRef(ref)?.username ?? "";
  const baseCurrency = normalizeCurrency(loadUserConfig(username).baseCurrency, loadUserConfig(username).baseCurrency.toUpperCase());
  const manual = eurManualRates(baseCurrency, block.value as Record<string, number>);
  // `currencies` names the currencies a cost may actually be spent in —
  // "EUR", say — not the keys `manual` stores under, which for an EUR rate
  // is the trip's own base currency instead (see `eurManualRates`'s
  // docblock). So this comes from `block.value`'s own keys, the v1-style
  // currency codes the caller named, merged with whatever the trip already
  // listed.
  const currencies = Array.from(
    new Set([...(read.trip.rates?.currencies ?? []), ...Object.keys(block.value as object)]),
  );
  const next = {
    ...read.trip,
    ...(manual ? { rates: { currencies, manual } } : { rates: undefined }),
  };

  // B643 — see `fileUnchangedSince` in lib/entries.ts.
  if (!fileUnchangedSince(read.file, read.raw)) {
    return {
      ok: false,
      error: "conflict",
      message:
        "trip.json changed while these rates were being written — something else wrote to this " +
        "trip at the same time. Nothing was written; read the trip back and send this change again.",
    };
  }
  writeTripJson(read.file, next);

  const rates = getTrip(ref)?.rates ?? {};
  if (
    Object.keys(raw as Record<string, unknown>).some((code) => !(code.trim().toUpperCase() in rates))
  ) {
    return {
      ok: false,
      bug: true,
      error: "trip.json was written but the new rates do not read back. This is a bug; please report it.",
    };
  }
  return { ok: true, rates };
}

/**
 * The trip's stored manual rates (EUR convention), converted back to v1's
 * "base per code" convention so a merge with a caller's request — which
 * still speaks that convention — is comparing like with like. The inverse of
 * `eurManualRates`.
 */
function storedBasePerCode(
  ref: TripRef,
  manual: Record<string, number> | undefined,
): Record<string, number> {
  if (!manual) return {};
  const username = parseTripRef(ref)?.username ?? "";
  const baseCurrency = normalizeCurrency(loadUserConfig(username).baseCurrency, loadUserConfig(username).baseCurrency.toUpperCase());
  // The base currency's own entry (if present) IS a stored "EUR" rate — see
  // `eurManualRates`'s docblock for why it has to live there rather than
  // under a `manual.EUR` nothing ever reads. Reconstructed as "EUR" here so
  // a merge that leaves an existing EUR rate untouched still sees it.
  const baseEur = baseCurrency === "EUR" ? undefined : manual[baseCurrency];
  const out: Record<string, number> = {};
  if (baseEur !== undefined) out.EUR = baseEur;
  for (const [code, eurPerCode] of Object.entries(manual)) {
    if (code === baseCurrency) continue;
    out[code] = (baseEur ?? 1) / eurPerCode;
  }
  return out;
}

/**
 * v2 has no home for a per-rate citation (`ratesFrom:` never had one — see
 * `lib/api/v2/documents.ts`'s own note on `tripFromJson`): `lib/trips.ts`'s
 * reader already synthesises an equivalent label from whether a rate is in
 * `manual` at all ("the trip's own rate") or came from the ECB's daily table
 * ("European Central Bank, <date>"), which is what every reader has always
 * been shown. So there is nothing left for this to persist; it is kept as a
 * no-op rather than deleted so `fillTripRates` below needs no change of its
 * own shape.
 */
function writeRatesFrom(_ref: TripRef, _citations: Record<string, string>): void {
  // Intentionally empty — see the docblock above.
}

/**
 * Six significant figures, which is four more than any of this matters to and
 * still a number a person can read. A cross-division lands on the full float —
 * `0.024556709684188438` — and the trip's own file is one somebody opens.
 *
 * The original is kept whenever the shorter form would be written in exponent
 * notation, because `ratesBlock` refuses that: a rate is either legible or it
 * is exact, and never a `4.2e-7` nothing downstream will parse.
 */
function readable(rate: number): number {
  const short = Number(rate.toPrecision(6));
  return String(short).includes("e") ? rate : short;
}

/**
 * Filling in a trip's missing local→base rates from the ECB's own 90-day
 * history — B543, in the shape of `fillDayWeather` (lib/api/weather.ts):
 * one function, two callers, so a rate that arrived one way is the same rate
 * that would have arrived the other.
 *
 * **Nothing here throws.** A day is saved, and a trip's costs page renders,
 * whether or not the archive answered for a given currency — a currency it
 * did not answer for is "not yet", the same standing `getCostSummary`
 * (lib/costs.ts) already gives an unrated currency, and the sweep comes back
 * for it.
 */
export type RateFillOutcome =
  | "filled"
  | "would_fetch"
  | "already_rated"
  | "outside_window"
  | "not_published"
  | "no_answer";

/**
 * One outcome per currency the trip's costs actually use and `rates:` does
 * not already cover. A currency the costs never mention is not in the
 * result at all — there is nothing to say about it.
 *
 * The four refusals before any request, in order, mirror the weather
 * ticket's own edges:
 *
 * - **the costs capability is off** — no request to any third party, on any
 *   path; the trip's currencies are not even enumerated.
 * - **the currency already has a rate** — hand-typed or filled, never
 *   overwritten. `already_rated`.
 * - **the date is outside the 90-day window** — older than the archive
 *   reaches back. `outside_window`.
 * - **the ECB does not publish that currency** — even on the day itself.
 *   `not_published`.
 */
export async function fillTripRates(
  ref: string,
  options?: { signal?: AbortSignal; dryRun?: boolean },
): Promise<Record<string, RateFillOutcome>> {
  const username = parseTripRef(ref)?.username;
  if (!username || !isEnabled("costs", username)) return {};

  const trip = getTrip(ref);
  if (!trip) return {};

  const { base } = conversionFor(ref);

  // The earliest date each currency the costs actually use appears on. A
  // preparation cost carries no date of its own — it was paid before day one
  // of anything — so it freezes at the trip's own start, the earliest date
  // there is a fact about.
  const firstSeen = new Map<string, string>();
  for (const item of getAllCosts(ref, { includeDrafts: true })) {
    const date = item.date ?? trip.start;
    const current = firstSeen.get(item.currency);
    if (!current || date < current) firstSeen.set(item.currency, date);
  }

  const outcomes: Record<string, RateFillOutcome> = {};
  const needed = [...firstSeen.keys()].filter((code) => code !== base).sort();
  for (const code of needed) {
    if (trip.rates[code] !== undefined) {
      outcomes[code] = "already_rated";
      continue;
    }
    // The dry run stops exactly here — after every rule, before the only
    // line that touches the network. See `fillDayWeather` for why that is
    // what makes `--dry-run` an honest rehearsal rather than a second copy
    // of these rules in the script.
    outcomes[code] = "would_fetch";
  }

  if (options?.dryRun) return outcomes;
  const stillNeeded = needed.filter((code) => outcomes[code] === "would_fetch");
  if (stillNeeded.length === 0) return outcomes;

  const history = await fetchEcbHistory({ signal: options?.signal });
  if (!history) {
    for (const code of stillNeeded) outcomes[code] = "no_answer";
    return outcomes;
  }
  const oldest = history.reduce((min, d) => (d.date < min ? d.date : min), history[0].date);

  const toWrite: Record<string, number> = {};
  const citations: Record<string, string> = {};
  for (const code of stillNeeded) {
    const target = firstSeen.get(code)!;
    if (target < oldest) {
      outcomes[code] = "outside_window";
      continue;
    }
    const onDay = ecbRatesOnOrBefore(history, target);
    const rate = onDay ? crossRate(code, base, onDay.rates) : undefined;
    if (!onDay || rate === undefined) {
      outcomes[code] = "not_published";
      continue;
    }
    toWrite[code] = readable(rate);
    citations[code] = `${onDay.date} European Central Bank`;
    outcomes[code] = "filled";
  }

  if (Object.keys(toWrite).length > 0) {
    const result = patchTripRates(ref, toWrite);
    if (result.ok) {
      writeRatesFrom(ref, citations);
    } else {
      // ponytail: every number in `toWrite` already passed the same checks
      // `ratesBlock` runs, so this is an unreached defensive branch rather
      // than a real outcome the vocabulary needs its own name for.
      for (const code of Object.keys(toWrite)) outcomes[code] = "not_published";
    }
  }

  return outcomes;
}

/**
 * What the two write routes call: the same fill, with the outcome dropped
 * and every failure swallowed — see `fillDayWeatherQuietly` for why this is
 * awaited rather than left floating.
 */
function fillTripRatesQuietly(ref: string): Promise<unknown> {
  return fillTripRates(ref).catch(() => undefined);
}
