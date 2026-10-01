import { kmBetween, type Point } from "../mapFrame";

/**
 * The rules every trip map follows — B2534.
 *
 * `docs/plans/2026-09-28-trip-maps/README.md` ("Rules every map follows") is
 * the spec this ports, and `prototype-reader.html` in the same folder is a
 * working sketch of it in plain JS. This module is the pure, tested version
 * every map (today's drawn SVG maps, and the street maps B2535 adds later)
 * shares, so the two can never disagree about which places frame a trip,
 * which places are chips instead, or which lines are drawn.
 *
 * Nothing here touches the GPS store, a file, or a request — a caller
 * resolves dates to day numbers, town names and (where it can) the home
 * flag, and hands over plain data. See `buildTripFrame`'s own doc for why
 * `home` is the one thing most callers cannot fill in honestly yet.
 */

/** One day's place, already resolved to a town-level name and a day number
 * — never a stop index, so a name repeated across a merged run of days
 * still reads as the day it was. */
export type MapPlace = {
  /** 1-based, the trip's own day number — `index.findIndex(...) + 1` in
   * `lib/tripView.ts` terms, never a position within a deduplicated list of
   * stops. */
  day: number;
  date: string;
  lat: number;
  lng: number;
  /** Town-level ("Bangkok"), not a hotel or district — resolved by the
   * caller. Overridden to "Home" below when `home` is true, whatever this
   * says: a home-zone place is never named by its own name in any output. */
  name: string;
  /** Whether this place falls inside the owner's home zone. Only a caller
   * holding an owner-cookie-gated read of `content/<user>/gps/exclude.json`
   * (`lib/gps/enrich.ts`'s `readExcludeZones`) can answer this honestly for
   * a real trip; no reader-facing page in this repository holds that read
   * today; see the ticket's task file for what B2534 chose instead of
   * guessing. */
  home?: boolean;
};

/** One run of recorded positions for a single day, already reader-filtered
 * (`readerTrack`, `lib/gps/track.ts`) — this module never reads the GPS
 * store itself. `gap: true` marks a piece `lib/gps/enrich.ts` (or an
 * equivalent caller) already knows is a bridge across missing fixes rather
 * than a real run — for this module the same "> 10 min and > 600 m" gap
 * rule the spec names is the caller's to apply before handing a segment
 * over, since only the caller has the raw fix timestamps. */
export type RecordedSegment = {
  /** The day number (see `MapPlace.day`) this run belongs to. */
  day: number;
  points: Point[];
  gap?: boolean;
};

type Region = {
  places: MapPlace[];
  /** Distinct day count across these places — what decides the main region
   * and the day count on a region chip. */
  days: number;
  /** Every place in this region is a home place. A region like this is
   * never counted toward "more than three regions ⇒ a tour" and never
   * becomes an "other region" chip — `home` chips speak for it instead. */
  home: boolean;
};

// B2639 — no longer exported: the card (`lib/map/cardSvg.ts`) stopped
// drawing region chips on the preview, and nothing else outside this module
// ever consumed `TripFrame.chips`'s own element type by name.
type Chip = {
  kind: "far" | "region";
  /** The place a "far" chip names, or an "region" chip's first place. */
  place: MapPlace;
  /** Compass bearing in degrees (0 = north, clockwise) from the framed
   * area's centre to this chip's place — what points its arrow. */
  bearingDeg: number;
  label: string;
  /** Region chips only: the region's own distinct day count. */
  days?: number;
};

export type MapLine = {
  kind: "recorded" | "gap" | "photo-join" | "flight";
  fromDay: number;
  toDay: number;
  /** Ordered points to draw. A `flight` is already a great-circle arc, dense
   * enough to draw straight-segmented; every other kind is exactly what the
   * caller handed in. */
  coords: Point[];
  /** `photo-join` only: how many times this unordered place pair repeats —
   * the same boat trip drawn once, with a count, rather than once per
   * repeat. */
  count?: number;
  /** `flight` only: never drawn on a single day's own view — the spec's
   * "for overviews only". `linesForDay` already leaves these out; this is
   * for a caller building its own selection instead. */
  overviewOnly?: boolean;
};

export type TripFrame = {
  regions: Region[];
  mainRegionIndex: number;
  /** More than three regions with at least one non-home place ⇒ the whole
   * trip is shown, not just the main region. */
  isTour: boolean;
  /** The places the frame itself should be fit to — feed these into
   * `frameRoute` (`lib/mapFrame.ts`) for the actual projected `Frame`; this
   * module does not duplicate that geometry. */
  framePlaces: MapPlace[];
  chips: Chip[];
  lines: MapLine[];
};

/** Two places closer than this are the same region (single-linkage). */
const REGION_KM = 300;

/** A leg longer than this, or crossing a region boundary, is a flight. */
const FLIGHT_KM = 600;

export type BuildOptions = {
  /** Selects only the trip's photo-only join behaviour even when a recorded
   * segment happens to be passed — never needed by a real caller, only by a
   * test that wants to force the branch. Defaults to `recorded.length > 0`. */
  tracked?: boolean;
};

