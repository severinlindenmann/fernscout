import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { MapLine, TripFrame } from "./tripFrame";

/**
 * Draws a trip onto a live `StreetMap` (B2535) using B2534's own rules — the
 * street-map counterpart to what `WorldMap`'s SVG path already draws by hand.
 * Everything here is imperative MapLibre calls rather than JSX: this map is a
 * real `maplibregl.Map`, not a component tree, and `MapPageContent` only ever
 * has one of it to update in place as the reader taps a day.
 *
 * Numbered day markers (white disc, navy ring, the day's own number — the
 * same shape `components/map/StopMarker.tsx` draws in SVG, reproduced here
 * as plain DOM so a real `maplibregl.Marker` can own it) sit beside a plain
 * text label of the day's place name. Lines follow B2534's own vocabulary —
 * recorded solid, a recorded gap thin-dashed, a photo-only join thin
 * straight-dashed (deduped), a flight dotted and overview-only — coloured in
 * the trip's own accent with a white casing on the recorded/gap kinds, same
 * as every other map on the site. Selecting a day mutes every other day's
 * marker/line and, once zoomed in close enough that a muted crowd would sit
 * on top of the one street the selected day is about, hides them outright.
 */

const MUTED_COLOUR = "#5a6a80";
const CASING_COLOUR = "#ffffff";

/** Cached across calls — `StreetMap` itself already dynamically imports
 * maplibre-gl (see its own doc comment on why: no other page's bundle should
 * grow for this), so this module never imports it at the top level either;
 * by the time this file's `draw()` runs, the map already exists and the
 * module is already in the browser's module cache, so this `import()`
 * resolves from cache rather than fetching anything new. */
let MarkerCtor: typeof import("maplibre-gl").Marker | undefined;
async function marker(): Promise<typeof import("maplibre-gl").Marker> {
  if (!MarkerCtor) MarkerCtor = (await import("maplibre-gl")).Marker;
  return MarkerCtor;
}

/** Real MapLibre zoom (not `WorldMap`'s relative multiplier) past which a
 * muted day disappears rather than only dimming — "hidden at street zoom". */
const STREET_ZOOM_HIDE = 13;

export type StreetOverlayOptions = {
  frame: TripFrame;
  /** This region's own day numbers — everything outside it is simply never
   * drawn (the chip row stands for it instead). */
  regionDayNumbers: Set<number>;
  /** `null` means "whole trip/region" — nothing muted, no fit. */
  selectedDay: number | null;
  accentHex: string;
  onSelectDay: (day: number) => void;
  /** Screen padding (CSS px) to keep clear when fitting a selection — the
   * sheet/header covering part of the box. */
  padding: { top: number; bottom: number; left: number; right: number };
};

function lineToGeoJSON(lines: readonly MapLine[]) {
  return {
    type: "FeatureCollection" as const,
    features: lines.map((line) => ({
      type: "Feature" as const,
      properties: { kind: line.kind },
      geometry: {
        type: "LineString" as const,
        coordinates: line.coords.map((p) => [p.lng, p.lat]),
      },
    })),
  };
}

function ensureLineLayer(
  map: MapLibreMap,
  id: string,
  data: ReturnType<typeof lineToGeoJSON>,
  paint: {
    color: string;
    width: number;
    dasharray?: number[];
    casing?: boolean;
    casingWidth?: number;
  },
) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: "geojson", data });

  if (paint.casing && !map.getLayer(`${id}-casing`)) {
    map.addLayer({
      id: `${id}-casing`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": CASING_COLOUR, "line-width": paint.casingWidth ?? paint.width + 3 },
    });
  }
  if (!map.getLayer(id)) {
    map.addLayer({
      id,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": paint.color,
        "line-width": paint.width,
        ...(paint.dasharray ? { "line-dasharray": paint.dasharray } : {}),
      },
    });
  }
}

/** Bounding box, in `[[minLng,minLat],[maxLng,maxLat]]`, of a set of lng/lat
 * points — no projection needed, `fitBounds` does its own. */
