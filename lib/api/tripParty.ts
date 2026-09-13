import "server-only";
import { fileUnchangedSince } from "../entries";
import { getTrip, parseTripRef, type TripRef } from "../trips";
import type { TripPerson } from "../types";
import type { Figure } from "../travellers/vocabulary";
import { peopleBlock, travellersBlock, writeTravellersAsFigures, type BlockResult } from "../tripWrite";
import { readTripJson, writeTripJson } from "./tripFile";

/**
 * Amending a trip's `people:` and `figures:` (v1: `travellers:`) after it has
 * been created — B524.
 *
 * The third and fourth doors of the same set: `.../rates` (B352) and
 * `.../visibility` (B396) opened first, and these were the two fields left
 * that `createTrip` could write once and nothing could ever write again. The
 * guide's own advice — "a trip that already exists takes the same block
 * written into its file" — has nowhere to go on a hosted instance where
 * nobody has a shell, and the only remaining route was to delete the trip and
 * rewrite every day and every photograph in it.
 *
 * Built the same way as its two siblings and for the same reasons: a
 * read-modify-write of `trip.json` (B1598) that leaves every other key alone,
 * validated by the *same* block builders `createTrip` uses, and guarded by
 * `fileUnchangedSince` so a concurrent edit is refused rather than erased.
 *
 * **Wholesale, not merged**, which is the one place this differs from
 * `.../rates`. A rate table is a set of independent facts and merging a single
 * currency into it is obviously right. A party is a list whose *order* and
 * whose *membership* both mean something — a figure's `for` ties it to an
 * address in `people:` — so a call that named one person and left the rest
 * implied would have to guess whether the others were being kept or dropped.
 * Send the whole list; send `[]` to clear it.
 */

export type PartyWriteResult =
  | { ok: true; people: TripPerson[]; travellers: Figure[] }
  | { ok: false; error: string; message?: string; bug?: true };

/** What the trip says today. Read through `getTrip`, so it is exactly what
 * the site itself reads — a block this module wrote and the site then ignored
 * would show up here as a difference rather than as agreement. */
export function readTripParty(ref: TripRef): { people: TripPerson[]; travellers: Figure[] } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return { people: trip.people, travellers: trip.travellers };
}

/**
 * Write one of the two blocks. `raw` is the same shape `createTrip` takes for
 * that field — a list, or `[]` to clear it.
 */
export function patchTripParty(
  ref: TripRef,
  key: "people" | "travellers",
  raw: unknown,
): PartyWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: `invalid_${key}`,
      message:
        `${key} must be a list — the whole list, not the part that changed. Send \`[]\` to ` +
        `clear it. Read the trip back first if you only mean to add somebody: this replaces ` +
        `what is there.`,
    };
  }

  // The same validator the create call uses, so a body refused here would
  // have been refused at creation and one accepted reads back identically.
  const block: BlockResult = key === "people" ? peopleBlock(raw) : travellersBlock(raw);
  if (!block.ok) return { ok: false, error: block.error, message: block.message };

  const read = readTripJson(ref);
  if (!read) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.json could not be read. Edit the file by hand.",
    };
  }

  const parsed = parseTripRef(ref);
  const next =
    key === "people"
      ? { ...read.trip, people: (block.value as TripPerson[]) }
      : {
          ...read.trip,
          ...(() => {
            const figures =
              parsed && raw.length > 0
                ? writeTravellersAsFigures(parsed.username, parsed.tripId, raw)
                : undefined;
            return { figures };
          })(),
        };

  if (!fileUnchangedSince(read.file, read.raw)) {
    return {
      ok: false,
      error: "conflict",
      message:
        "trip.json changed while this was being written — something else wrote to this trip at " +
        "the same time. Nothing was written; read the trip back and send this change again.",
    };
  }
  writeTripJson(read.file, next);

  const after = readTripParty(ref);
  if (!after) {
    return {
      ok: false,
      bug: true,
      error: "trip.json was written and the trip no longer reads. This is a bug; please report it.",
    };
  }
  if (after[key].length !== raw.length) {
    return {
      ok: false,
      bug: true,
      error:
        `trip.json was written with ${raw.length} ${key} but reads back with ` +
        `${after[key].length}. This is a bug; please report it.`,
    };
  }
  return { ok: true, ...after };
}
