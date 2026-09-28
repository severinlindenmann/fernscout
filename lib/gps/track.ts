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

/**
 * The live tail — `content/<user>/trips/<trip>/track-recent.json` — B2536.
 *
 * The last-24h slice `track.json` deliberately never carries (see
 * `MIN_AGE_MS` in `lib/gps/api.ts`). A second file rather than a flag on the
 * first: `track.json`'s own guarantee — "never inside 24 hours" — stays true
 * of the bytes on disk, not just of what a filter promises to drop, and
 * `docs/gps.md`'s "delete `gps/`, every trip renders exactly as before"
 * argument for two files applies here too. Same shape as `Track`, same
 * derivation rules (zones cut, 500 m trimmed — at *both* ends of every
 * segment, so the newest point is never the exact current position), derived
 * at the same moments `track.json` is (`deriveTripTrack`, `lib/gps/api.ts`).
 * Read by nobody but `readerTrack` below, which is the same single door
 * `track.json` itself has.
 */
function tailFile(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "track-recent.json");
}

function readTrackFile(file: string): Track | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
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

function writeTrackFile(file: string, track: Track): void {
  fs.writeFileSync(file, `${JSON.stringify(track)}\n`, "utf8");
}

function deleteTrackFile(file: string): void {
  fs.rmSync(file, { force: true });
}

/** The trip's line, or undefined. A trip with no track is the normal case and
 * renders exactly as it did before this existed. */
export function readTrack(username: string, tripId: string): Track | undefined {
  return readTrackFile(trackFile(username, tripId));
}

export function writeTrack(username: string, tripId: string, track: Track): void {
  writeTrackFile(trackFile(username, tripId), track);
}

/** Remove a trip's line file entirely — B2202, when derivation comes back
 * with nothing (the store has no fixes left for this trip's dates, or every
 * one of them was trimmed away). Replaces the old "leave a stale file alone"
 * answer: a track that no longer has anything behind it must not keep
 * drawing what it drew last time. */
export function deleteTrack(username: string, tripId: string): void {
  deleteTrackFile(trackFile(username, tripId));
}

/** The tail, or undefined — same "absent is normal" shape as `readTrack`. */
export function readTail(username: string, tripId: string): Track | undefined {
  return readTrackFile(tailFile(username, tripId));
}

export function writeTail(username: string, tripId: string, track: Track): void {
  writeTrackFile(tailFile(username, tripId), track);
}

/** Same reasoning as `deleteTrack`: nothing left in the last 24h deletes the
 * file rather than leaving a stale dot behind. */
export function deleteTail(username: string, tripId: string): void {
  deleteTrackFile(tailFile(username, tripId));
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
 *
 * `live` (B2536) adds the tail file's own segments, filtered the same way —
 * **the one place that decides whether this particular viewer may see where
 * the owner was less than 24h ago.** Every caller resolves it from
 * `lib/tripGate.ts`'s `mayReadLiveTrack` (owner always, a named guest unless
 * the trip's own `guestsLive` says otherwise, a public reader or the
 * operator reading somebody else's journal never) and nowhere else — this
 * function trusts whatever its caller sends, the same way it already trusts
 * `visibleDates`. Every caller reading `app/`, `components/` or an export is
 * a page rendered behind a browser cookie; no bearer token reaches any of
 * them (AGENTS.md: "an agent token reaches `/api/…` and never a rendered
 * page"). `track-recent.json` itself is also excluded from the sync
 * manifest (`lib/sync/manifest.ts`) and from every export
 * (`lib/exportZip.ts`), so a bearer token has no route to it even outside
 * this one.
 *
 * The tail is only merged in when it is itself still fresh — `tailIsLive`
 * below, under 24h since it was derived. Derivation only runs when
 * something imports or re-derives (`deriveTripTrack`, `lib/gps/api.ts`), so
 * a trip nobody has touched in two days would otherwise keep answering
 * "live" with a tail that has quietly aged out from under it.
 */
export function readerTrack(
  username: string,
  tripId: string,
  visibleDates: ReadonlySet<string>,
  live = false,
): Track | undefined {
  const track = readTrack(username, tripId);
  const segments = (track?.segments ?? []).filter(
    (s) => s.day !== undefined && visibleDates.has(s.day),
  );
  const tail = live ? readTail(username, tripId) : undefined;
  const tailSegments =
    tail && tailIsLive(tail)
      ? tail.segments.filter((s) => s.day !== undefined && visibleDates.has(s.day))
      : [];
  const all = [...segments, ...tailSegments];
  if (all.length === 0) return undefined;
  return { generated: track?.generated ?? tail?.generated ?? "", segments: all };
}

/**
 * "Here now" copy for the map page — B2536. Reports a minute count only when
 * the tail is both fresh (`tailIsLive`) and actually has something to show
 * *this* reader once `visibleDates` narrows it — the same two conditions
 * `readerTrack`'s own `live` branch above checks, asked here so a caller can
 * draw the dot and the "updated N min ago" copy from the same filtered
 * answer rather than a raw, unfiltered `readTail()` that might belong to a
 * day this reader cannot see, or might be two days stale (never a live "4000
 * min ago").
 */
export function liveTailStatus(
  username: string,
  tripId: string,
  visibleDates: ReadonlySet<string>,
): { minutesAgo: number } | undefined {
  const tail = readTail(username, tripId);
  if (!tail || !tailIsLive(tail)) return undefined;
  const visible = tail.segments.some((s) => s.day !== undefined && visibleDates.has(s.day));
  if (!visible) return undefined;
  return { minutesAgo: minutesSinceGenerated(tail) };
}

/** Longer than this since a tail was derived, and it no longer represents
 * "the last 24h" — it represents whatever the store happened to hold the
 * last time something re-derived it, which is a different and staler claim.
 * Mirrors `MIN_AGE_MS` in `lib/gps/api.ts`: the tail's own promise is never
 * to be older than this. */
const TAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function tailIsLive(tail: Track): boolean {
  const generated = Date.parse(tail.generated);
  if (Number.isNaN(generated)) return false;
  return Date.now() - generated < TAIL_MAX_AGE_MS;
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

/**
 * How long ago a `Track` file was derived, in whole minutes — the map
 * page's own "updated N min ago" copy for the live tail (B2536). A plain
 * function rather than inline `Date.now()` in a page component's render
 * body, which the React Compiler's impure-call check refuses.
 */
function minutesSinceGenerated(track: Track): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(track.generated)) / 60_000));
}