/**
 * The frame, chips and lines a trip's map draws — the pure heart of B2534.
 *
 * Every rule below is named in `docs/plans/2026-09-28-trip-maps/README.md`
 * ("Rules every map follows"); each block here says which one it is.
 */
export function buildTripFrame(
  places: readonly MapPlace[],
  recorded: readonly RecordedSegment[] = [],
  opts: BuildOptions = {},
): TripFrame {
  // A trip with no plottable places (nothing written yet, or a planned trip
  // with only a route) has no region to be "main" — `pickMainRegion` would
  // otherwise read `regions[0]` off an empty array. Every caller (a day
  // list, a chip row) reads an empty result the same way it already reads
  // "no places": nothing to draw.
  if (places.length === 0) {
    return { regions: [], mainRegionIndex: 0, isTour: false, framePlaces: [], chips: [], lines: [] };
  }

  // "Anything inside the home zone reads Home in every list, strip, chip and
  // card" — enforced once, here, so nothing downstream can leak a home
  // place's real name by forgetting to check the flag.
  const all = places.map((p) => (p.home ? { ...p, name: "Home" } : p));

  const regions = clusterRegions(all);
  const mainRegionIndex = pickMainRegion(regions);
  const mainRegion = regions[mainRegionIndex];
  const nonHomeRegions = regions.filter((r) => !r.home);
  const isTour = nonHomeRegions.length > 3;

  const framePlaces = isTour ? all.filter((p) => !p.home) : mainRegion.places;
  const inFrame = new Set(framePlaces.map(placeId));

  const otherRegions = isTour
    ? []
    : regions.filter((r, i) => i !== mainRegionIndex && !r.home);
  const otherRegionPlaceIds = new Set(otherRegions.flatMap((r) => r.places.map(placeId)));
  const farPlaces = all.filter((p) => !inFrame.has(placeId(p)) && !otherRegionPlaceIds.has(placeId(p)));

  const centre = centroid(framePlaces.length > 0 ? framePlaces : all);
  const chips: Chip[] = [
    ...farPlaces.map((place) => ({
      kind: "far" as const,
      place,
      bearingDeg: bearing(centre, place),
      label: place.name,
    })),
    ...otherRegions.map((region) => ({
      kind: "region" as const,
      place: region.places[0],
      bearingDeg: bearing(centre, region.places[0]),
      label: region.places[0].name,
      days: region.days,
    })),
  ];

  const regionOf = regionFinder(regions);
  const tracked = opts.tracked ?? recorded.length > 0;
  const rawLines = tracked ? recordedLines(recorded) : photoJoinLines(all);
  const withFlights = rawLines.map((line) => toFlightIfFar(line, regionOf));
  // A recording rarely spans the flight itself (B2618): on a tracked trip the
  // joins between days still draw, but only the ones far enough to be flights.
  if (tracked) {
    withFlights.push(
      ...photoJoinLines(all).map((line) => toFlightIfFar(line, regionOf)).filter((line) => line.kind === "flight"),
    );
  }
  // "Legs that leave the region shown are not drawn inside it; the chip
  // stands for them" — a single-region view only, never a tour.
  const lines = isTour ? withFlights : withFlights.filter((line) => bothEndsIn(line, regionOf, mainRegionIndex));

  return { regions, mainRegionIndex, isTour, framePlaces, chips, lines };
}

/** A `MapPlace`'s identity for set membership — day number is unique per
 * trip and cheaper than comparing floats. */
function placeId(place: MapPlace): number {
  return place.day;
}

/** Single-linkage clustering: two places closer than `REGION_KM` join the
 * same region, transitively. Order of `regions` follows first appearance in
 * `places`, so a tie in `pickMainRegion` favours the place visited first. */
function clusterRegions(places: readonly MapPlace[]): Region[] {
  const groups: MapPlace[][] = [];
  for (const place of places) {
    const hit = groups.find((g) => g.some((o) => kmBetween(o, place) < REGION_KM));
    if (hit) hit.push(place);
    else groups.push([place]);
  }
  return groups.map((placesInGroup) => ({
    places: placesInGroup,
    days: new Set(placesInGroup.map((p) => p.day)).size,
    home: placesInGroup.every((p) => p.home === true),
  }));
}

/** "Show the region with the most days" — ties keep the first region in
 * trip order. */
function pickMainRegion(regions: readonly Region[]): number {
  let best = 0;
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].days > regions[best].days) best = i;
  }
  return best;
}

