/**
 * A trip row's thumbnail on the "Your routes" overview — B2563. Only the
 * shape of the owner's own line, fitted to its bounds: no basemap, no
 * controls, nothing to tap. A full `WorldMap` squeezed into 64×48 drew its
 * zoom button over an empty frame at phone width.
 *
 * Longitude is scaled by cos(mid latitude) so a route keeps its proportions.
 * Empty `segments` (a published-route-only row) draws the frame alone.
 */
export default function TrackThumb({ segments }: { segments: [number, number][][] }) {
  const W = 64;
  const H = 48;
  const PAD = 5;
  const pts = segments.flat();
  let paths: string[] = [];
  if (pts.length > 1) {
    // Loops, not Math.min(...pts): a long trip passes the argument limit (B2226).
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of pts) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const minX = minLon * k;
    const spanX = (maxLon - minLon) * k || 1e-9;
    const spanY = maxLat - minLat || 1e-9;
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const ox = (W - spanX * scale) / 2;
    const oy = (H - spanY * scale) / 2;
    paths = segments
      .filter((s) => s.length > 1)
      .map((s) =>
        s
          .map(([lat, lon], i) => `${i ? "L" : "M"}${(ox + (lon * k - minX) * scale).toFixed(1)} ${(oy + (maxLat - lat) * scale).toFixed(1)}`)
          .join(""),
      );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-16 shrink-0 rounded-lg border border-line-quiet bg-surface-subtle" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" className="text-ink-strong" />
      ))}
    </svg>
  );
}
