"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Minus, Maximize2 } from "lucide-react";
import { frameRoute, frameSpanKm, place as placeIn, type Frame } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { TRANSPORT_STYLE } from "@/lib/transport";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import type { Basemap } from "@/lib/basemap";
import type { Entry, PlannedStop, TransportMode } from "@/lib/types";

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
  entries: Entry[];
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
  basemap = null,
}: {
  places: PlaceView[];
  /** The intended route, drawn behind the real one. */
  plan?: PlannedStop[];
  /**
   * Borders, water, peaks and towns for this frame, clipped on the server
   * (lib/basemap.ts). Null when the bundle has not been built, in which case
   * the old 110m coastline stands in — which is all this map had before B46.
   */
  basemap?: Basemap | null;
}) {
  const { t, formatShortDate, formatStay } = useI18n();
  // Same as the stop list below the map: the day link has to carry the owner
  // and, off the current trip, the trip too.
  const href = useTrip()?.href ?? ((p: string) => p);
  const worldLand = useWorldLand();
  const [selected, setSelected] = useState<PlaceView | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const planAhead = useMemo(() => {
    if (plan.length === 0) return [];
    let lastReached = -1;
    plan.forEach((s, i) => {
      if (s.reached) lastReached = i;
    });
    return plan.slice(Math.max(0, lastReached));
  }, [plan]);

  const legs: Leg[] = useMemo(() => {
    const out: Leg[] = [];
    for (let i = 1; i < places.length; i++) {
      const mode = places[i].entries[0]?.transport?.mode;
      if (!mode) continue;
      out.push({ from: places[i - 1], to: places[i], mode });
    }
    return out;
  }, [places]);

  const usedModes = useMemo(() => Array.from(new Set(legs.map((l) => l.mode))), [legs]);

  // Base frame: the visited area, padded. An upcoming trip has no places yet
  // — fall back to framing the planned route instead, so it isn't a few dots
  // lost in the full world. Only when there's neither does the whole world
  // stand in.
  const base = useMemo(
    () => frameRoute(places.length > 0 ? places : plan),
    [places, plan],
  );

  // Where the stops actually are. Zooming in drifts the camera from the
  // route's bounding-box centre toward this, so you end up over the places
  // rather than the empty ocean in the middle of a long-haul leg.
  const focus = useMemo(() => {
    if (places.length === 0) return null;
    const pts = places.map((p) => placeIn(base, p));
    return {
      x: pts.reduce((s, p) => s + p[0], 0) / pts.length,
      y: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    };
  }, [places, base]);

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
  const clusters = useMemo(() => clusterPlaces(places, px(13), base), [places, px, base]);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragState.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = view.w / rect.width;
    setPan({
      x: d.panX - (e.clientX - d.x) * scale,
      y: d.panY - (e.clientY - d.y) * scale,
    });
  };
  const endDrag = () => {
    dragState.current = null;
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-navy-200 bg-sky-300 shadow-sm">
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
          className="block h-auto min-h-[340px] w-full cursor-grab touch-none active:cursor-grabbing sm:min-h-0"
          role="group"
          // The same question the heading above it asks (B54). A map showing
          // only a planned route must not announce itself as "where we've
          // been" — the sighted reader had that corrected in the h1, and this
          // is the only name a screen reader gets.
          aria-label={t(places.length > 0 ? "map.title" : "map.titlePlanned")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          {/* Ground.

              Path data — whether the old coastline or the new basemap — is
              baked in *uncorrected* projected units, so it is the one thing on
              the map squeezed by a transform rather than positioned point by
              point; everything else goes through `placeIn`, which applies the
              same factor. `vector-effect` keeps outlines an even hairline:
              without it the horizontal squeeze thins vertical strokes by a
              third at Swiss latitudes and the coast looks half-drawn. */}
          <g transform={`scale(${base.lngScale} 1)`}>
            {basemap ? (
              <>
                {/* Countries, not coastline. Each polygon is one country, so
                    filling gives land against sea and stroking gives the
                    borders between them from the same shapes — and a landlocked
                    trip finally has something to draw, which under the 110m
                    coastline it never did. */}
                <g fill="#dff3e0" stroke="#94c9a0" strokeWidth={1.2}>
                  {basemap.borders.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                {/* High ground: mountain ranges, plateaus and foothills, as a
                    tint over the land and under everything else. Natural Earth
                    has no contours, so this is as far as "elevation" goes here
                    — it says the ground rises without pretending to be a
                    topographic map. Low opacity on purpose: it is texture
                    behind the trip, not information competing with it. */}
                <g fill="#cfe0bd" opacity={0.55} stroke="none">
                  {basemap.relief.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                <g fill="#8fe0ef" stroke="#6fcfe0" strokeWidth={0.8}>
                  {basemap.lakes.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
                <g fill="none" stroke="#8fe0ef" strokeWidth={1.6} strokeLinecap="round">
                  {basemap.rivers.map((d, i) => (
                    <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              </>
            ) : (
              <g fill="#dff3e0" stroke="#bfe3c4" strokeWidth={1}>
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
                  <circle cx={town.x} cy={town.y} r={px(3.5)} fill="#8aa0b8" />
                  <text
                    x={town.x + px(6)}
                    y={town.y + px(4)}
                    fontSize={px(11)}
                    fill="#5a6a80"
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
                    fill="#9a8f7a"
                  />
                  <text
                    x={peak.x + px(9)}
                    y={peak.y + px(6)}
                    fontSize={px(11)}
                    fill="#7a6f5a"
                    className="font-display"
                  >
                    {peak.name}
                    {peak.metres ? ` ${peak.metres} m` : ""}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* What's left of the plan, behind the real route: a dashed run from
              where we've got to through the stops still ahead, with hollow
              markers on each. Drawing the whole plan would lay a second line
              over the route already travelled and say nothing extra. Straight
              segments, so it reads as distinct from the bowed lines of legs
              actually made. */}
          {planAhead.length > 1 && (
            <g pointerEvents="none">
              <path
                d={planAhead
                  .map((s, i) => {
                    const [x, y] = placeIn(base, s);
                    return `${i === 0 ? "M" : "L"}${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#5a6a80"
                strokeWidth={px(2)}
                strokeDasharray={`${px(7)} ${px(5)}`}
                strokeLinecap="round"
                opacity={0.45}
              />
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
                      fill="#fffaf0"
                      stroke="#5a6a80"
                      strokeWidth={px(1.8)}
                      opacity={0.75}
                    />
                  );
                })}
            </g>
          )}

          {legs.map((leg, i) => {
            const [x1, y1] = placeIn(base, leg.from);
            const [x2, y2] = placeIn(base, leg.to);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const bow = Math.min(px(120), len * 0.18);
            const cx = mx - (dy / len) * bow;
            const cy = my + (dx / len) * bow;
            const style = TRANSPORT_STYLE[leg.mode];
            return (
              <motion.path
                key={i}
                d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                fill="none"
                stroke={style.color}
                strokeWidth={px(4)}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.95 }}
                transition={{ duration: 0.7, delay: 0.2 + i * 0.08, ease: "easeOut" }}
              />
            );
          })}

          {clusters.map((cluster, i) => {
            const many = cluster.places.length > 1;
            const isSelected =
              !many && selected?.key === cluster.places[0].key;
            const r = px(many ? 18 : isSelected ? 16 : 13);
            const label = cluster.places.length;
            return (
              <g
                key={i}
                className="cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-[3]"
                role="button"
                tabIndex={0}
                aria-label={
                  many
                    ? `${label} ${t("map.places")}`
                    : `${cluster.places[0].location}, ${cluster.places[0].country}`
                }
                onClick={() => {
                  if (many) {
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
                  } else {
                    setSelected(cluster.places[0]);
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !many) {
                    setSelected(cluster.places[0]);
                  }
                }}
              >
                <motion.circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={r}
                  fill={many ? "#3b82f6" : isSelected ? "#ffd23f" : "#ffffff"}
                  stroke="#1e293b"
                  strokeWidth={px(3)}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: 0.15 + i * 0.05,
                    type: "spring",
                    stiffness: 320,
                    damping: 18,
                  }}
                  style={{ transformOrigin: `${cluster.x}px ${cluster.y}px` }}
                />
                {many && (
                  <text
                    x={cluster.x}
                    y={cluster.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={px(15)}
                    fontWeight={700}
                    fill="#ffffff"
                    pointerEvents="none"
                  >
                    {label}
                  </text>
                )}
                {/* The hit area, deliberately larger than the drawn dot: the dot is
                    10px across and a thumb is not. Divided by zoom so it stays 44px
                    on screen rather than growing with the map. */}
                <circle cx={cluster.x} cy={cluster.y} r={px(26)} fill="transparent" />
              </g>
            );
          })}
        </svg>

        {/* zoom controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <MapButton label={t("map.zoomIn")} onClick={() => setZoom((z) => Math.min(8, z * 1.6))}>
            <Plus className="h-4 w-4" />
          </MapButton>
          <MapButton label={t("map.zoomOut")} onClick={() => setZoom((z) => Math.max(1, z / 1.6))}>
            <Minus className="h-4 w-4" />
          </MapButton>
          <MapButton label={t("map.reset")} onClick={reset}>
            <Maximize2 className="h-4 w-4" />
          </MapButton>
        </div>

        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-x-3 bottom-3 rounded-xl border border-navy-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:inset-x-auto sm:left-4 sm:max-w-sm"
            >
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="absolute right-2 top-2 rounded-full p-1 text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="font-display text-base font-semibold text-navy-900">
                {selected.location}
              </div>
              <div className="text-xs text-navy-600">
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
                        className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-navy-200 bg-cream-200"
                      >
                        {m.type === "video" ? (
                          <video src={m.src} className="h-full w-full object-cover" muted />
                        ) : (
                          <Image
                            src={m.src}
                            loader={mediaLoader}
                            alt={m.caption ?? selected.location}
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
                className="mt-2 inline-block text-sm font-semibold text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
              >
                {t("map.readDay")} →
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {usedModes.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {usedModes.map((mode) => {
            const style = TRANSPORT_STYLE[mode];
            return (
              <span key={mode} className="flex items-center gap-2 text-xs text-navy-600">
                <svg width="26" height="6" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="26"
                    y2="3"
                    stroke={style.color}
                    strokeWidth={3}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                  />
                </svg>
                {style.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-navy-200 bg-white/95 text-navy-700 shadow-sm transition-colors hover:bg-white hover:text-navy-900"
    >
      {children}
    </button>
  );
}
