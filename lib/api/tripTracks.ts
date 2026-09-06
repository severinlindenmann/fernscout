import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTrip, tripDir, type TripRef } from "../trips";
import { ALL_TRACKED, TRACKS, type Tracks } from "../tracks";
import { tracksBlock } from "../tripWrite";
import { spliceBlock } from "./tripFile";

/**
 * Changing what a trip keeps track of, after it exists — B531.
 *
 * The fifth one-field door, and the one most likely to be reached in anger:
 * an owner half way through a journey decides they are not going to keep
 * logging what everything cost, and every day they write is refused until
 * they can say so. Without this the only answers are `"costs": false` on
 * every day for the rest of the trip, or a shell on the server.
 *
 * Owner only, like every other trip field. This decides what an agent holding
 * a trip-scoped token will be *asked* for, and a token that could quietly
 * lower the bar it is measured against is not a bar.
 */

export type TracksWriteResult =
  | { ok: true; tracks: Tracks; turnedOff: string[]; turnedOn: string[] }
  | { ok: false; error: string; message?: string; bug?: true };

export function readTripTracks(ref: TripRef): Tracks | null {
  return getTrip(ref)?.tracks ?? null;
}

/**
 * Merges rather than replaces, which is the opposite of `people:` and
 * `travellers:` next door and the same as `rates:`.
 *
 * The reason is the same one that made those two wholesale: what a caller
 * means. A party is a list whose membership is the point, so naming one
 * person and leaving the rest implied is ambiguous. `tracks` is a set of
 * independent yes/no answers, and `{"costs": false}` means exactly one thing
 * — stop asking about money — with nothing said about photographs.
 */
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

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");
  const spliced = spliceBlock(text, "tracks", block.lines);
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

  const after = readTripTracks(ref) ?? ALL_TRACKED;
  return {
    ok: true,
    tracks: after,
    turnedOff: TRACKS.filter((key) => trip.tracks[key] && !after[key]),
    turnedOn: TRACKS.filter((key) => !trip.tracks[key] && after[key]),
  };
}
