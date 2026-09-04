import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { RateTable } from "../currency";
import { getTrip, tripDir, type TripRef } from "../trips";
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
 */
function spliceRates(markdown: string, newLines: string[]): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const at = frontmatterLineOf(lines, closing, "rates");
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
  const spliced = spliceRates(text, block.lines);
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
