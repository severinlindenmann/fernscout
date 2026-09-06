import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isEnabled } from "../capabilities";
import { conversionFor, getAllCosts } from "../costs";
import { crossRate, type RateTable } from "../currency";
import { ecbRatesOnOrBefore, fetchEcbHistory } from "../ecbHistory";
import { getTrip, parseTripRef, tripDir, type TripRef } from "../trips";
import { quoteScalar } from "../validate/frontmatter";
import { ratesBlock } from "../tripWrite";

/**
 * Amending a trip's `rates:` block after it has been created — B352.
 *
 * `createTrip` (lib/tripWrite.ts) could only ever write `rates:` once, at the
 * moment the folder is made, because nothing edited `trip.md` afterwards
 * (B207). The costs page then tells an owner with an unrated currency to "add
 * the missing rates to the trip's trip.md" — advice with nowhere to go on a
 * hosted instance, where nobody has a shell. This is the door that instruction
 * was missing.
 *
 * Merges rather than replaces: a currency already in the table keeps its rate
 * unless this call names it again, so filling in the one THB rate a trip is
 * missing does not require resending every rate already on it. `ratesBlock`
 * — the same validator `createTrip` uses — both checks the merged table and
 * renders it, so a rate this writes reads back exactly as one written at
 * creation would.
 */

const INDENTED_RE = /^\s+\S/;

/** Where `key:` starts and ends inside the frontmatter, or -1 if absent. */
function frontmatterLineOf(lines: string[], closing: number, key: string): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
}

/**
 * Replace one top-level frontmatter key and everything indented under it.
 * Mirrors `spliceBlock` in lib/api/costs.ts — kept as its own small copy
 * rather than shared, the same call that module's own comment makes: the two
 * touch different files, so importing across would only couple them for a
 * dozen lines.
 *
 * Takes `key` rather than being `rates:`'s alone since B543: `ratesFrom:` is
 * spliced the same way, right beside it.
 */
function spliceKeyBlock(markdown: string, key: string, newLines: string[]): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const at = frontmatterLineOf(lines, closing, key);
  let end = at;
  if (at >= 0) {
    end = at + 1;
    while (end < closing && INDENTED_RE.test(lines[end])) end++;
    lines.splice(at, end - at, ...newLines);
  } else if (newLines.length > 0) {
    lines.splice(closing, 0, ...newLines);
  }
  return lines.join("\n");
}

export type RatesWriteResult =
  | { ok: true; rates: RateTable }
  | { ok: false; error: string; message?: string; bug?: true };

/** Read the `rates:` table currently on disk, `{}` when there is none. */
export function readTripRates(ref: TripRef): RateTable {
  const trip = getTrip(ref);
  return trip?.rates ?? {};
}

/**
 * Merge `raw` (a currency-code → number map, same shape `createTrip` takes)
 * into the trip's existing rates and write the result back to `trip.md`.
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

  const merged = { ...trip.rates, ...(raw as Record<string, unknown>) };
  const block = ratesBlock(merged);
  if (!block.ok) return { ok: false, error: block.error, message: block.message };

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");
  const spliced = spliceKeyBlock(text, "rates", block.lines);
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }

  try {
    matter(spliced);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave trip.md unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  fs.writeFileSync(file, spliced);

  const rates = readTripRates(ref);
  if (
    Object.keys(raw as Record<string, unknown>).some((code) => !(code.trim().toUpperCase() in rates))
  ) {
    return {
      ok: false,
      bug: true,
      error: "trip.md was written but the new rates do not read back. This is a bug; please report it.",
    };
  }
  return { ok: true, rates };
}

/**
 * Merge citations into the trip's `ratesFrom:` block, right beside `rates:`.
 *
 * Not validated the way `patchTripRates` validates a caller's numbers — this
 * is only ever called by `fillTripRates` below with a string it just built
 * itself, never with anything a request handed in, so there is nothing here
 * for a person to get wrong.
 */
function writeRatesFrom(ref: TripRef, citations: Record<string, string>): void {
  if (Object.keys(citations).length === 0) return;
  const merged = { ...(getTrip(ref)?.ratesFrom ?? {}), ...citations };
  const lines = ["ratesFrom:", ...Object.entries(merged).map(([code, note]) => `  ${code}: ${quoteScalar(note)}`)];

  const file = path.join(tripDir(ref), "trip.md");
  const spliced = spliceKeyBlock(fs.readFileSync(file, "utf8"), "ratesFrom", lines);
  // Same refusal `patchTripRates` makes for a hand-shaped file with no
  // frontmatter block — but `rates:` itself will already have failed to
  // write in that case, so this is only ever reached on a file that parses.
  if (spliced === null) return;
  fs.writeFileSync(file, spliced);
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
    toWrite[code] = rate;
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
export function fillTripRatesQuietly(ref: string): Promise<unknown> {
  return fillTripRates(ref).catch(() => undefined);
}
