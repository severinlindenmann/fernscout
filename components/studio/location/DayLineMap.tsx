"use client";

import { useEffect, useRef } from "react";
import StreetMap from "@/components/map/StreetMap";
import { circlePolygon } from "@/lib/map/circle";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

/** Splits `points` at every `gapAfter` join into runs to draw solid, plus the
 * jumped edges themselves to draw dashed — B2540's day view. Never a single
 * polyline drawn straight through a gap: the dashed edges say "no position
 * between" out loud rather than implying a road that was never travelled. */
function toLines(points: [number, number][], gapAfter: boolean[]) {
  const solid: [number, number][][] = [];
  const dashed: [number, number][][] = [];
  let run: [number, number][] = points.length > 0 ? [points[0]] : [];
  for (let i = 1; i < points.length; i++) {
    if (gapAfter[i - 1]) {
      if (run.length > 1) solid.push(run);
      dashed.push([points[i - 1], points[i]]);
      run = [points[i]];
    } else {
      run.push(points[i]);
    }
  }
  if (run.length > 1) solid.push(run);
  return { solid, dashed };
}

function toGeoJSON(lines: [number, number][][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((line) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: line.map(([lat, lon]) => [lon, lat]) },
    })),
  };
}

/** Half the smallest span the camera frames, in degrees (~500 m), so a line
 * that barely moved does not zoom to the pavement. */
const MIN_HALF_SPAN = 0.005;

/** The camera frame for a line — B2576. The region's own bounds are the
 * file's coverage, which for the world file (B2566) is the whole planet; the
 * line is what the reader came to see. `bounds` only when there is no line. */
export function lineFrame(
  points: [number, number][],
  bounds: [[number, number], [number, number]],
): [[number, number], [number, number]] {
  if (points.length === 0) return bounds;
  const lats = points.map(([lat]) => lat);
  const lons = points.map(([, lon]) => lon);
  const pad = (lo: number, hi: number): [number, number] => {
    const mid = (lo + hi) / 2;
    const half = Math.max((hi - lo) / 2, MIN_HALF_SPAN);
    return [mid - half, mid + half];
  };
  const [minLat, maxLat] = pad(Math.min(...lats), Math.max(...lats));
  const [minLon, maxLon] = pad(Math.min(...lons), Math.max(...lons));
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

const SOLID_SOURCE = "day-line-solid";
const DASHED_SOURCE = "day-line-gap";
const SELECTED_SOURCE = "day-line-selected";
const PENDING_SPOT_SOURCE = "day-line-pending-spot";

/**
 * One recorded day, on a real street map — B2540, S5 A. `pmtilesUrl`/`bounds`
 * are the caller's (the trip's own region file when B2535 has one, else the
 * world file); this component only draws the day's own line on top of it.
 *
 * B2563 T3 adds three optional, independent extras, none of which change
 * what a caller that ignores them gets:
 * - `selected` highlights a sub-range of `points` (the range bar's own
 *   selection) in a third colour, drawn over the solid/dashed line rather
 *   than replacing it — the same "never a single line straight through a
 *   gap" spirit `toLines` already has, one layer further.
 * - `onMapClick` reports a tap's coordinate — the day page's own "tap the
 *   map to hide a spot", reusing `GpsZones`' own click-to-place pattern
 *   rather than inventing a second one.
 * - `pendingSpot` draws that tap's own radius circle while it is being
 *   sized, the same blue-dashed "pending" convention `GpsZones` already
 *   uses for a private place.
 */
export default function DayLineMap({
  points,
  gapAfter,
  bounds,
  pmtilesUrl,
  className,
  selected,
  onMapClick,
  pendingSpot,
}: {
  points: [number, number][];
  gapAfter: boolean[];
  bounds: [[number, number], [number, number]];
  pmtilesUrl: string;
  className?: string;
  /** `[fromIndex, toIndex]` into `points`, inclusive — the range bar's own
   * current selection, or absent/empty to draw nothing extra. */
  selected?: [number, number] | null;
  onMapClick?: (lat: number, lon: number) => void;
  pendingSpot?: { lat: number; lon: number; radiusM: number } | null;
}) {
  const mapRef = useRef<MapLibreMap | null>(null);
  // `onReady` runs once, on mount, when the day page is usually not placing
  // a spot yet; the click listener reads the current handler through this
  // ref, so a handler handed in later is the one a tap reaches.
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  const { solid, dashed } = toLines(points, gapAfter);
  const selectedLine =
    selected && selected[1] > selected[0] ? [points.slice(selected[0], selected[1] + 1)] : [];

  function onReady(map: MapLibreMap) {
    mapRef.current = map;
    map.on("load", () => {
      map.addSource(SOLID_SOURCE, { type: "geojson", data: toGeoJSON(solid) });
      map.addLayer({
        id: `${SOLID_SOURCE}-line`,
        type: "line",
        source: SOLID_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#c2410c", "line-width": 4 },
      });
      map.addSource(DASHED_SOURCE, { type: "geojson", data: toGeoJSON(dashed) });
      map.addLayer({
        id: `${DASHED_SOURCE}-line`,
        type: "line",
        source: DASHED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#c2410c", "line-width": 3, "line-dasharray": [1, 1.5] },
      });
      map.addSource(SELECTED_SOURCE, { type: "geojson", data: toGeoJSON(selectedLine) });
      map.addLayer({
        id: `${SELECTED_SOURCE}-line`,
        type: "line",
        source: SELECTED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 6 },
      });
      map.addSource(PENDING_SPOT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${PENDING_SPOT_SOURCE}-fill`,
        type: "fill",
        source: PENDING_SPOT_SOURCE,
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: `${PENDING_SPOT_SOURCE}-line`,
        type: "line",
        source: PENDING_SPOT_SOURCE,
        paint: { "line-color": "#2563eb", "line-width": 2, "line-dasharray": [2, 2] },
      });
    });
    map.on("click", (e) => onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng));
  }

  // Re-draw whenever the data changes — `onReady` above only runs once, on
  // mount, the same split `GpsZones`' own draw effect already uses.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      (map.getSource(SOLID_SOURCE) as GeoJSONSource | undefined)?.setData(toGeoJSON(solid));
      (map.getSource(DASHED_SOURCE) as GeoJSONSource | undefined)?.setData(toGeoJSON(dashed));
      (map.getSource(SELECTED_SOURCE) as GeoJSONSource | undefined)?.setData(toGeoJSON(selectedLine));
      const pending = pendingSpot ? circlePolygon(pendingSpot.lat, pendingSpot.lon, pendingSpot.radiusM) : null;
      (map.getSource(PENDING_SPOT_SOURCE) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: pending ? [pending] : [],
      });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, gapAfter, selected, pendingSpot]);

  return <StreetMap bounds={lineFrame(points, bounds)} pmtilesUrl={pmtilesUrl} onReady={onReady} className={className} />;
}
