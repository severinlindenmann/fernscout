import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { MapLine, MapPlace, TripFrame } from "./tripFrame";
import type { PhotoPin } from "./photoPins";
import { groupByScreen } from "./pinGroups";
import { chipRedundant, legPattern, longestSegmentMid, placeChips, type LegPattern } from "./legMode";
import type { TransportMode } from "../types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bike, Bus, Car, Footprints, Plane, Ship, TrainFront, TramFront } from "lucide-react";
import { mediaLoader } from "@/components/mediaLoader";
import { haversineKm, planCamera } from "./dayTransition";

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
/** B-2980: the recorded route is the brand yellow on a navy casing. */
const ROUTE_YELLOW = "#ffd23f";
const ROUTE_CASING = "#16305c";
/** Pins closer than this on screen become one badge; also the 44px tap target. */
const PIN_CLUSTER_PX = 44;

/** A chip only sits on a leg longer than this on screen. */
const CHIP_MIN_LEG_PX = 80;

/** B-2980: a mode chip is 22px; two closer than this, or one this close to a stop or pin, is dropped. */
const CHIP_CLEAR_PX = 34;
/** Water is the one blue-ish line; every other pattern stays brand yellow. */
const WATER_BLUE = "#4aa3df";
const MODE_ICON = {
  walk: Footprints, bicycle: Bike, car: Car, taxi: Car, motorbike: Car, bus: Bus,
  train: TrainFront, metro: TrainFront, tram: TramFront, boat: Ship, ferry: Ship, flight: Plane,
} as const;
const chipMarkers = new WeakMap<MapLibreMap, MapLibreMarker[]>();

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Padding = { top: number; bottom: number; left: number; right: number };
type Box = [[number, number], [number, number]];
/** The day the camera last settled on per map, and a token so a newer move cancels an older one's second leg. */
const lastDay = new WeakMap<MapLibreMap, number | null>();
const moveToken = new WeakMap<MapLibreMap, number>();
/** When the current day-to-day travel is due to land, so a re-frame of the same day (the sheet re-measuring) finishes it rather than cutting it short. */
const travelUntil = new WeakMap<MapLibreMap, number>();
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** Every camera move goes through here, so a newer one cancels an older one's pending second leg. */
function fit(map: MapLibreMap, box: Box, padding: Padding, extra: Record<string, unknown>): number {
  const token = (moveToken.get(map) ?? 0) + 1;
  moveToken.set(map, token);
  map.fitBounds(box, { padding, maxZoom: 15, ...extra });
  return token;
}

/**
 * B-2980 — from day A's framing to day B's along the route. A flight, or a
 * leg over 600 km, flies a high arc (zoom out, then in); a hop eases to a
 * frame holding both ends when neither current view does, then settles on B.
 * Reduced motion jumps. `fitBounds` adds the map's own bottom padding (the
 * phone sheet), so the settled frame clears the sheet exactly as before.
 */
function travel(map: MapLibreMap, from: MapPlace, to: MapPlace, box: Box, padding: Padding, flight: boolean) {
  const plan = planCamera({ km: haversineKm(from, to), flight, reduced: reducedMotion() });
  if (plan.kind !== "jump") travelUntil.set(map, performance.now() + plan.duration);
  if (plan.kind === "jump") {
    fit(map, box, padding, { duration: 0 });
    return;
  }
  if (plan.kind === "flight") {
    fit(map, box, padding, { duration: plan.duration, curve: plan.curve });
    return;
  }
  const both = boundsOf([from, to]);
  const settled = map.cameraForBounds(box, { padding, maxZoom: 15 })?.zoom;
  const together = both ? map.cameraForBounds(both, { padding, maxZoom: 15 })?.zoom : undefined;
  if (!both || settled === undefined || together === undefined || together > settled - 0.3) {
    fit(map, box, padding, { duration: plan.duration });
    return;
  }
  const token = fit(map, both, padding, { duration: plan.duration * 0.45, linear: true, easing: easeIn });
  map.once("moveend", (e: { originalEvent?: unknown }) => {
    if (e.originalEvent || moveToken.get(map) !== token) return;
    fit(map, box, padding, { duration: plan.duration * 0.55, linear: true, easing: easeOut });
  });
}

/** Photo pin markers per map, rebuilt on each draw (they regroup with zoom). */
const pinMarkers = new WeakMap<MapLibreMap, MapLibreMarker[]>();

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
  /** B-2980 — photographs at their own position, and what a tap opens. */
  pins?: readonly PhotoPin[];
  onOpenPins?: (group: PhotoPin[]) => void;
  pinLabel?: string;
  /** B-2980: a mode chip's accessible name, "<mode> (recorded)" or "<mode> (from the day)". */
  legLabel?: (mode: TransportMode, source: "recorded" | "day") => string;
  /** B-2980 — owner only: recorded days with no entry, drawn muted dashed. */
  unwrittenLines?: readonly [number, number][][];
  /** Screen padding (CSS px) to keep clear when fitting a selection — the
   * sheet/header covering part of the box. */
  padding: { top: number; bottom: number; left: number; right: number };
};

