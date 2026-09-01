import { project, MAP_VIEWBOX } from "./mapProjection.mjs";

/**
 * Framing a route on the shared equirectangular canvas.
 *
 * `lib/mapProjection.mjs` puts the whole world in a 1000×500 box, so one
 * viewBox unit is 0.36° — about 40 km. Every map here then framed its route by
 * padding the bounding box with a *constant* 70×55 units, which is 5,600 ×
 * 4,400 km. Four days round the Alps came out drawn from Iceland to North
 * Africa (B46), and the padding was only the first of four constants that each
 * assumed a route measured in continents.
 *
 * Two ideas do the work here.
 *
 * **Padding is a fraction of the route, not a constant.** A trip is framed with
 * room around it proportional to its own size, with a floor so that a single
 * stop still gets a map rather than a point.
 *
 * **The frame is corrected for latitude, and that makes it locally isometric.**
 * Equirectangular treats a degree of longitude as a degree of latitude, but at
 * 47°N a degree of longitude is only about two thirds as far on the ground. At
 * world scale nobody notices; over one city a route that ran north-east looks
 * like it ran east. Scaling x by cos(latitude) fixes the shape — and has a
 * second effect worth stating plainly, because the rest of the file leans on
 * it: **inside a corrected frame, one unit is ~40 km along both axes.** That is
 * what lets a merge radius or a threshold be written in kilometres and simply
 * divided by `KM_PER_UNIT`, rather than needing a projection-aware distance
 * function at every call site.
 */

/** Degrees of longitude spanned by one viewBox unit. */
export const DEG_PER_UNIT = 360 / MAP_VIEWBOX.width;

/** Kilometres per degree along a meridian — the WGS84 mean, near enough. */
export const KM_PER_DEGREE = 111.32;

/**
 * Kilometres one viewBox unit spans, in a latitude-corrected frame.
 *
 * Along latitude this is exact everywhere. Along longitude it is exact only
 * once x has been multiplied by the frame's `lngScale`, which is the whole
 * point of applying it.
 */
export const KM_PER_UNIT = DEG_PER_UNIT * KM_PER_DEGREE;

export type Point = { lat: number; lng: number };

export type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * What x has been multiplied by — `cos(centre latitude)`, or 1 for a frame
   * spanning so much of the world that no single latitude represents it.
   *
   * Everything drawn into this frame must apply it: points through `place()`,
   * and pre-baked path data through a `scale(lngScale 1)` transform, because
   * that data is in uncorrected projected units.
   */
  lngScale: number;
};

/** How much of the route's own size is added as breathing room on each side. */
const PAD_FRACTION = 0.35;

/**
 * The smallest span a frame will ever show, in kilometres.
 *
 * A trip with one stop has a bounding box of zero extent, and a day spent in
 * one town has nearly one — without a floor both frame onto a single point and
 * the map is meaningless at any zoom. Eight kilometres is about the size of a
 * town and its outskirts.
 */
const MIN_SPAN_KM = 8;

/**
 * The shape a map is drawn in, width over height.
 *
 * Left to itself a bounding box can be any shape at all: the Alps trip runs
 * 68 km north to south and 23 km east to west, which as a raw frame is a map
 * three times taller than it is wide. The SVG is rendered `w-full h-auto`, so
 * the viewBox's aspect *is* the page's layout, and a column of map pushes
 * everything below it off the screen. The short axis is grown to reach this.
 */
const TARGET_ASPECT = 1.6;

/** Nothing to frame: the whole world, uncorrected. */
const WHOLE_WORLD: Frame = {
  x: 0,
  y: 0,
  w: MAP_VIEWBOX.width,
  h: MAP_VIEWBOX.height,
  lngScale: 1,
};

/** Great-circle distance in kilometres. */
export function kmBetween(a: Point, b: Point): number {
  const R = 6371;
  const p = Math.PI / 180;
  const h =
    0.5 -
    Math.cos((b.lat - a.lat) * p) / 2 +
    (Math.cos(a.lat * p) * Math.cos(b.lat * p) * (1 - Math.cos((b.lng - a.lng) * p))) / 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

/** A distance on the ground, as a length in a corrected frame's units. */
export function unitsForKm(km: number): number {
  return km / KM_PER_UNIT;
}

/** A length in a corrected frame's units, as a distance on the ground. */
export function kmForUnits(units: number): number {
  return units * KM_PER_UNIT;
}

/**
 * Where a coordinate sits inside a frame.
 *
 * The one place `lngScale` is applied to a point. Call it rather than
 * `project()` for anything drawn into a frame, or markers and coastline will
 * disagree by a third at Swiss latitudes.
 */
export function place(frame: Frame, point: Point): [number, number] {
  const [x, y] = project(point.lat, point.lng);
  return [x * frame.lngScale, y];
}

/**
 * How wide the frame is on the ground, in kilometres.
 *
 * The number the "is this too close in to draw a coastline" question is asked
 * of — see `hasUsableBasemap` in lib/mapBasemap.ts.
 */
export function frameSpanKm(frame: Frame): number {
  return kmForUnits(frame.w);
}

/**
 * The frame a set of coordinates should be drawn in.
 *
 * Empty input frames the whole world, which is what a trip with no located
 * days or stops gets.
 */
export function frameRoute(points: readonly Point[]): Frame {
  if (points.length === 0) return WHOLE_WORLD;

  // The correction is taken at the middle of the route rather than per point:
  // a frame has one horizontal scale, and over the span a single map covers the
  // error from using the centre is far smaller than the distortion it removes.
  // Clamped because cos() goes to zero at the poles and a frame of zero width
  // is not a frame; 0.2 is around 78° north or south, past which the stretch is
  // the least of the projection's problems.
  const lats = points.map((p) => p.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lngScale = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));

  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    const [x, y] = project(point.lat, point.lng);
    xs.push(x * lngScale);
    ys.push(y);
  }

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // Padding proportional to the route, off the larger axis so that a route
  // running mostly one way is not padded almost not at all across the other.
  const extent = Math.max(maxX - minX, maxY - minY);
  const pad = Math.max(extent * PAD_FRACTION, unitsForKm(MIN_SPAN_KM) / 2);
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;

  let w = maxX - minX;
  let h = maxY - minY;

  // A single stop, or several in one town: still nothing to look at without a
  // floor, because the padding above is a fraction of nearly zero.
  const floor = unitsForKm(MIN_SPAN_KM);
  if (w < floor) w = floor;
  if (h < floor) h = floor;

  // Grow the short axis to the shape the page is laid out for. Growing, never
  // cropping — every stop stays inside the frame.
  if (w / h < TARGET_ASPECT) w = h * TARGET_ASPECT;
  else h = w / TARGET_ASPECT;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // A frame wider than the world is a world map, and gets the world's own
  // uncorrected frame rather than a corrected one scrolled off its edge.
  if (w >= MAP_VIEWBOX.width * lngScale) return WHOLE_WORLD;

  return { x: cx - w / 2, y: cy - h / 2, w, h, lngScale };
}
