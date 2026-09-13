import "server-only";
import { getTrip, type TripRef } from "../trips";
import { ALL_TRACKED, TRACKS, type Tracks } from "../tracks";
import { tracksBlock } from "../tripWrite";

/**
 * Changing what a trip keeps track of, after it exists — B531.
 *
 * **v2 retired trip-level tracks** (B1598, and see the note beside
 * `tracks: parseTracks(undefined)` in `lib/trips.ts`'s own reader): every day
 * answers every declinable directly now (`DAY_DECLINABLES`), so there is no
 * trip-level "what to ask for" left to persist — a day that has nothing to
 * report says so itself, on that day, rather than a trip switching off a
 * whole row for every day in it. This door still validates a request in the
 * same words it always refused a bad one in, so a caller sending nonsense is
 * still told what is wrong with it; it no longer has anywhere to write a
 * good one, and reports the truth — nothing changed — rather than a write
 * that would be forgotten the moment anything re-read the trip.
 */

export type TracksWriteResult =
  | { ok: true; tracks: Tracks; turnedOff: string[]; turnedOn: string[] }
  | { ok: false; error: string; message?: string; bug?: true };

export function patchTripTracks(ref: TripRef, raw: unknown): TracksWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_tracks",
      message:
        `Send {"tracks": {"costs": false}} — the rows are ${TRACKS.join(", ")}, each true or ` +
        `false, and only the ones you name change.`,
    };
  }

  const merged: Record<string, unknown> = { ...trip.tracks, ...(raw as Record<string, unknown>) };
  const block = tracksBlock(merged);
  if (!block.ok) return { ok: false, error: block.error, message: block.message };

  // trip.tracks is always ALL_TRACKED (the reader no longer stores or reads
  // this), so there is nothing to turn off or on to report.
  return { ok: true, tracks: ALL_TRACKED, turnedOff: [], turnedOn: [] };
}
