import { isPlottable, kmForUnits, type Frame, type Point } from "./mapFrame";

/**
 * The stops a trip's overview map draws, and the pure parts of drawing them.
 *
 * `components/TripMap.tsx` is a client component and everything here is
 * shared with the server (`lib/tripView.ts` builds one local basemap per
 * area), so the two cannot disagree about which places a trip has — which is
 * the whole reason this is a module rather than three helpers inside the
 * component. B1911.
 */

/** What a day has to carry to become a stop on the map. */
export type StopSource = {
  date: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
};

export type TripStop = StopSource & {
  /** Stable across renders and unique within a trip — a React key and the
   * identity the selection is held as. */
  key: string;
};

/**
 * How coarsely two coordinates are treated as the same place.
 *
 * A twentieth of a degree is about 5.5 km north–south: a town and its
 * outskirts, which is the granularity the local view frames at (`mapFrame`'s
 * 8 km floor). It is what collapses six days written in Bangkok into one stop
 * and what lets the server key a local basemap to an area the client can name
 * without either side sharing clustering code.
 */
export function areaKey(point: Point): string {
  return `${Math.round(point.lat * 20)},${Math.round(point.lng * 20)}`;
}

/**
 * The trip's stops, in the order they were travelled.
 *
 * Days without coordinates are not places (B265) and are dropped rather than
 * drawn at the origin. Consecutive days in one area collapse into a single
 * stop — a week in one town is one name on the map, not seven overlapping
 * markers — while a return to somewhere stayed earlier is a second stop,
 * because the route did go back.
 *
 * Only what the caller passed in: these come from the reader-filtered day
 * summaries, so a draft or private day the reader cannot see is not here to
 * influence the frame, the names or the outbound link.
 */
export function tripStops(days: readonly StopSource[]): TripStop[] {
  const stops: TripStop[] = [];
  let lastArea = "";
  for (const day of days) {
    if (!isPlottable(day)) continue;
    const area = areaKey(day);
    if (area === lastArea) continue;
    lastArea = area;
    stops.push({ ...day, key: `${day.date}-${area}` });
  }
  return stops;
}

/**
 * Where a reader is sent to look at one stop on somebody else's map.
 *
 * `search`, never `dir_action=navigate`: the reader asked to see the place,
 * not to be routed to it from wherever they are standing. Built through
 * `URLSearchParams` so a coordinate is encoded rather than concatenated.
 *
 * https://developers.google.com/maps/documentation/urls/get-started
 */
export function googleMapsHref(point: Point): string {
  const params = new URLSearchParams({
    api: "1",
    query: `${point.lat},${point.lng}`,
  });
  return `https://www.google.com/maps/search/?${params}`;
}

/** The 1-2-5 sequence a scale bar is allowed to be, in kilometres. */
const NICE_KM = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
];

/**
 * A scale bar for a frame: a round distance, and how wide to draw it.
 *
 * The distance the *viewport* covers, which is not the distance anybody
 * travelled — a straight line between two stops is a connection, not a route,
 * and this bar must never be read as measuring one.
 */
export function scaleBar(frame: Frame): { km: number; units: number } {
  // A fifth of the frame at most, and rounded *down* to the next round
  // number: rounding up put a 100 km bar across a third of the map and out
  // through the right-hand edge of it.
  const target = kmForUnits(frame.w) / 5;
  const km = [...NICE_KM].reverse().find((n) => n <= target) ?? NICE_KM[0];
  return { km, units: (km / kmForUnits(frame.w)) * frame.w };
}

/**
 * How far apart two markers must be, as a multiple of one marker's radius,
 * before they are drawn separately.
 *
 * The same rule `WorldMap` applies for the same reason: clustering is a
 * question about the drawing, not about the ground — two stops fifteen
 * kilometres apart collide on a map of Asia and are comfortably separate on a
 * map of one valley. Here it is also what keeps a two-hundred-day trip from
 * putting two hundred markers into the page's markup, which
 * `test/payload.test.tsx` measures and refuses.
 */
const MERGE_RADII = 1.9;

export type StopCluster = {
  x: number;
  y: number;
  stops: TripStop[];
};

/**
 * Stops grouped by where they land on the drawing, largest group first.
 *
 * `at` projects a stop into the current frame; `radius` is the marker's drawn
 * radius in the same units. The selected stop is never merged into a group —
 * it has to stay visible as itself, because the panel below the map is naming
 * it.
 */
export function clusterStops(
  stops: readonly TripStop[],
  at: (stop: TripStop) => [number, number],
  radius: number,
  selectedKey?: string,
): StopCluster[] {
  const apart = radius * MERGE_RADII;
  const clusters: StopCluster[] = [];
  for (const stop of stops) {
    const [x, y] = at(stop);
    if (stop.key === selectedKey) {
      clusters.push({ x, y, stops: [stop] });
      continue;
    }
    const hit = clusters.find(
      (c) => c.stops[0].key !== selectedKey && Math.hypot(c.x - x, c.y - y) < apart,
    );
    if (hit) hit.stops.push(stop);
    else clusters.push({ x, y, stops: [stop] });
  }
  return clusters;
}
