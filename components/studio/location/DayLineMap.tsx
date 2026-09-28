"use client";

import { useRef } from "react";
import StreetMap from "@/components/map/StreetMap";
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

const SOLID_SOURCE = "day-line-solid";
const DASHED_SOURCE = "day-line-gap";

/**
 * One recorded day, on a real street map — B2540, S5 A. `pmtilesUrl`/`bounds`
 * are the caller's (the trip's own region file when B2535 has one, else the
 * world file); this component only draws the day's own line on top of it.
 */
export default function DayLineMap({
  points,
  gapAfter,
  bounds,
  pmtilesUrl,
  className,
}: {
  points: [number, number][];
  gapAfter: boolean[];
  bounds: [[number, number], [number, number]];
  pmtilesUrl: string;
  className?: string;
}) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const { solid, dashed } = toLines(points, gapAfter);

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
      const solidSrc = map.getSource(SOLID_SOURCE) as GeoJSONSource | undefined;
      solidSrc?.setData(toGeoJSON(solid));
      const dashedSrc = map.getSource(DASHED_SOURCE) as GeoJSONSource | undefined;
      dashedSrc?.setData(toGeoJSON(dashed));
    });
  }

  return <StreetMap bounds={bounds} pmtilesUrl={pmtilesUrl} onReady={onReady} className={className} />;
}
