import fs from "node:fs";
import path from "node:path";
import { gpsDir, metresBetween, readRange } from "./store";
import { zonedTimeToUtc } from "../timezone";
import type { Track, TrackSegment } from "./track";
import type { Fix } from "../../importers/gps/schema";

/**
 * Turning the private store into one trip's line — B665, reworked by B2202.
 *
 * Five things happen here, and four of them are about what does *not* come
 * out:
 *
 * 1. **Clipped to the trip's dates.** Nothing before the first day, nothing
 *    after the last. Everything outside is the rest of somebody's life. Every
 *    date gets its own window, local midnight to local midnight in that
 *    date's own day's `timezone` (UTC when none is written) — a run is broken
 *    at each boundary and the resulting segment is tagged with its date
 *    (`TrackSegment.day`). This derivation no longer knows or cares which
 *    dates are published; that is enforced only where the line is served
 *    (`readerTrack` in `./track.ts`).
 * 2. **Private zones removed.** A radius around home, around work — the
 *    points inside are dropped *and the run is broken there*, not merely
 *    joined across by the gap rule.
 * 3. **Broken at gaps.** More than two hours with no fix is a hole in the
 *    data, and a hole is drawn as a break. Joining it would be drawing a
 *    straight line through a flight and calling it a route.
 * 4. **Trimmed by straight-line distance**, not path length — see
 *    `trimByDistance` below for why path length was defeated by jitter.
 * 5. **Simplified**, so what is left is a few thousand points rather than
 *    forty thousand, and small enough to ship in a page's props.
 *
 * Like `store.ts`, nothing under `app/` may import this.
 */

/** Longer than this with no fix and the line is cut. Two hours is a long
 * lunch indoors, a train through the Alps with no signal, or a short flight —
 * all three of which are better drawn as a gap than as a straight line. */
const GAP_SECONDS = 2 * 60 * 60;

/** Douglas–Peucker tolerance. Fifty metres keeps the shape of a road and
 * throws away the shape of a lane change. */
const SIMPLIFY_METRES = 50;

const PLACES = 5;

/**
 * A place that is never drawn — `content/<user>/gps/exclude.json`.
 *
 * **Deliberately not in the journal's `config.json`**, which
 * `appendUserContent` puts into every export, including the one an anonymous
 * visitor can download. A home address written there to keep it off the map
 * would have been published by the very act of hiding it. It lives in `gps/`
 * instead, which is in no export and behind no route.
 *
 * ```json
 * [{ "label": "home", "lat": 47.38564, "lon": 8.21819, "radiusM": 500 }]
 * ```
 *
 * Written from `GET`/`PUT /api/v2/<user>/gps/zones` since B2203 — the
 * "a shell only" era this comment used to describe a hosted owner could
 * never reach. Any saved zone, whatever its label, is what this repository's
 * recorder arms against — see `hasHomeZoneOrDeclined` below.
 */
export type ExcludeZone = { label?: string; lat: number; lon: number; radiusM: number };

export function excludeFile(username: string): string {
  return path.join(gpsDir(username), "exclude.json");
}

/** Fails closed on a broken file: an unreadable exclusion list means every
 * zone is missing, and that is somebody's front door on a map. */
export function readExcludeZones(username: string): ExcludeZone[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(excludeFile(username), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `${excludeFile(username)} is unreadable — refusing to derive a track without it`,
    );
  }
  if (!Array.isArray(raw)) throw new Error(`${excludeFile(username)} must be a JSON array`);
  return raw.map((zone, index) => {
    const z = zone as Partial<ExcludeZone>;
    if (
      !Number.isFinite(z.lat) ||
      !Number.isFinite(z.lon) ||
      !Number.isFinite(z.radiusM) ||
      (z.radiusM as number) <= 0
    )
      throw new Error(
        `${excludeFile(username)}[${index}] needs lat, lon and a positive radiusM`,
      );
    return z as ExcludeZone;
  });
}

/** Whether a fix falls inside any private zone — exported so `./api.ts`'s
 * `placeForDay` (B2200) can apply the same rule to a single day's fixes
 * without a second copy of the radius check. */
export function isExcluded(fix: Fix, zones: ExcludeZone[]): boolean {
  return zones.some(
    (zone) => metresBetween(fix, { t: 0, lat: zone.lat, lon: zone.lon }) <= zone.radiusM,
  );
}

/**
 * Write the zone list — B2203. The only writer of `exclude.json`; before
 * this the file was documented as something only a shell could create, which
 * a hosted owner cannot reach. The shape on disk does not change — still the
 * plain array the module doc above shows — so a file somebody edited by hand
 * before this shipped still reads back exactly as it did.
 */
export function writeExcludeZones(username: string, zones: ExcludeZone[]): void {
  fs.mkdirSync(gpsDir(username), { recursive: true });
  writeFileAtomic(excludeFile(username), JSON.stringify(zones, null, 2));
}

