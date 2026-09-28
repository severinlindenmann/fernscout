"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader, posterSrc } from "./mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { frameRoute, frameSpanKm, isPlottable, place as placeIn, type Frame } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { useMapViewport } from "./map/useMapViewport";
import { mapAccent, mapStyle } from "@/lib/map/style";
import StopMarker from "./map/StopMarker";
import ClusterMarker from "./map/ClusterMarker";
import HereNow from "./map/HereNow";
import RouteLine from "./map/RouteLine";
import PlannedLine from "./map/PlannedLine";
import LegChip from "./map/LegChip";
import MapControls from "./map/MapControls";
import StopScopeSwitch, { type StopScope } from "./map/StopScopeSwitch";
import TimeScrubber from "./map/TimeScrubber";
import type { Basemap } from "@/lib/basemap";
import type { PlaceEntry, PlannedStop, TransportMode, TripAccent } from "@/lib/types";

export type PlaceView = {
  key: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  firstDate: string;
  lastDate: string;
  nights: number;
  mediaCount: number;
  entries: PlaceEntry[];
};

type Leg = { from: PlaceView; to: PlaceView; mode: TransportMode };

/** Places close together at the current zoom collapse into one marker. */
type Cluster = { x: number; y: number; places: PlaceView[] };

/**
 * How far apart two markers must be, as a multiple of one marker's radius,
 * before they are drawn separately.
 *
 * Clustering exists so that markers do not sit on top of each other, which
 * makes it a question about the *drawing*, not about the ground: two stops
 * fifteen kilometres apart collide on a map of Europe and are comfortably
 * separate on a map of one valley. The old radius was `16 / zoom` viewBox units
 * — 640 km at zoom 1, still 80 km fully zoomed in — so the four Alpine passes
 * of `alps-2024`, which span 68 km, merged into one "4" and could not be
 * separated at any zoom the UI offered.
 *
 * Just over two radii, so two markers separate as soon as they would stop
 * overlapping rather than at the exact moment they touch.
 */
const MERGE_RADII = 1.9;

function clusterPlaces(places: PlaceView[], markerRadius: number, frame: Frame): Cluster[] {
  const radius = markerRadius * MERGE_RADII;
  const clusters: Cluster[] = [];
  for (const point of places) {
    const [x, y] = placeIn(frame, point);
    const hit = clusters.find((c) => Math.hypot(c.x - x, c.y - y) < radius);
    if (hit) {
      hit.places.push(point);
      // keep the cluster centred on its members
      hit.x = hit.places.reduce((s, p) => s + placeIn(frame, p)[0], 0) / hit.places.length;
      hit.y = hit.places.reduce((s, p) => s + placeIn(frame, p)[1], 0) / hit.places.length;
      continue;
    }
    clusters.push({ x, y, places: [point] });
  }
  return clusters;
}

