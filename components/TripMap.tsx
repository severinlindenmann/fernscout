"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  frameRoute,
  frameSpanKm,
  place as placeIn,
  type Frame,
} from "@/lib/mapFrame";
import { mediaLoader } from "./mediaLoader";
import { MAP_VIEWBOX } from "@/lib/mapProjection";
import {
  areaKey,
  clusterStops,
  googleMapsHref,
  scaleBar,
  tripStops,
  type StopSource,
  type TripStop,
} from "@/lib/tripMap";
import { flagFor } from "@/lib/flags";
import GoogleMark from "./GoogleMark";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import { useMapViewport } from "./map/useMapViewport";
import StopMarker from "./map/StopMarker";
import ClusterMarker from "./map/ClusterMarker";
import PhotoMarker from "./map/PhotoMarker";
import StopCarousel from "./map/StopCarousel";
import HereNow from "./map/HereNow";
import RouteLine, { type RouteHop } from "./map/RouteLine";
import LegChip from "./map/LegChip";
import MapControls from "./map/MapControls";
import StopScopeSwitch from "./map/StopScopeSwitch";
import { mapStyle, mapAccent } from "@/lib/map/style";
import type { Basemap } from "@/lib/basemap";
import type { TripAccent } from "@/lib/types";

/**
 * The trip's map, under the hero: where this was, at the scale it needs.
 *
 * It replaces `MiniMap`, which drew the route as a dashed line and a pulsing
 * yellow dot on an unlabelled field and was `aria-hidden` — a picture of a
 * lake that named neither the lake nor the town nor the country, on a page
 * whose whole subject is where somebody went (B1911).
 *
 * Two views, because one frame cannot serve both a trip across a canton and a
 * trip across a continent: **the whole trip** auto-fits every stop the reader
 * is allowed to see, and **the surroundings** frames the selected one at town
 * scale. Selection survives the switch, and the Google Maps link follows the
 * selected stop rather than whatever the viewport happens to be centred on.
 *
 * Restyled onto the Paper primitives for B2421 (Phase 1 item 1 of
 * docs/plans/map-redesign.md): numbered `StopMarker`/`ClusterMarker` discs,
 * a straight `RouteLine` in the trip's own accent, a `LegChip` per leg with
 * a known transport mode, and `HereNow` — yellow, and yellow alone — drawn
 * only when the caller says the trip is live. What it deliberately still
 * does not do: pulse (a documented stop is not a live fix — `HereNow` itself
 * carries no animation either), claim a route where none was recorded (a
 * straight or flight-arc hop is a connection, not a road), or capture the
 * page's scrolling on a phone.
 */
