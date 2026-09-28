// Shared antimeridian handling for the two land-outline build scripts
// (scripts/build-mapdata.mjs and scripts/build-world-map.mjs). See
// build-mapdata.mjs's `ringToShape` for the full writeup of why a ring that
// crosses the antimeridian must be unwrapped rather than cut: cutting closes
// each fragment with an arbitrary chord, which clips into a stray diagonal
// line to a frame corner (found live on /severin/trips, fixed by B2491).
//
// The fix: make the ring's longitudes continuous (add/subtract 360° at each
// jump) so it projects as one ordinary polygon, then emit two more copies
// shifted a full world-width (±360°) so a frame on either side of the seam
// finds a copy already in its own bounding box.

/**
 * A ring's own longitudes, made continuous across an antimeridian crossing
 * — or `null` when it never crosses one, so the caller's ordinary path
 * stays exactly as it was.
 */
export function unwrapLngs(ring) {
  let offset = 0;
  let prevLng = null;
  let jumped = false;
  const out = [];
  for (const [lng, lat] of ring) {
    if (prevLng !== null) {
      const delta = lng - prevLng;
      if (delta > 180) {
        offset -= 360;
        jumped = true;
      } else if (delta < -180) {
        offset += 360;
        jumped = true;
      }
    }
    prevLng = lng;
    out.push([lng + offset, lat]);
  }
  return jumped ? out : null;
}

/** The same unwrapped ring, one world-width over — the "other side" copy. */
export function shiftLng(ring, degrees) {
  return ring.map(([lng, lat]) => [lng + degrees, lat]);
}

/**
 * True when an unwrapped ring sweeps the entire longitude range instead of
 * just crossing the seam once — a ring that circles a pole (Antarctica),
 * whose "closing" edge is a degenerate, world-spanning chord with no seam
 * fix. Callers drop such a ring rather than draw it.
 */
export function fullyCircles(unwrapped) {
  return Math.abs(unwrapped[unwrapped.length - 1][0] - unwrapped[0][0]) >= 350;
}
