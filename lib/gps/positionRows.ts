import type { TransportMode } from "@/importers/gps/schema";

/**
 * The day page's Positions tab (B2563 T5) — turning `ownerDayLine`'s parallel
 * arrays into one row list, pure and disk-free so it is testable without a
 * fixture. `no node:fs` on purpose: `PositionsTable.tsx` (a "use client" file)
 * imports this module's *types* for its own props, and nothing a browser
 * bundle resolves may pull in `node:fs` even transitively — the same rule
 * `DayStretchEditor.tsx`'s own top-of-file note states for `lib/gps/edits.ts`.
 * Everything that needs the store (place names, zone/hidden-spot lookups,
 * translated strings) is injected as a plain function from the server page,
 * which is the only caller.
 */

type PositionFixRow = {
  kind: "fix";
  /** Index into the day's own fixes — stable row identity for row selection. */
  index: number;
  /** Seconds since epoch, exactly as the store keeps it (never a coordinate). */
  epochSeconds: number;
  lat: number;
  lon: number;
  mode?: TransportMode;
  place: string;
  /** Metres from the previous row, straight line — absent on the first row
   *  and right after a gap. */
  distanceM?: number;
  /** km/h from the previous row over the elapsed time — same absence rule. */
  speedKmh?: number;
  /** "Home"/a zone's own label, "Hidden spot", or absent. */
  hiddenBy?: string;
};

type PositionGapRow = {
  kind: "gap";
  /** Row index (into the fix list) this gap follows. */
  afterIndex: number;
  ms: number;
};

export type PositionRow = PositionFixRow | PositionGapRow;

/** Great-circle metres — restated rather than imported, the same call
 * `DayStretchEditor.tsx` and `lib/gps/edits.ts` each already make: nothing
 * this module exports may pull in a module that imports `node:fs`. */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildPositionRows(input: {
  points: [number, number][];
  times: number[];
  modes: (TransportMode | undefined)[];
  gapAfter: boolean[];
  placeFor: (lat: number, lon: number) => string;
  hiddenByFor: (lat: number, lon: number, epochMs: number) => string | undefined;
}): PositionRow[] {
  const { points, times, modes, gapAfter, placeFor, hiddenByFor } = input;
  const rows: PositionRow[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lat, lon] = points[i];
    const afterGap = i > 0 && gapAfter[i - 1];
    let distanceM: number | undefined;
    let speedKmh: number | undefined;
    if (i > 0 && !afterGap) {
      const [prevLat, prevLon] = points[i - 1];
      distanceM = Math.round(metresBetween({ lat: prevLat, lon: prevLon }, { lat, lon }));
      const hours = (times[i] - times[i - 1]) / 3_600_000;
      speedKmh = hours > 0 ? distanceM / 1000 / hours : 0;
    }
    rows.push({
      kind: "fix",
      index: i,
      epochSeconds: Math.round(times[i] / 1000),
      lat,
      lon,
      mode: modes[i],
      place: placeFor(lat, lon),
      distanceM,
      speedKmh,
      hiddenBy: hiddenByFor(lat, lon, times[i]),
    });
    if (gapAfter[i]) rows.push({ kind: "gap", afterIndex: i, ms: times[i + 1] - times[i] });
  }
  return rows;
}

/** "Hidden by" precedence — a private place (journal-wide, `lib/gps/enrich.ts`'s
 *  `exclude.json`) wins over a hidden spot (one trip's own `track-edits.json`):
 *  the same rule `deriveTrack`'s own `isHidden` check applies fixes in the
 *  order zones-then-spots, restated here as its own pure, testable precedence
 *  rather than inline in the page, since "which wins" is exactly the fact a
 *  reviewer needs a one-line proof of. `zoneLabel` is already resolved by the
 *  caller (the zone's own label, or a "Home" fallback when it has none) —
 *  this function only decides which of the two ever reaches a row. */
export function resolveHiddenBy(
  zoneLabel: string | undefined,
  inHiddenSpot: boolean,
  hiddenSpotLabel: string,
): string | undefined {
  if (zoneLabel !== undefined) return zoneLabel;
  if (inHiddenSpot) return hiddenSpotLabel;
  return undefined;
}

/** `123 min` → `{ hours: 2, minutes: 3 }` — the draft's own "1 h 08 min"
 *  needs the minute component zero-padded, done by the caller (a translated
 *  template has no `%02d`). */
export function gapDurationParts(ms: number): { hours: number, minutes: string } {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return { hours, minutes };
}
