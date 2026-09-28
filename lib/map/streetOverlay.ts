import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { MapLine, MapPlace, TripFrame } from "./tripFrame";

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
   * drawn (the chip row stands for it instead). Lines are filtered by this
   * (`frame.lines` is keyed by day number across the whole trip already);
   * markers are not — see `regionPlaces`. */
  regionDayNumbers: Set<number>;
  /**
   * The actual places to draw markers for — B2560. Not re-derived from
   * `regionDayNumbers` against a flattened pool of every region's places:
   * two different regions can share a day *number* (a caller with an
   * imperfect day mapping, or simply a coincidence), and filtering by number
   * alone would then draw a place from the wrong region entirely. The
   * caller already knows exactly which places belong to whichever region
   * (or the whole tour) is showing, so it hands them over directly.
   */
  regionPlaces: readonly MapPlace[];
  /** `null` means "whole trip/region" — nothing muted, fit the region. */
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

/** One marker's own label, already placed at a screen position — what
 * `hiddenLabelDays` below tests for overlap. `x`/`y` are the label's own
 * top-left screen corner (CSS px), not the marker's anchor point. */
export type LabelBox = { day: number; x: number; y: number; width: number; height: number };

/** A rough but stable label width in CSS px for a day marker's place name —
 * the disc, the gap and the label pill's own padding, plus the name at the
 * label's own 11px/600-weight font. Never measures the real DOM (that would
 * need a layout pass per candidate before drawing anything), so this is an
 * estimate, not a pixel-exact box — good enough to decide "would this
 * obviously sit on top of that one", the only question collision hiding
 * asks. ponytail: a fixed 6.2px/char average rather than real font metrics;
 * upgrade to `canvas.measureText` if a name this misjudges actually
 * mis-hides in practice. */
function estimateLabelWidth(name: string): number {
  const disc = 22;
  const gap = 4;
  const padding = 10;
  const charWidth = 6.2;
  return disc + gap + padding + name.length * charWidth;
}

/** The label height every marker draws at — the disc's own 22px is the
 * taller of the two, so it also bounds the label's own box. */
const LABEL_HEIGHT = 22;

/**
 * Which day numbers' labels to hide because an earlier-placed label already
 * overlaps that spot — B2560. `boxes` must already be in placement order
 * (the selected day first, then day order — the caller's own priority, this
 * function only ever keeps what came first and hides what collides with
 * it). The numbered disc itself is never hidden by this — only the text
 * label beside it, so a crowded stretch of coast still shows every day's own
 * dot, just not every name piled on top of the next.
 */
export function hiddenLabelDays(boxes: readonly LabelBox[]): Set<number> {
  const placed: LabelBox[] = [];
  const hidden = new Set<number>();
  for (const box of boxes) {
    if (placed.some((p) => boxesOverlap(box, p))) hidden.add(box.day);
    else placed.push(box);
  }
  return hidden;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
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
  const { frame, regionDayNumbers, selectedDay, accentHex, onSelectDay, padding, regionPlaces } = opts;

  // The caller's own resolved list — see `StreetOverlayOptions.regionPlaces`'s
  // own doc for why this isn't re-derived from `regionDayNumbers` here.
  // `buildTripFrame` only ever fills `frame.framePlaces` with the *main*
  // region's places (or, for a tour, every non-home place); a reader's
  // region switch (`MapPageContent`'s own `regionIndex`) can select any
  // other region, so the caller — which already knows which region is
  // showing — hands over that region's own places directly (B2560).
  const places = regionPlaces;
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

    // "The selected day wins" — its label is placed first, so it is the one
    // every later, overlapping label loses to. Everything else keeps the
    // day/trip order it was already drawn in.
    const placementOrder = [...places].sort((a, b) => {
      if (a.day === selectedDay) return -1;
      if (b.day === selectedDay) return 1;
      return a.day - b.day;
    });
    const labelBoxes: LabelBox[] = placementOrder.map((place) => {
      const point = map.project([place.lng, place.lat]);
      const width = estimateLabelWidth(place.name);
      // Anchored the same way the marker's own DOM sits relative to its
      // `setLngLat` point: vertically centred, immediately to the right of
      // the disc — see the marker element's own flex row below.
      return { day: place.day, x: point.x + 26, y: point.y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT };
    });
    const hiddenLabels = hiddenLabelDays(labelBoxes);

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
        mk = new Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(map);
        markers.set(place.day, mk);
      }
      const el = mk.getElement();
      el.onclick = () => onSelectDay(place.day);
      el.style.display = hide ? "none" : "";
      el.style.opacity = muted ? "0.4" : "1";
      const label = el.querySelector<HTMLElement>(".fs-daymarker-label");
      if (label) label.style.display = hiddenLabels.has(place.day) ? "none" : "";
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
  };

  // Fit only when selection/region changes, never on zoom redraws (which
  // would fight the reader's camera and trigger another zoom event).
  const selectedPlace = places.find((p) => p.day === selectedDay);
  const fitPoints = selectedDay === null
    ? places
    : [...(selectedPlace ? [selectedPlace] : []), ...activeLines.flatMap((l) => l.coords)];
  const box = boundsOf(fitPoints);
  if (box) map.fitBounds(box, { padding, maxZoom: 15, duration: 400 });

  if (map.isStyleLoaded()) void draw();
  else map.once("load", () => void draw());
  map.on("style.load", () => void draw());
  return () => void draw();
}
