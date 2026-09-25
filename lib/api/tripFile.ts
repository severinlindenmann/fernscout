import "server-only";
import fs from "node:fs";
import path from "node:path";
import { tripDir } from "../trips";
import { tripFromJson, tripToJson, type TripFile } from "./v2/documents";

/**
 * Read-modify-write of one trip's `trip.json` — the shared plumbing every
 * trip-field patcher (`tripParty.ts`, `tripRates.ts`, `tripVisibility.ts`,
 * `tripTracks.ts`, `tripDetails.ts`) needs (B1598).
 *
 * Used to be five copies of a twenty-line textual `spliceBlock` over
 * `trip.md`'s frontmatter — B524's own docblock names the copies and says why
 * nobody had merged them yet. JSON storage removes the reason to keep them
 * separate: every patcher now does the same three things — read the one
 * file, change a few keys, write it back if nothing else touched it since —
 * so this is the one place that does them.
 */

function tripJsonFile(ref: string): string {
  return path.join(tripDir(ref), "trip.json");
}

/** The trip's raw JSON text and its parsed form, or `null` when the file is
 * missing or will not parse. `raw` is what a caller's compare-and-swap
 * (`fileUnchangedSince`, lib/entries.ts, B643) needs before it writes. */
export function readTripJson(ref: string): { trip: TripFile; raw: string; file: string } | null {
  const file = tripJsonFile(ref);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { trip: tripFromJson(raw), raw, file };
  } catch {
    return null;
  }
}

export function writeTripJson(file: string, trip: TripFile): void {
  fs.writeFileSync(file, tripToJson(trip));
}