function boundsOf(points: readonly { lat: number; lng: number }[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function applyStreetOverlay(map: MapLibreMap, opts: StreetOverlayOptions, markers: Map<number, MapLibreMarker>) {
  const { frame, regionDayNumbers, selectedDay, accentHex, onSelectDay, padding } = opts;

  const places = frame.framePlaces.filter((p) => regionDayNumbers.has(p.day));
  const linesInRegion = frame.lines.filter(
    (l) => regionDayNumbers.has(l.fromDay) || regionDayNumbers.has(l.toDay),
  );
  const activeLines = selectedDay
    ? linesInRegion.filter((l) => l.kind !== "flight" && (l.fromDay === selectedDay || l.toDay === selectedDay))
    : linesInRegion;
  const mutedLines = selectedDay ? linesInRegion.filter((l) => !activeLines.includes(l)) : [];

  const draw = async () => {
    ensureLineLayer(map, "fs-lines-muted", lineToGeoJSON(mutedLines), {
      color: MUTED_COLOUR,
      width: 2,
      dasharray: [1, 2],
    });
    // Kind-specific paint on the active set: MapLibre can't branch a single
    // layer's dasharray by feature easily across such different kinds
    // (solid vs. two dash rhythms vs. a dotted arc), so each kind gets its
    // own tiny source/layer pair, only ever holding the (usually one or two)
    // features of that kind.
    const byKind = (kind: MapLine["kind"]) => activeLines.filter((l) => l.kind === kind);
    ensureLineLayer(map, "fs-lines-recorded", lineToGeoJSON(byKind("recorded")), {
      color: accentHex,
      width: 3.5,
      casing: true,
    });
    ensureLineLayer(map, "fs-lines-gap", lineToGeoJSON(byKind("gap")), {
      color: MUTED_COLOUR,
      width: 2,
      dasharray: [1, 1.6],
    });
    ensureLineLayer(map, "fs-lines-photo-join", lineToGeoJSON(byKind("photo-join")), {
      color: MUTED_COLOUR,
      width: 2,
      dasharray: [3, 2.4],
    });
    // Flights: overview only — `activeLines` already excludes them whenever
    // a day is selected (see above), so this is naturally empty then.
    ensureLineLayer(map, "fs-lines-flight", lineToGeoJSON(byKind("flight")), {
      color: MUTED_COLOUR,
      width: 1.5,
      dasharray: [1, 2.6],
    });

    // Markers: one per place, reused across calls rather than torn down and
    // rebuilt, so a click mid-drag never targets a stale element.
    const Marker = await marker();
    const seen = new Set<number>();
    for (const place of places) {
      seen.add(place.day);
      const muted = selectedDay !== null && place.day !== selectedDay;
      const hide = muted && map.getZoom() > STREET_ZOOM_HIDE;
      let mk = markers.get(place.day);
      if (!mk) {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", place.name);
        el.style.cssText =
          "display:flex;align-items:center;gap:4px;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;";
        const disc = document.createElement("span");
        disc.className = "fs-daymarker-disc";
        disc.style.cssText =
          "display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;font-weight:700;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,.25);";
        const label = document.createElement("span");
        label.className = "fs-daymarker-label";
        label.style.cssText =
          "font-size:11px;font-weight:600;background:var(--surface-raised,#fff);padding:1px 5px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);";
        // `textContent`, never `innerHTML` — a place name is the owner's own
        // written text, reaching every reader's browser; nothing here trusts
        // it to be markup.
        label.textContent = place.name;
        el.append(disc, label);
        el.addEventListener("click", () => onSelectDay(place.day));
        mk = new Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(map);
        markers.set(place.day, mk);
      }
      const el = mk.getElement();
      el.style.display = hide ? "none" : "";
      el.style.opacity = muted ? "0.4" : "1";
      const disc = el.querySelector<HTMLElement>(".fs-daymarker-disc");
      if (disc) {
        const isSelected = place.day === selectedDay;
        disc.style.background = isSelected ? "var(--map-selected-fill, #16305c)" : "var(--map-stop-fill, #fff)";
        disc.style.border = `2.5px solid ${isSelected ? "var(--map-selected-fill, #16305c)" : "var(--map-stop-ring, #16305c)"}`;
        disc.style.color = isSelected ? "var(--map-selected-number, #fff)" : "var(--map-stop-number, #16305c)";
        disc.textContent = String(place.day);
      }
      mk.setLngLat([place.lng, place.lat]);
    }
    for (const [day, mk] of markers) {
      if (!seen.has(day)) {
        mk.remove();
        markers.delete(day);
      }
    }

    if (selectedDay !== null) {
      const selectedPlace = places.find((p) => p.day === selectedDay);
      const selectedLinePoints = activeLines.flatMap((l) => l.coords);
      const box = boundsOf([...(selectedPlace ? [selectedPlace] : []), ...selectedLinePoints]);
      if (box) {
        map.fitBounds(box, {
          padding,
          maxZoom: 15,
          duration: 400,
        });
      }
    }
  };

  if (map.isStyleLoaded()) void draw();
  else map.once("load", () => void draw());
  map.on("style.load", () => void draw());
  return () => void draw();
}