export default function TripMap({
  days,
  basemap = null,
  locals,
  track = [],
  tripTrack = [],
  accent = "navy",
  live = false,
  onRequestFullscreen,
}: {
  /** The reader-filtered day summaries — see `tripStops`. */
  days: readonly StopSource[];
  /** Clipped to the whole trip's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
  /**
   * One clipped basemap per stop area, keyed by `areaKey`, so that switching
   * a long trip to one town shows that town's water, borders and neighbours
   * rather than a magnified continent. Missing keys fall back to the trip's
   * own basemap, which is correct wherever the trip is small enough that the
   * overview clip already covers the town.
   */
  locals?: Record<string, Basemap>;
  /**
   * The recorded route for one day — B2199. `readerTrack`'s segments for the
   * day this permalink names, already filtered server-side to what this
   * reader may see. Drawn the same weight `WorldMap` draws the trip's own
   * line (navy, 70% opacity, 2.2px, `docs/gps.md`), and never used to size
   * the frame: the frame stays `frameRoute(stops)` so a day trip nobody
   * wrote up cannot zoom the whole map out to fit itself.
   */
  track?: [number, number][][];
  /**
   * The whole trip's own recorded line — `readerTrack`'s segments across
   * every date this reader may see (the same shape `WorldMap`'s own `track`
   * prop already takes). B2421: when present, this is drawn in the trip's
   * accent with the route's white casing and the stop-to-stop hops are not
   * drawn at all — a recorded line is a truer route than a straight guess
   * between two stops. Absent (no example journal has one yet) keeps the
   * hop connections below.
   */
  tripTrack?: [number, number][][];
  /** The colour the owner chose for this trip — `Trip["accent"]`, read by
   * the caller from `useTrip()`. Defaults to navy, the same "no preference"
   * fallback the map's own controls and selection already draw in — a
   * `TripMap` rendered without a `TripProvider` (every test here) still has
   * an accent to draw the route in. */
  accent?: TripAccent;
  /** Whether this trip is currently happening — `!over` in `TripHero`. Turns
   * on `HereNow`, and only `HereNow`: a selection is never this colour,
   * whatever it is. Defaults to false, so a caller that forgets it draws no
   * claim about right now rather than a wrong one. */
  live?: boolean;
  /**
   * What a single tap on this map does — nothing yet opens a full-screen
   * view (that is Phase 2, docs/plans/map-redesign.md), so this is absent
   * until a caller has one to hand over.
   */
  onRequestFullscreen?: () => void;
}) {
  const { t, formatShortDate } = useI18n();
  // The 1:110m coastline, fetched after the page is readable — all a checkout
  // that never ran `build:mapdata` has to draw land with. Better than an
  // all-water panel at continental width; at town scale it says nothing, and
  // the clean ground it leaves is the right answer there (lib/basemap.ts).
  const worldLand = useWorldLand();
  const stops = useMemo(() => tripStops(days), [days]);
  const orderOf = useMemo(() => new Map(stops.map((s, i) => [s.key, i + 1])), [stops]);

  // One stop is not an overview of anything: it opens where it is. Both
  // controls stay, and whole-trip bounds are then the same town-scale frame.
  const [view, setView] = useState<"whole" | "local">(
    stops.length > 1 ? "whole" : "local",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Nothing chosen yet is the *last* stop, not the first: the default
  // selection is where the trip got to. The arrows step from there, so this
  // index has to agree with the panel rather than start at zero.
  const found = stops.findIndex((s) => s.key === selectedKey);
  const index = found >= 0 ? found : stops.length - 1;
  const selected = stops[index];
  // Which of the two statuses the panel shows. The default selection is the
  // latest documented stop, and saying "selected" about a place nobody
  // selected would be a small lie about how it got there.
  const chosen = selectedKey !== null;

  const whole = useMemo(() => frameRoute(stops), [stops]);
  const local = useMemo(() => (selected ? frameRoute([selected]) : whole), [selected, whole]);
  const base = view === "local" ? local : whole;

  const maxZoom = useMemo(
    () => Math.min(64, Math.max(4, frameSpanKm(base) / 2)),
    [base],
  );

  /**
   * "Town zoom and closer" (Phase 2, item 5 of docs/plans/map-redesign.md):
   * the same span `frameRoute`'s own `MIN_SPAN_KM` floor already gives one
   * stop's "surroundings" frame (`local`, above) — not a new constant, so a
   * marker switching to a photo agrees with what the "This stop" button
   * already calls town scale. `local` is built from `selected` alone, so
   * this is the same threshold whichever stop happens to be selected.
   */
  const townSpanKm = useMemo(() => frameSpanKm(local), [local]);

  /**
   * How large the map is actually being drawn, in CSS pixels.
   *
   * Set after mount and never during the server render: the initial value has
   * to be identical on both sides or every size derived from it is a
   * hydration mismatch. 600 x 375 is the 1.6 shape `frameRoute` targets, so
   * the first paint is already the right one; a phone corrects it on the
   * first frame.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drawn, setDrawn] = useState({ w: 600, h: 375 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDrawn({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pan/zoom state and gesture handling — pinch, wheel, double-tap, keyboard
  // — shared with `WorldMap` (B2419). Cooperative: this map sits under the
  // hero on a phone, so one finger has to keep scrolling the page.
  const viewport = useMapViewport({
    svgRef,
    maxZoom,
    cooperative: true,
    onRequestFullscreen,
  });
  const { zoom, pan } = viewport;

  /**
   * The frame actually drawn: the base, grown to the panel's shape, divided
   * by the zoom, moved by the pan.
   *
   * Grown rather than cropped, and grown here rather than in `frameRoute`,
   * because the panel is 3:2 on a phone and 2:1 on a desktop while the route
   * is whatever shape it is. Letting the viewBox keep its own aspect and
   * slicing would cut stops off the edge of a frame that was computed to
   * contain them; growing the short axis to the panel keeps every stop inside
   * at either width.
   *
   * Derived rather than stored, so a rerender — a resize, a locale change,
   * the parent re-rendering for its own reasons — cannot snap a reader's
   * exploration back to the automatic bounds. Only the handlers below reset
   * it, and they are the explicit actions the ticket names.
   */
  const frame: Frame = useMemo(() => {
    const aspect = drawn.w / drawn.h;
    let w = base.w;
    let h = base.h;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    w /= zoom;
    h /= zoom;
    return {
      x: base.x + base.w / 2 - w / 2 + pan.x,
      y: base.y + base.h / 2 - h / 2 + pan.y,
      w,
      h,
      lngScale: base.lngScale,
    };
  }, [base, zoom, pan, drawn]);
  // Kept for gesture handlers that fire between renders (a pinch, a wheel
  // tick) — an effect, not a call in the render body, so nothing here ever
  // mutates a ref while rendering.
  useEffect(() => {
    viewport.syncFrame(frame);
  }, [viewport, frame]);

  /** Whether the reader is zoomed at least to town scale right now — see
   * `townSpanKm` above. */
  const showPhotos = frameSpanKm(frame) <= townSpanKm;

  // Sizes in screen pixels, not viewBox units: a frame is 4 units across for
  // one trip and 900 for another, so a constant radius is a dot on one map
  // and larger than the other entirely. The lesson MiniMap and WorldMap both
  // carry at length.
  const px = useCallback(
    (pixels: number) => (pixels * frame.w) / drawn.w,
    [frame.w, drawn.w],
  );

  const refit = viewport.reset;

  /** Whether the reader has moved the map away from its automatic bounds. */
  const moved = viewport.moved;

  /**
   * The list, and the row in it that is selected.
   *
   * The selected stop is the last one by default, so on an eighteen-stop trip
   * the row that carries the place and its outbound link starts fourteen rows
   * below the fold — present in the markup and invisible to the reader. This
   * brings it into the box on mount and after every step.
   *
   * The box's own `scrollTop`, deliberately, rather than `scrollIntoView`:
   * that method walks up to every scrollable ancestor, so a card doing this on
   * mount would scroll the page out from under somebody reading the day above
   * it.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const selectedRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const box = listRef.current;
    const row = selectedRow.current;
    if (!box || !row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
    }
  }, [selectedKey, index]);

  /** Zoom a step toward a point — what tapping a group of merged stops does. */
  const closer = useCallback(
    (x: number, y: number) => {
      viewport.setZoom((z) => Math.min(maxZoom, z * 2));
      viewport.setPan({ x: x - (base.x + base.w / 2), y: y - (base.y + base.h / 2) });
    },
    [base, maxZoom, viewport],
  );

  const select = useCallback(
    (stop: TripStop) => {
      setSelectedKey(stop.key);
      // In the overview the bounds are the whole trip and stay put; in the
      // surroundings the frame *is* the selected place, so it refits.
      if (view === "local") refit();
    },
    [view, refit],
  );

  /** One stop along the trip, stopping at either end. */
  const step = useCallback(
    (by: number) => {
      const next = stops[index + by];
      if (next) select(next);
    },
    [stops, index, select],
  );

  const show = useCallback(
    (next: "whole" | "local") => {
      setView(next);
      refit();
    },
    [refit],
  );

  if (!selected) return null;

  const ground = (view === "local" ? locals?.[areaKey(selected)] : null) ?? basemap;

  // A route unwrapped across the antimeridian frames past the canvas's right
  // edge (lib/mapFrame.ts), where the baked geometry has nothing. A second
  // copy of the ground one world to the east is what fills it.
  const worldWidth = MAP_VIEWBOX.width * base.lngScale;
  const wrapped = frame.x + frame.w > worldWidth;

  const bar = scaleBar(frame);
  /**
   * Whether a stop's name would run off the right-hand edge if it were drawn
   * in the usual place.
   *
   * The marker's position is not enough on its own: "Parque das Nações" is
   * five times the width of "Belém" and ran off a phone from the middle of the
   * map. Roughly 0.55 em per character is close enough for a threshold.
   */
  const runsOff = (x: number, name: string) =>
    x + px(13) + px(13) * 0.62 * name.length > frame.x + frame.w;
  const points = stops.map((s) => placeIn(frame, s));

  /**
   * Stops grouped by where they land, so that a long trip is a readable map
   * rather than two hundred overlapping dots — and so that the page's markup
   * does not grow a marker per day (`test/payload.test.tsx`). Zooming in
   * separates them; every stop stays reachable by name below the map.
   */
  const clusters = clusterStops(stops, (s) => placeIn(frame, s), px(9), selected.key);

  /**
   * Which stop names are drawn on the map itself.
   *
   * The selected one always; the rest only where the text would not land on
   * another name. `basemapFor` spreads its town labels on the same principle
   * and for the same reason: two names across each other are worse than one
   * name and a marker.
   */
  const apartX = frame.w * 0.24;
  const apartY = frame.h * 0.08;
  const taken: [number, number][] = [placeIn(frame, selected)];
  const labelled = new Set<string>([selected.key]);
  for (const cluster of clusters) {
    if (cluster.stops.length > 1 || labelled.has(cluster.stops[0].key)) continue;
    if (taken.some(([tx, ty]) => Math.abs(tx - cluster.x) < apartX && Math.abs(ty - cluster.y) < apartY))
      continue;
    taken.push([cluster.x, cluster.y]);
    labelled.add(cluster.stops[0].key);
  }

  const href = googleMapsHref(selected);
  const status = t(chosen ? "tripMap.selectedPlace" : "tripMap.lastPlace");

  /**
   * The stop-to-stop hops, one per leg between two distinct *clusters* —
   * the trip's accent route when there is no recorded track.json. Built
   * from `clusters`, not from every raw stop, and de-duplicated by the pair
   * of positions it connects: a trip that returns to the same town on day
   * 50 that it left on day 9 draws that one connection once, the same way
   * `clusters` itself already draws the town once rather than once per
   * visit (`test/payload.test.tsx` — the reason the marker count is bounded
   * is exactly the reason this has to be too, or a two-hundred-day loop
   * turns two hundred hops and two hundred `LegChip`s back into what
   * clustering was built to avoid). A hop within one cluster (nothing moved
   * on screen) is dropped rather than drawn as a zero-length line.
   *
   * The leg's mode is the *arriving* stop's own `transport` (B2199's
   * `dayTrack` doc explains the same "arriving leg" convention
   * `DaySummary.transport` already carries), which is what turns a flight
   * leg into `RouteLine`'s one arced exception (Q1,
   * docs/plans/map-redesign.md §7) — every other leg stays straight.
   *
   * ponytail: the dedupe key is the position pair alone, not the mode, so a
   * connection travelled by different transport on different visits keeps
   * whichever mode it first carried rather than growing a second chip on
   * the same line — the same bound `test/payload.test.tsx` already holds
   * the marker count to, applied to the one other thing that was scaling
   * with visits rather than with places.
   */
  const clusterPos = new Map<string, [number, number]>();
  for (const cluster of clusters) {
    for (const stop of cluster.stops) clusterPos.set(stop.key, [cluster.x, cluster.y]);
  }
  const seenHops = new Set<string>();
  const hops: RouteHop[] = [];
  const legChips: { hop: RouteHop; mode: NonNullable<TripStop["transport"]>["mode"] }[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = clusterPos.get(stops[i].key);
    const to = clusterPos.get(stops[i + 1].key);
    if (!from || !to) continue;
    const [x1, y1] = from;
    const [x2, y2] = to;
    if (x1 === x2 && y1 === y2) continue; // nothing moved on screen
    const key = `${x1},${y1}-${x2},${y2}`;
    if (seenHops.has(key)) continue;
    seenHops.add(key);
    const mode = stops[i + 1].transport?.mode;
    const hop: RouteHop = { x1, y1, x2, y2, mode };
    hops.push(hop);
    // A leg's own transport chip, at the midpoint of the *straight*
    // stop-to-stop connection regardless of whether the line drawn
    // underneath is a hop or the real track — the chip names one leg's
    // transport, a fact about the days on either side of it, not about
    // which line happens to be on screen.
    //
    // ponytail: the flight-arc leg's chip still sits on the straight
    // midpoint rather than the arc's own peak — a cosmetic gap on the one
    // mode that arcs, not a wrong fact; move it onto `RouteLine`'s own
    // midpoint if that ever reads as wrong in a screenshot.
    if (mode) legChips.push({ hop, mode });
  }

  /**
   * The whole trip's recorded line, broken into the same straight
   * `RouteHop` shape `RouteLine` already draws stop-to-stop hops with — a
   * real GPS track is never arced, so every point pair here is a plain
   * hop. Segments are drawn independently: nothing joins the end of one
   * segment to the start of the next, the same gap `WorldMap` leaves for a
   * day nobody recorded between two recorded ones.
   */
  const trackHops: RouteHop[] = tripTrack.flatMap((segment) =>
    segment.slice(0, -1).map(([lat1, lng1], i) => {
      const [lat2, lng2] = segment[i + 1];
      const [x1, y1] = placeIn(frame, { lat: lat1, lng: lng1 });
      const [x2, y2] = placeIn(frame, { lat: lat2, lng: lng2 });
      return { x1, y1, x2, y2 };
    }),
  );
  const hasTrack = trackHops.length > 0;

  /** The very latest stop — "where the trip got to", independent of
   * whatever is currently selected. `HereNow` marks *this* one and only
   * this one: selecting an earlier stop must not move the live claim onto
   * it. */
  const latest = stops[stops.length - 1];

  return (
    <section className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised shadow-sm">
      {/* One row, always. Wrapped, the title and the switch cost 104 px of a
          390 px phone; the title gives way instead, because the card it
          names is directly underneath it. B1944. */}
      <div className="flex items-center justify-between gap-3 px-4 py-1.5">
        {/* Truncated to "The trip on th…" at 390 px, which is worse than not
            being there — the switch and the map underneath say what this
            is. Kept for anyone reading the page rather than looking at it. */}
        <h2 className="sr-only font-display text-base font-semibold text-ink-strong sm:not-sr-only">
          {t("tripMap.title")}
        </h2>
        <div className="ml-auto sm:ml-0">
          <StopScopeSwitch
            scope={view === "whole" ? "trip" : "stop"}
            onChange={(next) => show(next === "trip" ? "whole" : "local")}
          />
        </div>
      </div>

      <div className="relative aspect-[5/4] w-full border-y border-line-quiet bg-surface-raised sm:aspect-[2/1]">
        {/* role="group", not "img": the markers below are focusable, and an
            img makes every descendant presentational. */}
        <svg
          ref={svgRef}
          viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          className="block h-full w-full outline-none"
          style={{ touchAction: viewport.touchAction, backgroundColor: mapStyle.sea }}
          role="group"
          aria-label={`${t("tripMap.title")} — ${selected.location}, ${selected.country}`}
          {...viewport.bind}
        >
          {[0, ...(wrapped ? [worldWidth] : [])].map((offset) => (
            <g key={offset} transform={`translate(${offset} 0) scale(${base.lngScale} 1)`}>
              {ground ? (
                <>
                  {/* Relief shading was Option B, "Relief" (docs/plans/map-
                      redesign.md's intro) — considered for the whole
                      redesign and not the one taken, so it is not drawn
                      here either. */}
                  <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1}>
                    {ground.borders.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <g fill="none" stroke={mapStyle.borderInternal} strokeWidth={0.8} strokeDasharray="3 3">
                    {ground.admin1.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <g fill={mapStyle.water} stroke="none">
                    {ground.lakes.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                  <g fill="none" stroke={mapStyle.water} strokeWidth={1.4} strokeLinecap="round">
                    {ground.rivers.map((d, i) => (
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
          ))}

          {/* Context names: countries at range, towns regionally. Quiet on
              purpose — they orient the reader behind the trip rather than
              competing with the places somebody actually wrote about. */}
          {ground && (
            <g pointerEvents="none">
              {/* A town whose name would be cut by the edge is left unnamed.
                  `basemapFor` insets its own candidates, but against the frame
                  the server clipped for — this map grows that frame to the
                  panel's shape and then zooms it, so the edge moves and the
                  inset has to be applied again here. */}
              {ground.towns
                .filter((town) => !runsOff(town.x, town.name))
                .map((town) => (
                <g key={`town-${town.name}-${town.x}`}>
                  <circle cx={town.x} cy={town.y} r={px(2.5)} fill={mapStyle.border} />
                  <text
                    x={town.x + px(5)}
                    y={town.y + px(4)}
                    fontSize={px(11)}
                    fill={mapStyle.labelTown}
                    className="font-display"
                  >
                    {town.name}
                  </text>
                  </g>
                ))}
            </g>
          )}

          {/* The ground actually covered that day — B2199. Under the route
              and the markers, same as `WorldMap` draws the whole trip's
              line under its own markers. */}
          {track.length > 0 && (
            <g pointerEvents="none" fill="none" stroke={mapStyle.plannedLeg} opacity={0.7}>
              {track.map((segment, i) => (
                <path
                  key={i}
                  d={segment
                    .map(
                      ([lat, lon], j) =>
                        `${j === 0 ? "M" : "L"}${placeIn(frame, { lat, lng: lon }).join(",")}`,
                    )
                    .join(" ")}
                  strokeWidth={px(2.2)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          )}

          {/* The trip's own route: the recorded line when there is one —
              hops are not drawn alongside it — otherwise a straight (or,
              for a flight, gently arced) connection between stops. B2421,
              Q1/§1 of docs/plans/map-redesign.md. */}
          {hasTrack ? (
            <RouteLine hops={trackHops} accent={accent} px={px} />
          ) : (
            points.length > 1 && <RouteLine hops={hops} accent={accent} px={px} />
          )}

          {legChips.length > 0 && (
            <g className="fs-map-pin">
              {legChips.map(({ hop, mode }, i) => (
                <LegChip
                  key={i}
                  x={(hop.x1 + hop.x2) / 2}
                  y={(hop.y1 + hop.y2) / 2}
                  mode={mode}
                  px={px}
                />
              ))}
            </g>
          )}

          <g className="fs-map-pin">
            {clusters.map((cluster) => {
              const stop = cluster.stops[0];
              const many = cluster.stops.length > 1;
              const isSelected = !many && stop.key === selected.key;
              const label = many
                ? `${cluster.stops.length} ${t("map.places")}`
                : `${stop.location}, ${stop.country}`;
              const onSelect = () => (many ? closer(cluster.x, cluster.y) : select(stop));
              // A photo marker only once zoomed to town scale, only for a
              // single stop (a merged cluster stays numbered dots — the
              // photo names one place, not a group of them), and only when
              // this reader-filtered stop actually carries a photo (privacy
              // note above `StopSource.photo`/`DaySummary.photo`).
              const photoSrc =
                !many && showPhotos && stop.photo
                  ? mediaLoader({ src: stop.photo.src, width: 160 })
                  : null;
              return (
                <g key={stop.key}>
                  {many ? (
                    <ClusterMarker
                      x={cluster.x}
                      y={cluster.y}
                      count={cluster.stops.length}
                      ariaLabel={label}
                      px={px}
                      onSelect={onSelect}
                    />
                  ) : photoSrc ? (
                    <PhotoMarker
                      x={cluster.x}
                      y={cluster.y}
                      src={photoSrc}
                      order={orderOf.get(stop.key) ?? 1}
                      selected={isSelected}
                      ariaLabel={label}
                      px={px}
                      onSelect={onSelect}
                    />
                  ) : (
                    <StopMarker
                      x={cluster.x}
                      y={cluster.y}
                      order={orderOf.get(stop.key) ?? 1}
                      selected={isSelected}
                      ariaLabel={label}
                      px={px}
                      onSelect={onSelect}
                    />
                  )}
                  {!many && labelled.has(stop.key) && (
                    <text
                      // A name is drawn to the right of its marker, and a
                      // marker in the last eighth of the frame would run it
                      // off the edge — so that one is drawn to the left
                      // instead. `basemapFor` insets its own labels for the
                      // same reason; a stop cannot be dropped the way a town
                      // can, so it turns round instead.
                      x={cluster.x + (runsOff(cluster.x, stop.location) ? -px(16) : px(16))}
                      textAnchor={runsOff(cluster.x, stop.location) ? "end" : "start"}
                      y={cluster.y + px(5)}
                      fontSize={px(isSelected ? 14 : 12)}
                      fontWeight={isSelected ? 700 : 600}
                      fill={mapStyle.labelStop}
                      pointerEvents="none"
                      className="font-display"
                      // The halo, so a name stays readable over water or the
                      // route without a box behind it.
                      stroke={mapStyle.labelStopHalo}
                      strokeWidth={px(3)}
                      paintOrder="stroke"
                    >
                      {stop.location}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Yellow means "a trip is live" and nothing else on this map —
              never drawn for a finished trip, and never at wherever the
              reader happens to have selected. */}
          {live && latest && (
            <HereNow
              x={placeIn(frame, latest)[0]}
              y={placeIn(frame, latest)[1]}
              px={px}
              label={t("map.hereNow")}
            />
          )}

          {/* Scale bar: how far across the *viewport* is, which is not how far
              anybody travelled.

              Top left, which is the one corner nothing else wants: the caption
              holds the bottom left, and `MapControls` holds the top right.
              B1944. */}
          <g pointerEvents="none" transform={`translate(${frame.x + frame.w * 0.04 + bar.units} ${frame.y + frame.h * 0.12})`}>
            <line
              x1={-bar.units}
              y1={0}
              x2={0}
              y2={0}
              stroke={mapStyle.labelStop}
              strokeWidth={px(2)}
              strokeLinecap="round"
            />
            <text
              x={-bar.units / 2}
              y={-px(6)}
              fontSize={px(11)}
              fill={mapStyle.labelStop}
              textAnchor="middle"
              className="font-display"
              stroke={mapStyle.labelStopHalo}
              strokeWidth={px(3)}
              paintOrder="stroke"
            >
              ≈ {bar.km < 1 ? `${bar.km * 1000} m` : `${bar.km} km`}
            </text>
          </g>
        </svg>

        {/* Zoom, fit and full screen — the one control column every map
            surface draws from (`MapControls`, Phase 0). Top right on every
            width: `MapControls` is 44 px round buttons in one fixed column,
            and the caption below holds the one corner it does not. */}
        <div className="absolute right-2 top-2">
          <MapControls
            onZoomIn={() => viewport.setZoom((z) => Math.min(maxZoom, z * 1.6))}
            onZoomOut={() => viewport.setZoom((z) => Math.max(1, z / 1.6))}
            // Absent until there is something to reset — a control for a
            // state nobody is in is furniture.
            onFit={moved ? refit : undefined}
            onFullscreen={onRequestFullscreen}
          />
        </div>

        {/* On the map rather than under it, and on its own quiet ground: the
            sentence has to be next to the line it is about, and cream text
            laid straight onto a cream basemap is not readable. */}
        <p className="pointer-events-none absolute bottom-2 left-2 max-w-[65%] rounded-md bg-cream-50/85 px-1.5 py-0.5 text-[11px] leading-tight text-navy-900">
          {t(hasTrack ? "tripMap.recorded" : "tripMap.connections")}
        </p>
      </div>

      {/* Every stop, reachable without a pointer on a map — and the readable
          alternative to the drawing for anyone who cannot see it.

          A list rather than the chip run it replaces: eighteen stops were
          3,011 px of horizontal scrolling in a 356 px window, a row can carry
          the date a chip could not, and the selected one opens here rather
          than in a second panel that named the same place again. B1944. */}
      <ul
        ref={listRef}
        // Three rows and the open one, then it scrolls: a bounded height is
        // what keeps an eighteen-day trip and a hundred-and-eighty-day trip
        // the same size on the page. Rows stay 44 px — the touch minimum is
        // not what gives way here.
        className="max-h-44 list-none overflow-y-auto px-2 py-1 sm:max-h-80"
        aria-label={t("tripMap.title")}
      >
        {stops.map((stop, i) => {
          const isSelected = stop.key === selected.key;
          return (
            <li key={stop.key} ref={isSelected ? selectedRow : undefined}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => select(stop)}
                className={`flex w-full min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-surface-selected font-semibold text-ink-strong"
                    : "text-ink-body hover:text-ink-strong"
                }`}
              >
                <span className="truncate">{stop.location}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-secondary">
                  {formatShortDate(stop.date)}
                </span>
              </button>
              {isSelected && (
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-selected px-3 pb-2 text-xs text-ink-body">
                  <span>
                    {selected.country && (
                      <>
                        {flagFor(selected.country, selected.countryCode)} {selected.country} ·{" "}
                      </>
                    )}
                    {t("tripMap.stopOf", {
                      index: String(i + 1),
                      count: String(stops.length),
                    })}
                  </span>
                  {/* Google's mark carries what the words used to say, and the
                      accessible name still says all of it. */}
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t("tripMap.googleMaps")}: ${selected.location} — ${t("tripMap.googleMapsHelp")}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-yellow-400 px-3 text-sm font-semibold text-navy-900 transition-colors hover:bg-yellow-300"
                  >
                    <GoogleMark />
                    {t("tripMap.mapsShort")}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Where in the trip, and the two arrows that walk it. They are down
          here rather than in a rail beside the rows because the rail and the
          outbound button were fighting over the same 40 px. */}
      <div className="flex items-center justify-between gap-3 border-t border-line-quiet px-4 py-1.5">
        <span className="min-w-0 truncate text-xs text-ink-secondary">
          {status} ·{" "}
          {t("tripMap.stopOf", {
            index: String(index + 1),
            count: String(stops.length),
          })}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <MapButton
            label={t("tripMap.previousStop")}
            onClick={() => step(-1)}
            disabled={index === 0}
          >
            <ChevronUp className="h-4 w-4" />
          </MapButton>
          <MapButton
            label={t("tripMap.nextStop")}
            onClick={() => step(1)}
            disabled={index === stops.length - 1}
          >
            <ChevronDown className="h-4 w-4" />
          </MapButton>
        </div>
      </div>
    </section>
  );
}

function MapButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  /** An arrow at the end of the trip — still announced, not still pressable. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-quiet bg-surface-raised/95 text-ink-body shadow-sm transition-colors hover:bg-surface-raised hover:text-ink-strong disabled:opacity-40 disabled:hover:bg-surface-raised/95"
    >
      {children}
    </button>
  );
}
