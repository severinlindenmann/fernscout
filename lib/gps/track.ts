import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * A trip's own line — `content/<user>/trips/<trip>/track.json`.
 *
 * The derived half of B665, and **the only half anything renders.** It holds
 * one trip's worth of route, clipped to the trip's dates, with the owner's
 * private zones cut out and the whole thing thinned to a few thousand points.
 * It belongs to the trip the way the trip's photographs do: inside the trip
 * folder, so it is in the trip's export, behind the trip's own gate, and
 * carried along if the trip is handed to somebody else.
 *
 * **Deleting `content/<user>/gps/` entirely changes nothing here.** That is
 * the point of two files rather than one, and it is a test.
 *
 * This module is safe for `app/` to import; `store.ts` and `enrich.ts` are
 * not, and that line is what the whole feature rests on.
 */

/** One run of continuous positions. A break between segments is a hole in the
 * data — a flight, a dead battery — and is drawn as a break, never joined. */
export type TrackSegment = {
  /** ISO instant of the first point. */
  from: string;
  /** The trip date (YYYY-MM-DD) this segment's local-midnight window belongs
   * to — B2202. Absent on a legacy file derived before this field existed;
   * `readerTrack` below drops any segment without one, since there is no way
   * to know whether the date it was drawn from is one this reader may see. */
  day?: string;
  /** `[lat, lon]`, in order. Five decimal places. */
  points: [number, number][];
};

export type Track = {
  /** ISO instant this file was derived, so an owner can tell whether it
   * predates the days they have since written. */
  generated: string;
  segments: TrackSegment[];
};

export function trackFile(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "track.json");
}

/** The trip's line, or undefined. A trip with no track is the normal case and
 * renders exactly as it did before this existed. */
export function readTrack(username: string, tripId: string): Track | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(trackFile(username, tripId), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const { generated, segments } = raw as Partial<Track>;
  if (!Array.isArray(segments)) return undefined;
  const clean = segments.filter(
    (s): s is TrackSegment =>
      typeof s === "object" &&
      s !== null &&
      (s.day === undefined || typeof s.day === "string") &&
      Array.isArray(s.points) &&
      s.points.length > 1 &&
      s.points.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n)),
      ),
  );
  if (clean.length === 0) return undefined;
  return { generated: typeof generated === "string" ? generated : "", segments: clean };
}

export function writeTrack(username: string, tripId: string, track: Track): void {
  fs.writeFileSync(trackFile(username, tripId), `${JSON.stringify(track)}\n`, "utf8");
}

/** Remove a trip's line file entirely — B2202, when derivation comes back
 * with nothing (the store has no fixes left for this trip's dates, or every
 * one of them was trimmed away). Replaces the old "leave a stale file alone"
 * answer: a track that no longer has anything behind it must not keep
 * drawing what it drew last time. */
export function deleteTrack(username: string, tripId: string): void {
  fs.rmSync(trackFile(username, tripId), { force: true });
}

/**
 * What a reader may actually be drawn — the one door onto `track.json` for
 * anything under `app/`, `components/` or an export, other than the
 * owner-only `/track` route that answers with counts. B2202: derivation now
 * covers every trip date, published or not, so the safety guarantee has
 * moved here — keep only the segments whose `day` is one this particular
 * reader is currently shown an entry for. A segment with no `day` is a
 * legacy file, derived before this field existed, and is dropped rather than
 * trusted: there is no way to know which date it came from, so there is no
 * way to know it is safe.
 */
export function readerTrack(
  username: string,
  tripId: string,
  visibleDates: ReadonlySet<string>,
): Track | undefined {
  const track = readTrack(username, tripId);
  if (!track) return undefined;
  const segments = track.segments.filter((s) => s.day !== undefined && visibleDates.has(s.day));
  if (segments.length === 0) return undefined;
  return { ...track, segments };
}

/**
 * One day's own part of a reader's track — B2199. `readerTrack` above is the
 * safety gate; this narrows what it returns to the one date a day permalink
 * page is about, so a day's map draws only its own line and never another
 * day's, or a legacy segment with no `day` at all (already dropped by
 * `readerTrack`). Returns `undefined` rather than `[]` when there is nothing
 * to draw, the same "absent, not empty" shape `readerTrack` itself uses.
 */
export function dayTrack(
  username: string,
  tripId: string,
  visibleDates: ReadonlySet<string>,
  date: string,
): [number, number][][] | undefined {
  const segments = readerTrack(username, tripId, visibleDates)?.segments.filter(
    (s) => s.day === date,
  );
  return segments && segments.length > 0 ? segments.map((s) => s.points) : undefined;
}

/** How many points, across every segment. For the CLI's report. */
export function trackPointCount(track: Track): number {
  return track.segments.reduce((total, s) => total + s.points.length, 0);
}