function centroid(points: readonly Point[]): Point {
  if (points.length === 0) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

/** Forward compass bearing from `from` to `to`, in degrees, 0–360. */
function bearing(from: Point, to: Point): number {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + (Math.atan2(y, x) < 0 ? 360 : 0);
}

/** Nearest region to a point — "closer than `REGION_KM`" to any of that
 * region's own places, same rule `clusterRegions` used to build them. `-1`
 * for a point nowhere near any region (a mid-flight arc point, say). */
function regionFinder(regions: readonly Region[]) {
  return (point: Point): number => {
    let best = -1;
    let bestKm = Infinity;
    regions.forEach((region, i) => {
      for (const place of region.places) {
        const km = kmBetween(place, point);
        if (km < REGION_KM && km < bestKm) {
          best = i;
          bestKm = km;
        }
      }
    });
    return best;
  };
}

function bothEndsIn(line: MapLine, regionOf: (p: Point) => number, regionIndex: number): boolean {
  const a = line.coords[0];
  const b = line.coords[line.coords.length - 1];
  return regionOf(a) === regionIndex && regionOf(b) === regionIndex;
}

/** Recorded segments, split at gaps — the caller already knows which pieces
 * are real runs and which are dashed bridges (`RecordedSegment.gap`). */
function recordedLines(recorded: readonly RecordedSegment[]): MapLine[] {
  return recorded
    .filter((s) => s.points.length >= 2)
    .map((s) => ({
      kind: s.gap ? ("gap" as const) : ("recorded" as const),
      fromDay: s.day,
      toDay: s.day,
      coords: s.points,
    }));
}

/**
 * "Photo-only joins: thin straight dashed lines between places in order; the
 * same pair of places is drawn once." Consecutive home-to-home hops are
 * dropped — home never draws a line to itself.
 */
function photoJoinLines(places: readonly MapPlace[]): MapLine[] {
  const byPair = new Map<string, MapLine>();
  const order: string[] = [];
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1];
    const b = places[i];
    if (a.home && b.home) continue;
    if (kmBetween(a, b) < 0.05) continue; // the same place written twice
    const key = [a.day, b.day].sort((x, y) => x - y).join("|");
    const existing = byPair.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    const line: MapLine = { kind: "photo-join", fromDay: a.day, toDay: b.day, coords: [a, b], count: 1 };
    byPair.set(key, line);
    order.push(key);
  }
  return order.map((key) => byPair.get(key) as MapLine);
}

/**
 * "Flights (> 600 km, or between regions) are dotted great-circle arcs on
 * overviews only." A line whose own two endpoints already qualify becomes a
 * `flight`; everything else is returned unchanged.
 */
function toFlightIfFar(line: MapLine, regionOf: (p: Point) => number): MapLine {
  const a = line.coords[0];
  const b = line.coords[line.coords.length - 1];
  const far = kmBetween(a, b) > FLIGHT_KM || regionOf(a) !== regionOf(b);
  if (!far) return line;
  return {
    kind: "flight",
    fromDay: line.fromDay,
    toDay: line.toDay,
    coords: greatCircleArc(a, b),
    overviewOnly: true,
  };
}

/** A great-circle path from `a` to `b`, as a polyline dense enough to draw
 * straight-segmented. Ported from the reader prototype's `arc()`. */
export function greatCircleArc(a: Point, b: Point, steps = 32): Point[] {
  const rad = Math.PI / 180;
  const [lat1, lng1, lat2, lng2] = [a.lat * rad, a.lng * rad, b.lat * rad, b.lng * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: Point[] = [];
  let prevLng: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    let lng = Math.atan2(y, x) / rad;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / rad;
    // Keep the unwound line continuous rather than snapping across ±180°
    // mid-arc, the same reasoning `lib/mapFrame.ts`'s `unwrap` documents.
    if (prevLng !== null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    out.push({ lat, lng });
  }
  return out;
}

/**
 * A day's own lines — "per-day selection: that day's lines/places; a
 * photo-only day shows only its own joins." Flights are always left out: the
 * spec draws them "on overviews only".
 */
export function linesForDay(frame: TripFrame, day: number): MapLine[] {
  return frame.lines.filter((line) => line.kind !== "flight" && (line.fromDay === day || line.toDay === day));
}

/**
 * The points a route's frame should be fit to — "fit the places where days
 * happened, never the recorded line, never home." A thin adapter over
 * `buildTripFrame` for a call site that only has raw points, in trip order,
 * and no day numbers, names or home flags to give it: `home` is never known
 * here (see `MapPlace.home`'s own doc), so this can only apply the region
 * rule — drop a point that isn't in the main region, unless the trip is a
 * tour, in which case every point stays. Both `WorldMap` and the server
 * basemap clip it frames against (`lib/basemap.ts`'s `basemapForRoute`) call
 * this on the same array, so the two keep agreeing the way they always have.
 */
export function framePoints<P extends Point>(points: readonly P[]): P[] {
  if (points.length === 0) return [];
  const asPlaces: MapPlace[] = points.map((p, i) => ({ day: i + 1, date: "", lat: p.lat, lng: p.lng, name: "" }));
  const inFrame = new Set(buildTripFrame(asPlaces).framePlaces.map((p) => p.day));
  return points.filter((_, i) => inFrame.has(i + 1));
}

/** A day's own places — every place whose day matches, which is at most one
 * for a trip without same-day multi-stop entries and the whole point of
 * keeping `day` rather than a stop index: a place merged into a wider stop
 * still answers "is this day's place" correctly. */
export function placesForDay(frame: TripFrame, day: number): MapPlace[] {
  return frame.framePlaces.filter((p) => p.day === day);
}
