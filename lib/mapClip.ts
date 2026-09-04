/**
 * Cutting a baked path down to the box a map actually shows.
 *
 * `lib/basemap.ts` selects shapes by bounding box: a shape whose box overlaps
 * the frame travels to the browser *whole*. That is fine for an islet and
 * ruinous for a country — B177 measured `alps-2024`, four stops inside 68 km,
 * at 518,867 bytes of basemap, most of it one Swiss polygon and one Italian
 * one drawn a thousand kilometres past the edge of a frame a hundred
 * kilometres wide. The reader downloads Sicily to look at the Grimsel.
 *
 * So the geometry is cut to the box here, on the server, before it is
 * serialised. Two shapes of cut, because the layers are two shapes of thing:
 *
 * - **Polygons** — countries, lakes, ice, relief, parks — are clipped with
 *   Sutherland–Hodgman, which returns a *closed* polygon that follows the box
 *   wherever the original ran outside it. That matters because these are
 *   filled: land is the fill of a country polygon, so a cut that left the ring
 *   open would paint the sea green.
 * - **Lines** — rivers, roads, railways, internal boundaries — are cut
 *   segment by segment (Liang–Barsky) and come back as one subpath per run
 *   that was inside. Nothing is closed and nothing is joined across a gap: a
 *   river that leaves the box and returns is two strokes, which is what it
 *   looks like anyway.
 *
 * **The artificial edges are the price, and the pad is what pays it.** A
 * clipped country is stroked along the box as if the border ran there. Those
 * edges sit on the *padded* box (`lib/basemap.ts`), never on the frame, so
 * they are outside what any zoom shows and only a reader who drags the map a
 * long way off its own trip meets them — where, before this, they met shapes
 * that simply stopped. Widen the pad and they retreat; remove it and they are
 * on screen.
 *
 * Nothing here is lossy about position: coordinates keep the two decimals the
 * bake gives them (`scripts/build-mapdata.mjs`, a 400 m grid), which at any
 * frame close enough to be clipped is finer than a pixel. Trailing zeros are
 * dropped, because `12.30` and `12.3` are the same place and one is a byte
 * cheaper.
 */

/** The box to cut to, in the bundle's own uncorrected projected units. */
export type ClipBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * A coordinate as the shortest text that still means it.
 *
 * The bake writes `toFixed(2)` unconditionally, so a point on a round
 * kilometre carries two zeros nobody needs. Same grid, fewer bytes.
 */
function fmt(value: number): string {
  const text = value.toFixed(2);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * The subpaths of a baked path, as flat `[x, y, x, y, …]` runs.
 *
 * Returns null for anything that is not the `M… L… [Z]` the bake writes — an
 * unparseable shape is shipped whole rather than dropped, because a basemap
 * missing a country is a worse failure than one carrying too much of it.
 */
export function parsePath(d: string): number[][] | null {
  const runs: number[][] = [];
  for (const part of d.split("M")) {
    const body = part.trim();
    if (!body) continue;
    const points: number[] = [];
    for (const token of (body.endsWith("Z") ? body.slice(0, -1) : body).split("L")) {
      const pair = token.trim();
      if (!pair) continue;
      const comma = pair.indexOf(",");
      if (comma < 0) return null;
      const x = Number(pair.slice(0, comma));
      const y = Number(pair.slice(comma + 1));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      points.push(x, y);
    }
    if (points.length >= 4) runs.push(points);
  }
  return runs;
}

/** One Sutherland–Hodgman pass: everything on one side of one edge. */
function halfPlane(points: number[], axis: 0 | 1, limit: number, keepAbove: boolean): number[] {
  const count = points.length / 2;
  if (count === 0) return [];
  const out: number[] = [];
  const inside = (i: number) => {
    const v = points[i * 2 + axis];
    return keepAbove ? v >= limit : v <= limit;
  };
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = points[i * 2];
    const ay = points[i * 2 + 1];
    const bx = points[j * 2];
    const by = points[j * 2 + 1];
    const ai = inside(i);
    const bi = inside(j);
    if (ai) out.push(ax, ay);
    if (ai !== bi) {
      const a = axis === 0 ? ax : ay;
      const b = axis === 0 ? bx : by;
      // a !== b whenever the two ends fall on different sides of `limit`.
      const t = (limit - a) / (b - a);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

/** One ring, cut to the box and closed along it. Empty when nothing is left. */
function clipRing(points: number[], box: ClipBox): number[] {
  let ring = halfPlane(points, 0, box.x0, true);
  ring = halfPlane(ring, 0, box.x1, false);
  ring = halfPlane(ring, 1, box.y0, true);
  ring = halfPlane(ring, 1, box.y1, false);
  return ring;
}

/** Liang–Barsky: the part of one segment inside the box, or null. */
function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: ClipBox,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, ax - box.x0],
    [dx, box.x1 - ax],
    [-dy, ay - box.y0],
    [dy, box.y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null; // parallel to this edge and outside it
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

function serialise(runs: number[][], close: boolean): string {
  const parts: string[] = [];
  for (const run of runs) {
    if (run.length < 4) continue;
    const points: string[] = [];
    for (let i = 0; i < run.length; i += 2) points.push(`${fmt(run[i])},${fmt(run[i + 1])}`);
    parts.push(`M${points.join(" L")}${close ? " Z" : ""}`);
  }
  return parts.join(" ");
}

/**
 * A baked path cut to the box, or "" when none of it is inside.
 *
 * `close` says which cut to make, and it is the same flag the bake used for
 * the layer (`scripts/build-mapdata.mjs`): a closed shape is filled and has to
 * come back closed, an open one is stroked and must not be.
 *
 * Returns the original string unchanged when the path cannot be parsed — see
 * `parsePath`.
 */
export function clipPath(d: string, box: ClipBox, close: boolean): string {
  const runs = parsePath(d);
  if (runs === null) return d;

  const out: number[][] = [];
  for (const run of runs) {
    if (close) {
      const ring = clipRing(run, box);
      if (ring.length >= 6) out.push(ring);
      continue;
    }
    let current: number[] = [];
    for (let i = 0; i + 3 < run.length; i += 2) {
      const seg = clipSegment(run[i], run[i + 1], run[i + 2], run[i + 3], box);
      if (!seg) {
        if (current.length >= 4) out.push(current);
        current = [];
        continue;
      }
      const n = current.length;
      // A new run whenever the last one left the box: the pen lifts rather
      // than drawing a chord across the gap.
      if (n === 0 || current[n - 2] !== seg[0] || current[n - 1] !== seg[1]) {
        if (n >= 4) out.push(current);
        current = [seg[0], seg[1]];
      }
      current.push(seg[2], seg[3]);
    }
    if (current.length >= 4) out.push(current);
  }
  return serialise(out, close);
}
