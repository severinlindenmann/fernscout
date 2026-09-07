import fs from "node:fs";
import path from "node:path";
import { gpsDir, metresBetween, readRange } from "./store";
import type { Track, TrackSegment } from "./track";
import type { Fix } from "../../importers/types";

/**
 * Turning the private store into one trip's line — B665.
 *
 * Four things happen here, and three of them are about what does *not* come
 * out:
 *
 * 1. **Clipped to the trip's dates.** Nothing before the first day, nothing
 *    after the last. Everything outside is the rest of somebody's life.
 * 2. **Private zones removed.** A radius around home, around work — the
 *    points inside are dropped and the line is cut there. Clipping by date
 *    does not help on the morning of day one, which starts at the front door.
 * 3. **Broken at gaps.** More than two hours with no fix is a hole in the
 *    data, and a hole is drawn as a break. Joining it would be drawing a
 *    straight line through a flight and calling it a route.
 * 4. **Simplified**, so what is left is a few thousand points rather than
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

function isExcluded(fix: Fix, zones: ExcludeZone[]): boolean {
  return zones.some(
    (zone) => metresBetween(fix, { t: 0, lat: zone.lat, lon: zone.lon }) <= zone.radiusM,
  );
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
};

/**
 * Fixes in, a trip's track out. Pure — it reads nothing and writes nothing, so
 * every rule above is testable without a journal on disk.
 *
 * ponytail: a trip's days are bounded in UTC. A trip that ended at 01:00 local
 * in Tokyo loses its last hour, which is a cheaper wrong answer than guessing
 * a timezone from a coordinate. If it ever matters, the trip's own first
 * coordinate is the place to get the offset from.
 */
export function deriveTrack(fixes: Fix[], options: DeriveOptions): Track {
  const from = Date.parse(`${options.start}T00:00:00Z`);
  const to = Date.parse(`${options.end}T23:59:59.999Z`);
  const zones = options.zones ?? [];
  const gap = (options.gapSeconds ?? GAP_SECONDS) * 1000;
  const tolerance = options.toleranceM ?? SIMPLIFY_METRES;

  const inTrip = fixes
    .filter((fix) => fix.t >= from && fix.t <= to && !isExcluded(fix, zones))
    .sort((a, b) => a.t - b.t);

  const runs: Fix[][] = [];
  for (const fix of inTrip) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && fix.t - last.t <= gap) run.push(fix);
    else runs.push([fix]);
  }

  const segments: TrackSegment[] = [];
  for (const run of runs) {
    // A lone fix is a dot, and every dot on these maps is a day or a
    // photograph — something somebody wrote. One stray position is not that.
    if (run.length < 2) continue;
    const kept = simplify(run, tolerance);
    segments.push({
      from: new Date(run[0].t).toISOString(),
      points: kept.map((p) => [round(p.lat), round(p.lon)] as [number, number]),
    });
  }

  return { generated: new Date().toISOString(), segments };
}

/** Derive one trip's track from the store on disk. */
export function trackForTrip(
  username: string,
  options: DeriveOptions,
): Track {
  const from = Date.parse(`${options.start}T00:00:00Z`);
  const to = Date.parse(`${options.end}T23:59:59.999Z`);
  return deriveTrack(readRange(username, from, to), {
    ...options,
    zones: options.zones ?? readExcludeZones(username),
  });
}