/**
 * Whether the owner has explicitly said "no home zone, and I know what that
 * means" — B2203's arming support for B2196/B2198's recorder, which needs to
 * refuse to start until it has one answer or the other. A sibling file next
 * to `exclude.json` rather than a field inside it: the array on disk is the
 * documented public shape of that file (see the module doc above), and a
 * decline is a different fact — not a place, nothing to draw — recorded
 * beside it instead of folded into the same document.
 */
function homeDeclinedFile(username: string): string {
  return path.join(gpsDir(username), "home-declined.json");
}

/** Fails closed the same way `readExcludeZones` does: an unreadable file
 * reads as "not declined", so the recorder still refuses to arm rather than
 * guessing consent from a file it could not parse. */
export function readHomeDeclined(username: string): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(homeDeclinedFile(username), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`${homeDeclinedFile(username)} is unreadable`);
  }
  return (raw as { declined?: unknown } | null)?.declined === true;
}

export function writeHomeDeclined(username: string, declined: boolean): void {
  fs.mkdirSync(gpsDir(username), { recursive: true });
  writeFileAtomic(homeDeclinedFile(username), JSON.stringify({ declined }));
}

/** Written whole and renamed, the same as `store.ts`'s `writeMonth`: a
 * reader (`readExcludeZones`/`readHomeDeclined`) must never see a half-written
 * file from a write that was interrupted partway through. */
function writeFileAtomic(target: string, body: string): void {
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, body, "utf8");
  fs.renameSync(temporary, target);
}

/**
 * The one question a recording flow needs answered before it may start —
 * B2203, arming support for B2196/B2198/B2201's App Store gate. `true` means
 * either the owner has saved at least one zone — in whatever language they
 * name it — to clip their front door out
 * of every future track, or they have said outright that they do not want
 * one. `false` means recording must stay off: neither answer has been given
 * yet.
 */
export function hasHomeZoneOrDeclined(username: string): boolean {
  if (readHomeDeclined(username)) return true;
  return readExcludeZones(username).length > 0;
}

/**
 * Douglas–Peucker, in metres.
 *
 * Distances are computed in a local flat projection — metres east and north of
 * the run's first point, with longitude scaled by cos(latitude) — which is
 * exact enough over the few hundred kilometres a segment covers and avoids a
 * haversine per candidate point.
 */
function simplify(points: Fix[], toleranceM: number): Fix[] {
  if (points.length < 3) return points;
  const lat0 = (points[0].lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos(lat0);
  const x = points.map((p) => p.lon * mPerDegLon);
  const y = points.map((p) => p.lat * mPerDegLat);

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  // Iterative, not recursive: a run of forty thousand points is a stack
  // overflow waiting for the one import nobody tested with.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last <= first + 1) continue;
    const dx = x[last] - x[first];
    const dy = y[last] - y[first];
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const distance =
        length === 0
          ? Math.hypot(x[i] - x[first], y[i] - y[first])
          : Math.abs(dy * (x[i] - x[first]) - dx * (y[i] - y[first])) / length;
      if (distance > worst) {
        worst = distance;
        worstIndex = i;
      }
    }
    if (worst > toleranceM && worstIndex > 0) {
      keep[worstIndex] = true;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n: number): number => Number(n.toFixed(PLACES));

export type DeriveOptions = {
  /** ISO date, inclusive. The trip's first day. */
  start: string;
  /** ISO date, inclusive. The trip's last day. */
  end: string;
  zones?: ExcludeZone[];
  gapSeconds?: number;
  toleranceM?: number;
  /** No fix later than this reaches the line, whatever `end` says — B2202,
   *  so a reader is never shown where the owner is right now. Opt-in: only
   *  the reader-facing derivation (`deriveTripTrack`) passes it. */
  maxEndMs?: number;
  /** Straight-line metres cut off both ends of every segment (B2202 rework)
   *  — see `trimByDistance` below. Opt-in, same reason as `maxEndMs`. */
  trimMetres?: number;
  /** The IANA zone each trip date's local midnight is measured in, keyed by
   *  `date`. A date absent from this map is bounded in UTC — B2202 rework:
   *  every trip date (drafts included) gets its own window, and a run is
   *  broken whenever a fix crosses into the next date's window, so each
   *  segment belongs to exactly one date and is tagged with it
   *  (`TrackSegment.day`). Absent entirely ⇒ every date is bounded in UTC,
   *  which is what the pure tests below exercise. */
  dayTimezones?: Readonly<Record<string, string>>;
};

/** One calendar day later, as a date string — timezone-agnostic, this is
 * just the label, not an instant. */
function nextDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every date from `start` to `end`, inclusive. */
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = start; d <= end; d = nextDate(d)) dates.push(d);
  return dates;
}

type DateWindow = { date: string; from: number; to: number };

/** One local-midnight-to-local-midnight window per trip date — B2202 rework.
 * `tz` is the date's own day's `timezone`, when one was written, else UTC. */
