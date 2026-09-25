"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Minus, Plus, RotateCcw } from "lucide-react";
import {
  frameRoute,
  frameSpanKm,
  place as placeIn,
  type Frame,
} from "@/lib/mapFrame";
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
import type { Basemap } from "@/lib/basemap";

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
 * What it deliberately does not do: pulse (a documented stop is not a live
 * fix), claim a route (the dashes join stops, they do not trace a road), or
 * capture the page's scrolling on a phone.
 */
export default function TripMap({
  days,
  basemap = null,
  locals,
  track = [],
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
   * line (navy-500, 70% opacity, 2.2px, `docs/gps.md`), and never used to
   * size the frame: the frame stays `frameRoute(stops)` so a day trip nobody
   * wrote up cannot zoom the whole map out to fit itself.
   */
  track?: [number, number][][];
}) {
  const { t, formatShortDate } = useI18n();
  // The 1:110m coastline, fetched after the page is readable — all a checkout
  // that never ran `build:mapdata` has to draw land with. Better than an
  // all-water panel at continental width; at town scale it says nothing, and
  // the clean ground it leaves is the right answer there (lib/basemap.ts).
  const worldLand = useWorldLand();
  const stops = useMemo(() => tripStops(days), [days]);

  // One stop is not an overview of anything: it opens where it is. Both
  // controls stay, and whole-trip bounds are then the same town-scale frame.
  const [view, setView] = useState<"whole" | "local">(
    stops.length > 1 ? "whole" : "local",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

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

  // Sizes in screen pixels, not viewBox units: a frame is 4 units across for
  // one trip and 900 for another, so a constant radius is a dot on one map
  // and larger than the other entirely. The lesson MiniMap and WorldMap both
  // carry at length.
  const px = useCallback(
    (pixels: number) => (pixels * frame.w) / drawn.w,
    [frame.w, drawn.w],
  );

  const refit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /** Whether the reader has moved the map away from its automatic bounds. */
  const moved = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

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
      setZoom((z) => Math.min(maxZoom, z * 2));
      setPan({ x: x - (base.x + base.w / 2), y: y - (base.y + base.h / 2) });
    },
    [base, maxZoom],
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

  // Mouse drag only. `touch-none` would hand every finger on the map to the
  // pan handler, and on a phone this card is most of the screen — the page
  // would stop scrolling where the map is.
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

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

  return (
    <section className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised shadow-sm">
      {/* One row, always. Wrapped, the title and these two buttons cost 104 px
          of a 390 px phone; the title gives way instead, because the card it
          names is directly underneath it. B1944. */}
      <div className="flex items-center justify-between gap-3 px-4 py-1.5">
        {/* Truncated to "The trip on th…" at 390 px, which is worse than not
            being there — the two buttons and the map underneath say what this
            is. Kept for anyone reading the page rather than looking at it. */}
        <h2 className="sr-only font-display text-base font-semibold text-ink-strong sm:not-sr-only">
          {t("tripMap.title")}
        </h2>
        <div className="ml-auto flex gap-2 sm:ml-0">
          <ViewButton active={view === "whole"} onClick={() => show("whole")}>
            {t("tripMap.whole")}
          </ViewButton>
          <ViewButton active={view === "local"} onClick={() => show("local")}>
            {t("tripMap.local")}
          </ViewButton>
        </div>
      </div>

      <div className="relative aspect-[5/4] w-full border-y border-line-quiet bg-sky-300 sm:aspect-[2/1]">
        {/* role="group", not "img": the markers below are focusable, and an
            img makes every descendant presentational. */}
        <svg
          ref={svgRef}
          viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          className="block h-full w-full"
          role="group"
          aria-label={`${t("tripMap.title")} — ${selected.location}, ${selected.country}`}
          onPointerDown={(e) => {
            if (e.pointerType === "touch") return;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const scale = frame.w / rect.width;
            setPan({
              x: d.panX - (e.clientX - d.x) * scale,
              y: d.panY - (e.clientY - d.y) * scale,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerLeave={() => {
            drag.current = null;
          }}
        >
          {[0, ...(wrapped ? [worldWidth] : [])].map((offset) => (
            <g key={offset} transform={`translate(${offset} 0) scale(${base.lngScale} 1)`}>
              {ground ? (
                <>
                  <g fill="#fdf3e0" stroke="#c9b48c" strokeWidth={1}>
                    {ground.borders.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <g fill="#e8dcc0" opacity={0.45} stroke="none">
                    {ground.relief.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </g>
                  <g fill="none" stroke="#dbc9a4" strokeWidth={0.8} strokeDasharray="3 3">
                    {ground.admin1.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <g fill="#8fe0ef" stroke="#6fcfe0" strokeWidth={0.8}>
                    {ground.lakes.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <g fill="none" stroke="#8fe0ef" strokeWidth={1.4} strokeLinecap="round">
                    {ground.rivers.map((d, i) => (
                      <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                </>
              ) : (
                <g fill="#fdf3e0" stroke="#c9b48c" strokeWidth={1}>
                  {worldLand.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              )}
            </g>
          ))}

          {/* Context names: countries at range, towns and water regionally.
              Quiet on purpose — they orient the reader behind the trip rather
              than competing with the places somebody actually wrote about. */}
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
                  <circle cx={town.x} cy={town.y} r={px(2.5)} fill="#a89878" />
                  <text
                    x={town.x + px(5)}
                    y={town.y + px(4)}
                    fontSize={px(11)}
                    fill="#6b6152"
                    className="font-display"
                  >
                    {town.name}
                  </text>
                  </g>
                ))}
            </g>
          )}

          {/* The ground actually covered that day — B2199. Under the dashed
              connection and the markers, same as `WorldMap` draws the whole
              trip's line under its own markers. */}
          {track.length > 0 && (
            <g pointerEvents="none" fill="none" stroke="#5a6a80" opacity={0.7}>
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

          {points.length > 1 && (
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="#1e293b"
              strokeOpacity={0.35}
              strokeWidth={px(2)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${px(6)} ${px(6)}`}
            />
          )}

          <g className="fs-map-pin">
            {clusters.map((cluster) => {
              const stop = cluster.stops[0];
              const many = cluster.stops.length > 1;
              const isSelected = !many && stop.key === selected.key;
              return (
                <g
                  key={stop.key}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    many
                      ? `${cluster.stops.length} ${t("map.places")}`
                      : `${stop.location}, ${stop.country}`
                  }
                  aria-pressed={many ? undefined : isSelected}
                  onClick={() => (many ? closer(cluster.x, cluster.y) : select(stop))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (many) closer(cluster.x, cluster.y);
                    else select(stop);
                  }}
                >
                  <circle
                    cx={cluster.x}
                    cy={cluster.y}
                    r={px(many ? 11 : isSelected ? 9 : 7)}
                    fill={many ? "#fff3dc" : isSelected ? "#ffd23f" : "#fffaf0"}
                    stroke="#1e293b"
                    strokeWidth={px(2.5)}
                  />
                  {many ? (
                    <text
                      x={cluster.x}
                      y={cluster.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={px(11)}
                      fontWeight={700}
                      fill="#1e293b"
                      pointerEvents="none"
                    >
                      {cluster.stops.length}
                    </text>
                  ) : (
                    labelled.has(stop.key) && (
                      <text
                        // A name is drawn to the right of its marker, and a
                        // marker in the last eighth of the frame would run it
                        // off the edge — so that one is drawn to the left
                        // instead. `basemapFor` insets its own labels for the
                        // same reason; a stop cannot be dropped the way a town
                        // can, so it turns round instead.
                        x={cluster.x + (runsOff(cluster.x, stop.location) ? -px(13) : px(13))}
                        textAnchor={runsOff(cluster.x, stop.location) ? "end" : "start"}
                        y={cluster.y + px(5)}
                        fontSize={px(isSelected ? 14 : 12)}
                        fontWeight={isSelected ? 700 : 600}
                        fill="#1e293b"
                        pointerEvents="none"
                        className="font-display"
                        // The halo, so a name stays readable over water, relief
                        // or a dashed connection without a box behind it.
                        stroke="#fffaf0"
                        strokeWidth={px(3)}
                        paintOrder="stroke"
                      >
                        {stop.location}
                      </text>
                    )
                  )}
                  {/* A thumb is not nine pixels wide. */}
                  <circle cx={cluster.x} cy={cluster.y} r={px(22)} fill="transparent" />
                </g>
              );
            })}
          </g>

          {/* Scale bar: how far across the *viewport* is, which is not how far
              anybody travelled.

              Top left, which is the one corner nothing else wants: the caption
              holds the bottom left, and the zoom controls hold the top right
              on a desktop and the bottom right on a phone. B1944. */}
          <g pointerEvents="none" transform={`translate(${frame.x + frame.w * 0.04 + bar.units} ${frame.y + frame.h * 0.12})`}>
            <line
              x1={-bar.units}
              y1={0}
              x2={0}
              y2={0}
              stroke="#1e293b"
              strokeWidth={px(2)}
              strokeLinecap="round"
            />
            <text
              x={-bar.units / 2}
              y={-px(6)}
              fontSize={px(11)}
              fill="#1e293b"
              textAnchor="middle"
              className="font-display"
              stroke="#fffaf0"
              strokeWidth={px(3)}
              paintOrder="stroke"
            >
              ≈ {bar.km < 1 ? `${bar.km * 1000} m` : `${bar.km} km`}
            </text>
          </g>
        </svg>

        {/* Down the right-hand side there was 144 px of button over a 237 px
            map — 61% of its height, on the side the route runs through. A row
            in the corner costs the corner. B1944. */}
        <div className="absolute bottom-2 right-2 flex flex-row-reverse gap-1.5 sm:bottom-auto sm:top-2 sm:flex-col">
          <MapButton
            label={t("map.zoomIn")}
            onClick={() => setZoom((z) => Math.min(maxZoom, z * 1.6))}
          >
            <Plus className="h-4 w-4" />
          </MapButton>
          <MapButton
            label={t("map.zoomOut")}
            onClick={() => setZoom((z) => Math.max(1, z / 1.6))}
          >
            <Minus className="h-4 w-4" />
          </MapButton>
          {/* Absent until there is something to reset — a control for a state
              nobody is in is furniture. */}
          {moved && (
            <MapButton label={t("map.reset")} onClick={refit}>
              <RotateCcw className="h-4 w-4" />
            </MapButton>
          )}
        </div>

        {/* On the map rather than under it, and on its own quiet ground: the
            sentence has to be next to the dashes it is about, and cream text
            laid straight onto a cream basemap is not readable. */}
        <p className="pointer-events-none absolute bottom-2 left-2 max-w-[65%] rounded-md bg-cream-50/85 px-1.5 py-0.5 text-[11px] leading-tight text-navy-900">
          {t("tripMap.connections")}
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
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">
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
        <span className="min-w-0 truncate text-xs text-ink-muted">
          {t(chosen ? "tripMap.selectedPlace" : "tripMap.lastPlace")} ·{" "}
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

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold transition-colors ${
        active
          ? "border-action-strong bg-action-strong text-on-action"
          : "border-line-quiet bg-surface-base text-ink-body hover:text-ink-strong"
      }`}
    >
      {children}
    </button>
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