export default function WorldMap({
  places,
  plan = [],
  track = [],
  basemap = null,
  pastTense = places.length > 0,
  accent = "navy",
  live = false,
  selectedKey: selectedKeyProp,
  onSelect: onSelectProp,
  showStopCard = true,
}: {
  places: PlaceView[];
  /** The intended route, drawn behind the real one. */
  plan?: PlannedStop[];
  /**
   * The ground actually covered — B665. One array of `[lat, lon]` per segment,
   * derived from the owner's own position history and clipped to this trip.
   *
   * Drawn under everything, in the trip's own accent — the markers are what
   * somebody wrote and the track is the texture between them. Empty is the
   * normal case, and a trip without one looks exactly as it did before this
   * existed. Present, it replaces the straight hops below: a recorded line is
   * the real route, not a reconstruction of one (docs/plans/map-redesign.md
   * §1, "Route").
   */
  track?: [number, number][][];
  /**
   * Borders, water, peaks and towns for this frame, clipped on the server
   * (lib/basemap.ts). Null when the bundle has not been built, in which case
   * the old 110m coastline stands in — which is all this map had before B46.
   */
  basemap?: Basemap | null;
  /** Whether the containing map page speaks about completed travel. */
  pastTense?: boolean;
  /** The trip's own colour (B2422) — one accent per trip, on the route and
   * every stop the reader taps. Defaults to navy for a caller that has none
   * to give (the countdown, the studio's recorded-trips preview). */
  accent?: TripAccent;
  /** Whether the trip is under way right now (`trip.status === "current"`).
   * Gates the one yellow marker this map ever draws — a documented stop is
   * not a live fix, so this is anchored to the most recently written place,
   * never to raw GPS (AGENTS.md). Defaults to false: a caller that forgets
   * this draws no here-now dot, which is the honest default. */
  live?: boolean;
  /**
   * An outside instruction to select this stop — the map page's mobile
   * sheet (B2427) driving the same selection a marker tap would. `undefined`
   * (the countdown, the studio's recorded-trips preview) means nobody else
   * is driving it; this map owns its own selection exactly as before. `null`
   * clears it. Applied through `selectPlace`, so a nudge from outside gets
   * the identical scope-aware camera behaviour a tap on the map itself does
   * — one camera model, not two.
   */
  selectedKey?: string | null;
  /** Fired whenever the selection changes, for any reason (a tap, the time
   * scrubber, or `selectedKey` above) — so a caller driving `selectedKey`
   * can mirror the same key back into its own UI. */
  onSelect?: (place: PlaceView | null) => void;
  /** Withholds the floating stop card entirely — for a caller that already
   * shows the same content its own way (the desktop map page's stop list,
   * B2430, next to this map; the phone sheet, B2427, below it). Defaults to true, so
   * every other caller (the countdown, the studio's recorded-trips
   * preview) is unaffected. */
  showStopCard?: boolean;
}) {
  const { t, formatShortDate, formatStay } = useI18n();
  // Same as the stop list below the map: the day link has to carry the owner
  // and, off the current trip, the trip too.
  const href = useTrip()?.href ?? ((p: string) => p);
  const worldLand = useWorldLand();
  const [selected, setSelectedState] = useState<PlaceView | null>(null);
  const [scope, setScope] = useState<StopScope>("trip");

  const planAhead = useMemo(() => {
    if (plan.length === 0) return [];
    let lastReached = -1;
    plan.forEach((s, i) => {
      if (s.reached) lastReached = i;
    });
    return plan.slice(Math.max(0, lastReached));
  }, [plan]);

  // A coordinate-less day (B265) is not a point on this map: dropped here,
  // once, rather than at every place below that would otherwise draw one —
  // the frame, the focus, the clusters and the legs all read this instead of
  // `places`, so a route runs through the days that were located and simply
  // does not reach for the ones that weren't.
  const plottable = useMemo(() => places.filter(isPlottable), [places]);

  // The day-order number every marker keeps, however it's drawn or however
  // many stops merge into a cluster at this zoom — B2422's own "the number
  // survives every zoom" rule.
  const orderByKey = useMemo(
    () => new Map(plottable.map((p, i) => [p.key, i + 1] as const)),
    [plottable],
  );

  const legs: Leg[] = useMemo(() => {
    const out: Leg[] = [];
    for (let i = 1; i < plottable.length; i++) {
      const mode = plottable[i].entries[0]?.transport?.mode;
      if (!mode) continue;
      out.push({ from: plottable[i - 1], to: plottable[i], mode });
    }
    return out;
  }, [plottable]);

  // Base frame: the visited area, padded. An upcoming trip has no places yet
  // — fall back to framing the planned route instead, so it isn't a few dots
  // lost in the full world. Only when there's neither does the whole world
  // stand in.
  const base = useMemo(
    () => frameRoute(plottable.length > 0 ? plottable : plan),
    [plottable, plan],
  );

  // Where the stops actually are. Zooming in drifts the camera from the
  // route's bounding-box centre toward this, so you end up over the places
  // rather than the empty ocean in the middle of a long-haul leg.
  const focus = useMemo(() => {
    if (plottable.length === 0) return null;
    const pts = plottable.map((p) => placeIn(base, p));
    return {
      x: pts.reduce((s, p) => s + p[0], 0) / pts.length,
      y: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    };
  }, [plottable, base]);

  /**
   * How far in you may go: until the view is about two kilometres across.
   *
   * A constant 8 made sense against a base frame that was always continental —
   * it was 8× of "most of Europe". Now that the base frame is the size of the
   * trip, the same constant means something different for every trip, so the
   * limit is expressed as the thing a reader actually wants: keep zooming until
   * the street you walked would fill the screen, if the data went that far.
   */
  const maxZoom = useMemo(
    () => Math.min(64, Math.max(8, frameSpanKm(base) / 2)),
    [base],
  );

  /**
   * How wide this map is actually being drawn, in CSS pixels.
   *
   * Set after mount, and deliberately *not* during the server render: the
   * initial value has to be identical on both sides or every size below becomes
   * a hydration mismatch. 900 is a desktop map; a phone corrects it on the
   * first frame.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drawnWidth, setDrawnWidth] = useState(900);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setDrawnWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pan/zoom state and gesture handling — pinch, wheel, double-tap, keyboard
  // — shared with `TripMap` (B2419). Not cooperative: this is the map page
  // itself (and its full-screen overlay), so every finger belongs to it.
  const viewport = useMapViewport({ svgRef, maxZoom });
  const { zoom, pan, setZoom, setPan } = viewport;

  const view = useMemo(() => {
    const w = base.w / zoom;
    const h = base.h / zoom;
    const baseCx = base.x + base.w / 2;
    const baseCy = base.y + base.h / 2;
    // 0 at zoom 1, approaching 1 as you zoom in.
    const drift = focus ? Math.min(1, (zoom - 1) / 2) : 0;
    const cx = (focus ? baseCx + (focus.x - baseCx) * drift : baseCx) + pan.x;
    const cy = (focus ? baseCy + (focus.y - baseCy) * drift : baseCy) + pan.y;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [base, zoom, pan, focus]);
  // Kept for gesture handlers that fire between renders (a pinch, a wheel
  // tick) — an effect, not a call in the render body, so nothing here ever
  // mutates a ref while rendering.
  useEffect(() => {
    viewport.syncFrame(view);
  }, [viewport, view]);

  /**
   * A length in screen pixels, expressed in the units this frame is drawn in.
   *
   * Two bugs live here, and they are the same bug at two scales.
   *
   * Originally every marker radius, stroke width and label was a constant in
   * viewBox units divided by `zoom`. That worked only because the frame was
   * *always* continental — around 140 units wide — so "r = 5" happened to mean
   * a dot. Once B46 made the frame the size of the trip, the Alps came out 4.6
   * units across and a radius-8 marker was three times wider than the entire
   * map: the page rendered as a blank white rectangle, which is what a white
   * circle bigger than its own viewBox looks like.
   *
   * Making them a fraction of the view fixed that and introduced the second:
   * a fraction of the width is a *different number of pixels* on a phone than
   * on a laptop, so town names that read at 13px on a desktop arrived at 5px on
   * a 390-pixel screen. Sizing against the measured width instead means a
   * label is eleven pixels tall wherever it is read, which is the only
   * definition of "legible" that survives changing the screen.
   */
  const px = useCallback(
    (pixels: number) => (pixels * view.w) / drawnWidth,
    [view.w, drawnWidth],
  );

  // Clustered against the radius the markers are actually drawn at, so the
  // rule is "these two would overlap" rather than a distance guessed up front.
  const clusters = useMemo(() => clusterPlaces(plottable, px(13), base), [plottable, px, base]);

  const reset = viewport.reset;

  // "Whole trip / This stop" (B2422) — zooms the camera onto the selected
  // stop, the same anchored-zoom maths the cluster-tap handler below already
  // uses. Only ever offered once something is selected; clearing the
  // selection (or picking a new one) drops back to "trip" rather than
  // leaving the switch pointed at a stop that is no longer on screen.
  const focusOnStop = useCallback(
    (place: PlaceView) => {
      const nextZoom = Math.min(maxZoom, 6);
      const baseCx = base.x + base.w / 2;
      const baseCy = base.y + base.h / 2;
      const drift = focus ? Math.min(1, (nextZoom - 1) / 2) : 0;
      const anchorX = focus ? baseCx + (focus.x - baseCx) * drift : baseCx;
      const anchorY = focus ? baseCy + (focus.y - baseCy) * drift : baseCy;
      const [px_, py_] = placeIn(base, place);
      setZoom(nextZoom);
      setPan({ x: px_ - anchorX, y: py_ - anchorY });
    },
    [base, focus, maxZoom, setZoom, setPan],
  );

  const selectPlace = useCallback(
    (place: PlaceView) => {
      setSelectedState(place);
      setScope("trip");
      onSelectProp?.(place);
    },
    [onSelectProp],
  );

  // An outside nudge (B2427's mobile sheet, tapping a stop in its own list,
  // or its own copy of the time scrubber) — applied through `selectPlace`
  // so it gets the exact same scope-aware camera behaviour a tap on the map
  // itself does. `lastExternalKey` stops the `onSelect` this schedules from
  // re-entering this same effect once the caller mirrors the key straight
  // back as `selectedKey` (a stable no-op loop rather than a live one).
  const lastExternalKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (selectedKeyProp === undefined || selectedKeyProp === lastExternalKey.current) return;
    lastExternalKey.current = selectedKeyProp;
    if (selectedKeyProp === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedState(null);
      return;
    }
    const place = places.find((p) => p.key === selectedKeyProp);
    if (place) selectPlace(place);
  }, [selectedKeyProp, places, selectPlace]);

  // Track is the real route; hops are a straight-line reconstruction of one.
  // Never both — a recorded line is what actually happened, and drawing a
  // second, invented route beside it would say something the data doesn't
  // (docs/plans/map-redesign.md §1, "Route").
  const showHops = track.length === 0;

  // The one yellow marker this map draws, and only for a live trip — anchored
  // to the most recently written place, never to a raw position (see the
  // `live` prop's own doc comment above).
  const hereNow = live && plottable.length > 0 ? plottable[plottable.length - 1] : null;

  // A real browser fullscreen of the map shell (docs/plans/map-redesign.md
  // §3 Phase 2 item 6, the desktop map page's own full-screen button) — not
  // the phone full-screen *route* the map page opens elsewhere. Feature-
  // detected in an effect rather than a lazy initializer: this component is
  // server-rendered (`test/map-page.test.tsx`, and the real trip page), where
  // there is no `document` to ask, so starting from `false` and only turning
  // the button on after mount is what keeps the client's first render
  // matching the server's — a lazy initializer reading `document` would
  // decide the answer during hydration itself, before React has anything to
  // compare it against, and only mismatch where the browser actually has the
  // API (never in a test, which is why it took a real browser to catch).
  // iOS Safari has none at all, so the button never appears there either way.
  const mapShellRef = useRef<HTMLDivElement>(null);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  useEffect(() => {
    // Feature detection, not a subscription — nothing here changes after
    // mount, so there is no later caller for this to react to. Same shape
    // as the "read the URL once, right after mount" effects elsewhere on
    // this map page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullscreenSupported(
      typeof document !== "undefined" &&
        document.fullscreenEnabled === true &&
        typeof HTMLElement.prototype.requestFullscreen === "function",
    );
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      mapShellRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div>
      <div
        ref={mapShellRef}
        className="relative overflow-hidden rounded-2xl border border-line-quiet shadow-sm [&:fullscreen]:flex [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:items-center [&:fullscreen]:rounded-none [&:fullscreen]:border-0"
        style={{ backgroundColor: mapStyle.sea }}
      >
        {/* role="group", not role="img": img makes every descendant
            presentational, which hid the focusable cluster markers below from
            assistive tech entirely. */}
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          // A floor on the height. Framed to a 1.6 landscape shape, `h-auto`
          // alone leaves a 240-pixel band on a phone — and this is the map
          // page, where the map is the entire point of the screen. The pan and
          // zoom controls also need somewhere to be that is not on top of the
          // route.
          className="block h-auto min-h-[340px] w-full cursor-grab touch-none outline-none active:cursor-grabbing sm:min-h-0"
          role="group"
          // The same question the heading above it asks (B54). A map showing
          // only a planned route must not announce itself as "where we've
          // been" — the sighted reader had that corrected in the h1, and this
          // is the only name a screen reader gets.
          aria-label={t(pastTense ? "map.title" : "map.titlePlanned")}
          {...viewport.bind}
        >
          {/* Ground.

              Path data — whether the old coastline or the new basemap — is
              baked in *uncorrected* projected units, so it is the one thing on
              the map squeezed by a transform rather than positioned point by
              point; everything else goes through `placeIn`, which applies the
              same factor. `vector-effect` keeps outlines an even hairline:
              without it the horizontal squeeze thins vertical strokes by a
              third at Swiss latitudes and the coast looks half-drawn.

              Only the elements docs/plans/map-redesign.md §1 actually names —
              land, borders, ice, lakes/rivers, roads. Relief shading and
              parks, which the basemap bundle also carries, are not in that
              table; Paper leaves them out rather than inventing tokens for a
              texture the design doesn't ask for. */}
          <g transform={`scale(${base.lngScale} 1)`}>
            {basemap ? (
              <>
                <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1.2}>
                  {basemap.borders.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                {/* Ice, over the land it sits on. */}
                <g fill={mapStyle.ice} stroke={mapStyle.ice} strokeWidth={0.6} opacity={0.9}>
                  {basemap.glaciers.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                {/* Cantons, prefectures, states. Dashed and faint, because an
                    internal boundary is a weaker fact than a national one and
                    should not read as the same line. */}
                <g fill="none" stroke={mapStyle.borderInternal} strokeWidth={0.8} strokeDasharray="3 3">
                  {basemap.admin1.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                <g fill={mapStyle.water} stroke={mapStyle.water} strokeWidth={0.8}>
                  {basemap.lakes.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                <g fill="none" stroke={mapStyle.water} strokeWidth={1.6} strokeLinecap="round">
                  {basemap.rivers.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                {/* Ways, drawn only when the frame is close enough that they
                    are information rather than texture — the server sends
                    nothing here otherwise. White with a sand casing, the way
                    every road on this map reads now — deliberately paler than
                    any route the trip took: the point of this map is where
                    *these people* went, and a motorway they never drove must
                    not out-shout it. */}
                <g fill="none" stroke={mapStyle.roadCasing} strokeWidth={2.4} strokeLinecap="round">
                  {basemap.roads.map((d, i) => (
                    <path key={`casing-${i}`} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                <g fill="none" stroke={mapStyle.road} strokeWidth={1.4} strokeLinecap="round">
                  {basemap.roads.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              </>
            ) : (
              <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1}>
                {worldLand.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}
          </g>

          {/* Names, in the frame's corrected space — see the note in
              lib/basemap.ts on why labels come back already corrected.
              Deliberately quiet: this is context behind the trip, and a town
              that competes with a stop the author actually wrote about has the
              emphasis the wrong way round. `pointerEvents` off throughout, so
              none of it can swallow a tap meant for a marker. */}
          {basemap && (
            <g pointerEvents="none">
              {basemap.towns.map((town) => (
                <g key={`town-${town.name}-${town.x}`}>
                  <circle cx={town.x} cy={town.y} r={px(3.5)} fill={mapStyle.labelTown} />
                  <text
                    x={town.x + px(6)}
                    y={town.y + px(4)}
                    fontSize={px(11)}
                    fill={mapStyle.labelTown}
                    className="font-display"
                  >
                    {town.name}
                  </text>
                </g>
              ))}
              {basemap.peaks.map((peak) => (
                <g key={`peak-${peak.name}-${peak.x}`}>
                  {/* A triangle, because a dot would read as another town. */}
                  <path
                    d={`M${peak.x},${peak.y - px(7)} L${peak.x + px(6)},${peak.y + px(5)} L${peak.x - px(6)},${peak.y + px(5)} Z`}
                    fill={mapStyle.labelPeak}
                  />
                  <text
                    x={peak.x + px(9)}
                    y={peak.y + px(6)}
                    fontSize={px(11)}
                    fill={mapStyle.labelPeak}
                    className="font-display"
                  >
                    {peak.name}
                    {peak.metres ? ` ${peak.metres} m` : ""}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* The ground actually covered, under the stops — the real route,
              drawn in the trip's own accent with a white casing, the same
              language `RouteLine` draws the reconstructed one in. Framing is
              deliberately *not* recomputed to include it: the frame is the
              trip's stops, and a track that wandered outside them — a day trip
              nobody wrote up — must not be able to zoom the whole map out to
              fit itself. The viewBox clips whatever falls outside, which is
              the right answer for a line that is texture rather than record. */}
          {track.length > 0 && (
            <g aria-hidden="true" pointerEvents="none" fill="none" strokeLinecap="round" strokeLinejoin="round">
              {track.map((segment, i) => (
                <path
                  key={`casing-${i}`}
                  d={segment
                    .map(
                      ([lat, lon], j) =>
                        `${j === 0 ? "M" : "L"}${placeIn(base, { lat, lng: lon }).join(",")}`,
                    )
                    .join(" ")}
                  stroke={mapStyle.routeCasing}
                  strokeWidth={px(7)}
                />
              ))}
              {track.map((segment, i) => (
                <path
                  key={i}
                  d={segment
                    .map(
                      ([lat, lon], j) =>
                        `${j === 0 ? "M" : "L"}${placeIn(base, { lat, lng: lon }).join(",")}`,
                    )
                    .join(" ")}
                  stroke={mapAccent(accent)}
                  strokeWidth={px(4)}
                />
              ))}
            </g>
          )}

          {/* What's left of the plan, behind the real route: a dashed run from
              where we've got to through the stops still ahead, with hollow
              markers on each. Drawing the whole plan would lay a second line
              over the route already travelled and say nothing extra. Straight
              only — `PlannedLine` never arcs; a plan has no recorded shape to
              arc around. */}
          {planAhead.length > 1 && (
            <g pointerEvents="none">
              <PlannedLine points={planAhead.map((s) => ({ x: placeIn(base, s)[0], y: placeIn(base, s)[1] }))} px={px} />
              {planAhead
                .filter((s) => !s.reached)
                .map((s, i) => {
                  const [x, y] = placeIn(base, s);
                  return (
                    <circle
                      key={`${s.location}-${i}`}
                      cx={x}
                      cy={y}
                      r={px(5)}
                      fill={mapStyle.stopFill}
                      stroke={mapStyle.plannedLeg}
                      strokeWidth={px(1.8)}
                      opacity={0.75}
                    />
                  );
                })}
            </g>
          )}

          {/* The trip's own route, straight hops in the accent colour — see
              the `showHops` note above for why this and the recorded track
              are never both drawn. */}
          {showHops && (
            <RouteLine
              accent={accent}
              px={px}
              hops={legs.map((leg) => {
                const [x1, y1] = placeIn(base, leg.from);
                const [x2, y2] = placeIn(base, leg.to);
                return { x1, y1, x2, y2, mode: leg.mode };
              })}
            />
          )}

          {/* A chip at each leg's midpoint names how it was made — the
              replacement for the old 13-colour-coded lines
              (docs/plans/map-redesign.md §1, "Transport"). Never a duration:
              nothing here computes one, and none of this app's transport data
              carries one to show. */}
          {showHops &&
            legs.map((leg, i) => {
              const [x1, y1] = placeIn(base, leg.from);
              const [x2, y2] = placeIn(base, leg.to);
              return <LegChip key={i} x={(x1 + x2) / 2} y={(y1 + y2) / 2} mode={leg.mode} px={px} />;
            })}

          {clusters.map((cluster, i) => {
            const many = cluster.places.length > 1;
            if (many) {
              return (
                <ClusterMarker
                  key={i}
                  x={cluster.x}
                  y={cluster.y}
                  count={cluster.places.length}
                  ariaLabel={`${cluster.places.length} ${t("map.places")}`}
                  px={px}
                  onSelect={() => {
                    // Zoom into the cluster instead of picking one arbitrarily,
                    // centring it after the drift the new zoom will apply.
                    const nextZoom = Math.min(maxZoom, zoom * 2);
                    const baseCx = base.x + base.w / 2;
                    const baseCy = base.y + base.h / 2;
                    const drift = focus ? Math.min(1, (nextZoom - 1) / 2) : 0;
                    const anchorX = focus ? baseCx + (focus.x - baseCx) * drift : baseCx;
                    const anchorY = focus ? baseCy + (focus.y - baseCy) * drift : baseCy;
                    setZoom(nextZoom);
                    setPan({ x: cluster.x - anchorX, y: cluster.y - anchorY });
                  }}
                />
              );
            }
            const place = cluster.places[0];
            return (
              <StopMarker
                key={i}
                x={cluster.x}
                y={cluster.y}
                order={orderByKey.get(place.key) ?? 1}
                selected={selected?.key === place.key}
                ariaLabel={`${place.location}, ${place.country}`}
                px={px}
                onSelect={() => selectPlace(place)}
              />
            );
          })}

          {hereNow && (() => {
            const [x, y] = placeIn(base, hereNow);
            return <HereNow x={x} y={y} px={px} label={t("map.hereNow")} />;
          })()}
        </svg>

        {/* zoom controls */}
        <div className="absolute right-3 top-3">
          <MapControls
            onZoomIn={() => setZoom((z) => Math.min(maxZoom, z * 1.6))}
            onZoomOut={() => setZoom((z) => Math.max(1, z / 1.6))}
            onFit={reset}
            // Desktop only (B2430) — the phone map already opens its own
            // full-screen route (elsewhere on this page) for the same
            // reason, so a second full-screen button here would be a second
            // way to do the one thing on a screen too small for either.
            onFullscreen={fullscreenSupported ? toggleFullscreen : undefined}
            fullscreenClassName="hidden lg:block"
          />
        </div>

        {/* "Whole trip / This stop" — only offered once there is a stop to
            switch to (docs/plans/map-redesign.md §1, "Controls"). */}
        {selected && (
          <div className="absolute left-3 top-3">
            <StopScopeSwitch
              scope={scope}
              onChange={(next) => {
                setScope(next);
                if (next === "stop") focusOnStop(selected);
                else reset();
              }}
            />
          </div>
        )}

        <AnimatePresence>
          {selected && showStopCard && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-x-3 bottom-3 rounded-xl border border-line-quiet bg-surface-raised/95 p-3 shadow-lg backdrop-blur sm:inset-x-auto sm:left-4 sm:max-w-sm"
            >
              <button
                onClick={() => {
                  setSelectedState(null);
                  onSelectProp?.(null);
                }}
                aria-label="Close"
                className="absolute right-2 top-2 rounded-full p-1 text-ink-secondary hover:bg-surface-selected/60 hover:text-ink-strong"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="font-display text-base font-semibold text-ink-strong">
                {selected.location}
              </div>
              <div className="text-xs text-ink-secondary">
                {flagFor(selected.country, selected.countryCode)} {selected.country} ·{" "}
                {formatShortDate(selected.firstDate)}
                {selected.lastDate !== selected.firstDate &&
                  ` – ${formatShortDate(selected.lastDate)}`}{" "}
                · {formatStay(selected.nights)}
              </div>
              {selected.entries.some((e) => e.gallery.length > 0) && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {selected.entries
                    .flatMap((e) => e.gallery)
                    .slice(0, 6)
                    .map((m) => (
                      <span
                        key={m.src}
                        className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-line-quiet bg-surface-muted"
                      >
                        {m.type === "video" ? (
                          // The still frame where there is one, sized — not the
                          // clip itself fetched to draw a 56px square.
                          <video
                            src={m.src}
                            poster={posterSrc(m.poster, POSTER_WIDTH.GRID)}
                            preload={m.poster ? "none" : "metadata"}
                            className="h-full w-full object-cover"
                            muted
                          />
                        ) : (
                          <Image
                            src={m.src}
                            loader={mediaLoader}
                            alt={m.alt ?? m.caption ?? selected.location}
                            fill
                            sizes="56px"
                            className="object-cover"
                          />
                        )}
                      </span>
                    ))}
                </div>
              )}
              <a
                href={href(`/day/${selected.entries[0].slug}`)}
                className="mt-2 inline-block text-sm font-semibold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
              >
                {t("map.readDay")} →
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Proportional to dates, not to stop order — a five-month trip and a
          five-day one both read correctly (docs/plans/map-redesign.md §1
          "Time", Phase 2 item 3). Defaults to the most recent stop when
          nothing is selected yet, the same "here now" instinct `hereNow`
          draws on the map itself. Reuses `selectPlace`/`focusOnStop` rather
          than holding a second notion of what is selected.

          Desktop only (`hidden lg:block`) — B2427's mobile sheet puts its
          own copy of this same component in its peek snap on a phone, so a
          second one here would be drawn twice on the same screen. */}
      {plottable.length > 0 && (
        <div className="hidden lg:block">
          <TimeScrubber
            stops={plottable.map((p) => ({ key: p.key, date: p.firstDate, location: p.location }))}
            selectedIndex={selected ? (orderByKey.get(selected.key) ?? 1) - 1 : plottable.length - 1}
            live={live}
            onSelect={(i) => {
              const place = plottable[i];
              selectPlace(place);
              if (scope === "stop") focusOnStop(place);
            }}
          />
        </div>
      )}
    </div>
  );
}