function windowsFor(start: string, end: string, dayTimezones: Readonly<Record<string, string>>): DateWindow[] {
  return datesBetween(start, end).map((date) => {
    const tz = dayTimezones[date] ?? "UTC";
    return {
      date,
      from: zonedTimeToUtc(date, "00:00", tz).getTime(),
      to: zonedTimeToUtc(nextDate(date), "00:00", tz).getTime(),
    };
  });
}

/** Which trip date's window `t` falls in, or `undefined` when it is outside
 * every one of them (before the trip, after it, or in a gap this rework does
 * not expect between adjoining local-midnight windows). */
function dateOf(t: number, windows: DateWindow[]): string | undefined {
  return windows.find((w) => t >= w.from && t < w.to)?.date;
}

/** Drop every point within `metres` of straight-line (haversine) distance of
 * the run's *original* first or last point, breaking the run where they fall
 * — B2202 rework. Path-length trimming was
 * defeated by GPS jitter: hours of a phone wobbling ±15 m on a nightstand
 * accumulate hundreds of metres of path length without the owner having
 * moved at all, so the trim ran straight past the hotel and into the real
 * walk beyond it. Straight-line distance from a fixed anchor does not accrue
 * that way — jitter around one spot never reaches 500 m no matter how long it
 * runs. A run left with nothing on one side collapses to nothing, same as a
 * lone fix. */
function trimByDistance<T extends Fix>(points: T[], metres: number): T[][] {
  if (metres <= 0 || points.length < 2) return [points];
  // Both ends are where somebody likely slept, so they act as short-lived
  // private zones for the whole run: a day that walks back past the hotel
  // door at noon must not draw it either (second B2202 review). Every point
  // within `metres` of either end is dropped and the run breaks there.
  const first = points[0];
  const last = points[points.length - 1];
  const pieces: T[][] = [];
  let piece: T[] = [];
  for (const p of points) {
    if (metresBetween(first, p) < metres || metresBetween(last, p) < metres) {
      if (piece.length) pieces.push(piece);
      piece = [];
    } else piece.push(p);
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

/**
 * Fixes in, a trip's track out. Pure — it reads nothing and writes nothing, so
 * every rule above is testable without a journal on disk.
 *
 * B2202 rework: every trip date gets its own local-midnight window (UTC when
 * no day of that date carries a `timezone`), a run is broken whenever a fix
 * crosses into the next window, and every segment is tagged with the date its
 * window belongs to (`TrackSegment.day`) — the field `readerTrack`
 * (`./track.ts`) filters on. A private zone now also breaks a run: skipping an
 * excluded fix starts a fresh one rather than letting the gap rule silently
 * bridge across somebody's front door.
 */
export function deriveTrack(fixes: Fix[], options: DeriveOptions): Track {
  const windows = windowsFor(options.start, options.end, options.dayTimezones ?? {});
  const maxEndMs = options.maxEndMs ?? Number.POSITIVE_INFINITY;
  const zones = options.zones ?? [];
  const gap = (options.gapSeconds ?? GAP_SECONDS) * 1000;
  const tolerance = options.toleranceM ?? SIMPLIFY_METRES;

  const sorted = [...fixes].sort((a, b) => a.t - b.t);

  const runs: TrackedFix[][] = [];
  let current: TrackedFix[] = [];
  const closeRun = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const fix of sorted) {
    if (fix.t > maxEndMs) {
      closeRun();
      continue;
    }
    const date = dateOf(fix.t, windows);
    if (date === undefined || isExcluded(fix, zones)) {
      closeRun();
      continue;
    }
    const last = current[current.length - 1];
    if (last && fix.t - last.t <= gap && last.date === date) current.push({ ...fix, date });
    else {
      closeRun();
      current = [{ ...fix, date }];
    }
  }
  closeRun();

  const segments: TrackSegment[] = [];
  for (const run of runs) {
    // A lone fix is a dot, and every dot on these maps is a day or a
    // photograph — something somebody wrote. One stray position is not that.
    if (run.length < 2) continue;
    const pieces = options.trimMetres ? trimByDistance(run, options.trimMetres) : [run];
    for (const trimmed of pieces) {
      if (trimmed.length < 2) continue;
      const kept = simplify(trimmed, tolerance);
      segments.push({
        from: new Date(trimmed[0].t).toISOString(),
        day: run[0].date,
        points: kept.map((p) => [round(p.lat), round(p.lon)] as [number, number]),
      });
    }
  }

  return { generated: new Date().toISOString(), segments };
}

type TrackedFix = Fix & { date: string };

/** Derive one trip's track from the store on disk. */
export function trackForTrip(
  username: string,
  options: DeriveOptions,
): Track {
  const windows = windowsFor(options.start, options.end, options.dayTimezones ?? {});
  const from = Math.min(...windows.map((w) => w.from));
  const to = Math.max(...windows.map((w) => w.to));
  return deriveTrack(readRange(username, from, to), {
    ...options,
    zones: options.zones ?? readExcludeZones(username),
  });
}
