"use client";

import { useCallback, useMemo } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import StreetMap from "./StreetMap";
import { buildTripFrame } from "@/lib/map/tripFrame";
import { drawRouteLines } from "@/lib/map/streetOverlay";
import { stillBounds, type StillData } from "@/lib/map/tripStill";

/**
 * B-2980 — the trip page's route preview as OpenStreetMap: a flat, still
 * MapLibre map framed like the map page, with the recorded route in the same
 * line grammar and small numbered stops. It draws only what it is handed (the
 * same places and recorded line `card.svg` is made from), no pins, no chips.
 */
export default function TripStill({ still, onFail }: { still: StillData; onFail: () => void }) {
  const frame = useMemo(() => buildTripFrame(still.places, still.recorded), [still]);
  const bounds = useMemo(() => stillBounds(still), [still]);

  const onReady = useCallback(
    (map: MapLibreMap) => {
      let loaded = false;
      const markers: MapLibreMarker[] = [];
      // The style is rebuilt on a theme change, which drops the layers: draw again.
      const draw = () => {
        drawRouteLines(map, frame.lines, frame.lines.filter((l) => l.kind === "recorded"), new Set());
      };
      map.on("style.load", draw);
      map.on("load", async () => {
        loaded = true;
        const { Marker } = await import("maplibre-gl");
        for (const place of frame.framePlaces.filter((p) => !p.home)) {
          const el = document.createElement("span");
          el.textContent = String(place.day);
          el.style.cssText =
            "display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;font-size:11px;font-weight:700;line-height:1;background:var(--map-stop-fill);color:var(--map-stop-number);border:2px solid var(--map-stop-ring);";
          markers.push(new Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(map));
        }
      });
      // Tiles that never arrive: give the SVG back rather than a blank box.
      map.on("error", () => {
        if (!loaded) onFail();
      });
    },
    [frame, onFail],
  );

  return (
    <StreetMap
      still
      bounds={bounds}
      padding={24}
      pmtilesUrl={still.file.url}
      maxZoom={still.file.maxZoom}
      onReady={onReady}
      className="h-full w-full"
    />
  );
}
