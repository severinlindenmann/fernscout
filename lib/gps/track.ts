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

/** How many points, across every segment. For the CLI's report. */
export function trackPointCount(track: Track): number {
  return track.segments.reduce((total, s) => total + s.points.length, 0);
}