function lineToGeoJSON(lines: readonly MapLine[], dimmed?: ReadonlySet<MapLine>) {
  return {
    type: "FeatureCollection" as const,
    features: lines.map((line) => ({
      type: "Feature" as const,
      properties: { kind: line.kind, ...(dimmed ? { dim: dimmed.has(line) } : {}) } as { kind: MapLine["kind"]; dim?: boolean },
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
    casingColor?: string;
    cap?: "butt" | "round";
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
      paint: { "line-color": paint.casingColor ?? CASING_COLOUR, "line-width": paint.casingWidth ?? paint.width + 3 },
    });
  }
  if (!map.getLayer(id)) {
    map.addLayer({
      id,
      type: "line",
      source: id,
      layout: { "line-cap": paint.cap ?? "round", "line-join": "round" },
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
/** Stop names only show from here in. */
const LABEL_MIN_ZOOM = 10;

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

/** Length of a polyline on screen, in CSS px. */
function screenLength(map: MapLibreMap, coords: readonly { lat: number; lng: number }[]): number {
  let n = 0;
  let prev = coords[0] && map.project([coords[0].lng, coords[0].lat]);
  for (const c of coords.slice(1)) {
    const p = map.project([c.lng, c.lat]);
    n += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return n;
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
  const { frame, regionDayNumbers, selectedDay, onSelectDay, padding, regionPlaces, pins = [], onOpenPins, pinLabel = "", unwrittenLines = [], legLabel } = opts;

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
  // A flight is overview-only, never even muted on a day's own view.
  const mutedLines = selectedDay ? linesInRegion.filter((l) => l.kind !== "flight" && l.kind !== "recorded" && !activeLines.includes(l)) : [];

  const draw = async () => {
    ensureLineLayer(
      map,
      "fs-lines-unwritten",
      { type: "FeatureCollection", features: unwrittenLines.map((l) => ({ type: "Feature" as const, properties: { kind: "unwritten" as MapLine["kind"] }, geometry: { type: "LineString" as const, coordinates: l.map(([lat, lng]) => [lng, lat]) } })) },
      { color: "#8a95a5", width: 3, dasharray: [2, 1.5] },
    );
    ensureLineLayer(
      map,
      "fs-pin-tethers",
      { type: "FeatureCollection", features: pins.filter((p) => p.tether).map((p) => ({ type: "Feature" as const, properties: { kind: "tether" as MapLine["kind"] }, geometry: { type: "LineString" as const, coordinates: [[p.lng, p.lat], [p.tether![1], p.tether![0]]] } })) },
      { color: MUTED_COLOUR, width: 1 },
    );
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
    // B-2980: the recorded route keeps its yellow on navy; the mode changes
    // the line's shape (and water its hue), so it reads without colour. One
    // casing under every line of the class, so two days over the same road
    // do not look doubled. Other days stay drawn at 35% when one is selected.
    const recorded = selectedDay ? linesInRegion.filter((l) => l.kind === "recorded") : byKind("recorded");
    const dimmed = new Set(recorded.filter((l) => !activeLines.includes(l)));
    const patternOf = (l: MapLine) => legPattern(l.mode);
    const recordedOf = (...p: LegPattern[]) => lineToGeoJSON(recorded.filter((l) => p.includes(patternOf(l))), dimmed);
    const fade = ["case", ["get", "dim"], 0.35, 1] as unknown as number;
    const recordedLayers: [string, ReturnType<typeof lineToGeoJSON>, Record<string, unknown>, Record<string, unknown>][] = [
      ["fs-lines-recorded", recordedOf("solid", "hatch"), { "line-color": ROUTE_YELLOW }, {}],
      ["fs-lines-recorded-dotted", recordedOf("dotted"), { "line-color": ROUTE_YELLOW, "line-dasharray": [0.1, 2] }, {}],
      ["fs-lines-recorded-dash", recordedOf("dash"), { "line-color": ROUTE_YELLOW, "line-dasharray": [4, 2.2] }, { "line-cap": "butt" }],
      ["fs-lines-recorded-dashed", recordedOf("dashed"), { "line-color": WATER_BLUE, "line-dasharray": [1.2, 1.8] }, { "line-cap": "butt" }],
      // Rail: the solid line above plus navy ticks across it.
      ["fs-lines-recorded-ticks", recordedOf("hatch"), { "line-color": ROUTE_CASING, "line-width": 9, "line-dasharray": [0.25, 1.1] }, { "line-cap": "butt" }],
    ];
    const casingSource = "fs-lines-recorded-casing";
    const all = lineToGeoJSON(recorded, dimmed);
    const existing = map.getSource(casingSource) as GeoJSONSource | undefined;
    if (existing) existing.setData(all);
    else map.addSource(casingSource, { type: "geojson", data: all });
    if (!map.getLayer(casingSource)) {
      map.addLayer({
        id: casingSource, type: "line", source: casingSource,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_CASING, "line-width": 7.5, "line-opacity": fade },
      });
    }
    for (const [id, data, paint, layout] of recordedLayers) {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(data);
      else map.addSource(id, { type: "geojson", data });
      if (!map.getLayer(id)) {
        map.addLayer({
          id, type: "line", source: id,
          layout: { "line-cap": "round", "line-join": "round", ...layout },
          paint: { "line-width": 4, "line-opacity": fade, ...paint },
        } as Parameters<MapLibreMap["addLayer"]>[0]);
      }
    }
    ensureLineLayer(map, "fs-lines-gap", lineToGeoJSON(byKind("gap")), {
      color: MUTED_COLOUR,
      width: 2,
      dasharray: [1, 1.6],
    });
    // Declared-only joins (no recording) stay a thin grey straight dash.
    ensureLineLayer(map, "fs-lines-photo-join", lineToGeoJSON(byKind("photo-join")), {
      color: "#8a95a5",
      width: 1.5,
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
          "display:flex;align-items:center;gap:4px;border:none;background:transparent;padding:11px;min-height:44px;min-width:44px;cursor:pointer;font:inherit;" +
          (reducedMotion() ? "" : "transition:opacity .35s ease;");
        const disc = document.createElement("span");
        disc.className = "fs-daymarker-disc";
        disc.style.cssText =
          "display:flex;align-items:center;justify-content:center;flex:none;border-radius:9999px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.25);" +
          (reducedMotion() ? "" : "transition:width .3s ease,height .3s ease,background .3s ease,border-color .3s ease,color .3s ease,font-size .3s ease;");
        const label = document.createElement("span");
        label.className = "fs-daymarker-label";
        label.style.cssText =
          "font-size:12px;font-weight:600;color:#16305c;white-space:nowrap;text-shadow:-1.5px 0 #fff,1.5px 0 #fff,0 -1.5px #fff,0 1.5px #fff,0 0 4px #fff;";
        // `textContent`, never `innerHTML` — a place name is the owner's own
        // written text, reaching every reader's browser; nothing here trusts
        // it to be markup.
        label.textContent = place.name;
        el.append(disc, label);
        // On the globe's far side a stop hides rather than showing through.
        mk = new Marker({ element: el, opacityWhenCovered: "0" }).setLngLat([place.lng, place.lat]).addTo(map);
        markers.set(place.day, mk);
      }
      const el = mk.getElement();
      el.onclick = () => {
        // Zoomed out past a place's own stops, a tap frames them all first
        // (Reykjavík's two days, say); a tap once they're framed, or on a
        // lone stop, opens the day — B2643.
        const nearby = frame.regions.find((r) => r.places.some((p) => p.day === place.day))?.places ?? [];
        const box = nearby.length > 1 ? boundsOf(nearby) : null;
        const fitZoom = box ? map.cameraForBounds(box, { padding, maxZoom: 15 })?.zoom : undefined;
        if (box && fitZoom !== undefined && map.getZoom() < fitZoom - 1) {
          map.fitBounds(box, { padding, maxZoom: 15, duration: reducedMotion() ? 0 : 600 });
        } else {
          onSelectDay(place.day);
        }
      };
      el.style.display = hide ? "none" : "";
      el.style.opacity = muted ? "0.4" : "1";
      const label = el.querySelector<HTMLElement>(".fs-daymarker-label");
      // Only the selected stop is named, and only once zoomed in enough to matter.
      if (label) label.style.display = place.day === selectedDay && map.getZoom() >= LABEL_MIN_ZOOM && !hiddenLabels.has(place.day) ? "" : "none";
      const disc = el.querySelector<HTMLElement>(".fs-daymarker-disc");
      if (disc) {
        const isSelected = place.day === selectedDay;
        const size = isSelected ? 36 : 24;
        disc.style.width = disc.style.height = `${size}px`;
        disc.style.fontSize = isSelected ? "15px" : "11px";
        disc.style.background = isSelected ? ROUTE_YELLOW : "var(--map-stop-fill, #fff)";
        disc.style.border = `${isSelected ? 2 : 2.5}px solid ${isSelected ? ROUTE_CASING : "var(--map-stop-ring, #16305c)"}`;
        disc.style.color = isSelected ? ROUTE_CASING : "var(--map-stop-number, #16305c)";
        disc.textContent = String(place.day);
      }
      mk.setLngLat([place.lng, place.lat]);
    }
    for (const m of pinMarkers.get(map) ?? []) m.remove();
    const made: MapLibreMarker[] = [];
    const placed = pins.map((pin) => ({ ...map.project([pin.lng, pin.lat]), pin }));
    for (const group of groupByScreen(placed, PIN_CLUSTER_PX)) {
      const first = group[0].pin;
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", first.item.caption ?? first.item.alt ?? pinLabel);
      // 44px tap target around a 32px thumbnail; clear of the stop labels.
      el.style.cssText = "position:relative;width:44px;height:44px;padding:0;border:none;background:transparent;cursor:pointer;";
      const ring = document.createElement("span");
      ring.style.cssText =
        "position:absolute;inset:6px;border-radius:9999px;background:#1b2a41;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);overflow:hidden;display:flex;align-items:center;justify-content:center;";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "eager";
      img.src = mediaLoader({ src: first.item.src, width: 96 });
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      // Camera dot when the photo will not load.
      img.onerror = () => img.remove();
      ring.append(img);
      el.append(ring);
      if (group.length > 1) {
        const badge = document.createElement("span");
        badge.textContent = String(group.length);
        badge.style.cssText =
          "position:absolute;top:0;right:0;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9999px;background:#1b2a41;color:#fff;border:1.5px solid #fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;";
        el.append(badge);
      }
      el.onclick = () => onOpenPins?.(group.map((g) => g.pin));
      made.push(new Marker({ element: el, opacityWhenCovered: "0" }).setLngLat([first.lng, first.lat]).addTo(map));
    }
    pinMarkers.set(map, made);

    // B-2980: one round chip per moded leg, midway along its longest piece.
    for (const m of chipMarkers.get(map) ?? []) m.remove();
    const candidates = activeLines.flatMap((line) => {
      const mid = line.mode && !chipRedundant(line.mode) && (line.kind === "recorded" || line.kind === "photo-join") && screenLength(map, line.coords) > CHIP_MIN_LEG_PX
        ? longestSegmentMid(line.coords)
        : null;
      return mid ? [{ ...map.project([mid.lng, mid.lat]), data: { line, mid } }] : [];
    });
    const blockers = [...places.map((p) => map.project([p.lng, p.lat])), ...placed];
    const chips: MapLibreMarker[] = [];
    for (const { data } of placeChips(candidates, blockers, CHIP_CLEAR_PX)) {
      const { line, mid } = data;
      const mode = line.mode as TransportMode;
      // Recorded legs get a filled chip; a leg only the day declares gets a hollow outline.
      const fromDay = line.modeSource === "day";
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", legLabel?.(mode, line.modeSource ?? "recorded") ?? mode);
      el.style.cssText = `display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border-radius:9999px;background:${fromDay ? "transparent" : "#fff"};color:#16305c;border:2px solid #16305c;box-shadow:${fromDay ? "none" : "0 1px 3px rgba(0,0,0,.3)"};cursor:pointer;`;
      el.innerHTML = renderToStaticMarkup(createElement(MODE_ICON[mode], { size: 12, strokeWidth: 2.5, "aria-hidden": true }));
      el.onclick = () => onSelectDay(line.toDay);
      chips.push(new Marker({ element: el, opacityWhenCovered: "0" }).setLngLat([mid.lng, mid.lat]).addTo(map));
    }
    chipMarkers.set(map, chips);

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
  // Whole trip: stops, the drawn route and the photo pins, so none is cut off.
  const fitPoints = selectedDay === null
    ? [...places, ...linesInRegion.filter((l) => l.kind !== "flight").flatMap((l) => l.coords), ...pins]
    : [...(selectedPlace ? [selectedPlace] : []), ...activeLines.flatMap((l) => l.coords)];
  const box = boundsOf(fitPoints);
  // Moving from one selected day to another travels along the route; any
  // other refit (first selection, deselecting, a padding change) frames in place.
  const previous = lastDay.get(map) ?? null;
  lastDay.set(map, selectedDay);
  const fromPlace = previous !== null ? places.find((p) => p.day === previous) : undefined;
  if (box && selectedPlace && fromPlace && selectedDay !== previous) {
    const flight = frame.lines.some(
      (l) =>
        (l.kind === "flight" || l.mode === "flight") &&
        ((l.fromDay === previous && l.toDay === selectedDay) || (l.fromDay === selectedDay && l.toDay === previous)),
    );
    travel(map, fromPlace, selectedPlace, box, padding, flight);
  } else if (box) {
    const left = (travelUntil.get(map) ?? 0) - performance.now();
    fit(map, box, padding, { duration: reducedMotion() ? 0 : left > 200 ? left : 400 });
  }

  if (map.isStyleLoaded()) void draw();
  else map.once("load", () => void draw());
  map.on("style.load", () => void draw());
  return () => void draw();
}
