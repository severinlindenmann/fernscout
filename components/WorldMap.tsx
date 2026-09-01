"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Minus, Maximize2 } from "lucide-react";
import { project, MAP_VIEWBOX } from "@/lib/mapProjection";
import { useWorldLand } from "./useWorldLand";
import { TRANSPORT_STYLE } from "@/lib/transport";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
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

function clusterPlaces(places: PlaceView[], zoom: number): Cluster[] {
  // Merge radius shrinks as you zoom in, so stops separate out.
  const radius = 16 / zoom;
  const clusters: Cluster[] = [];
  for (const place of places) {
    const [x, y] = project(place.lat, place.lng);
    const hit = clusters.find((c) => Math.hypot(c.x - x, c.y - y) < radius);
    if (hit) {
      hit.places.push(place);
      // keep the cluster centred on its members
      hit.x = hit.places.reduce((s, p) => s + project(p.lat, p.lng)[0], 0) / hit.places.length;
      hit.y = hit.places.reduce((s, p) => s + project(p.lat, p.lng)[1], 0) / hit.places.length;
      continue;
    }
    clusters.push({ x, y, places: [place] });
  }
  return clusters;
}

export default function WorldMap({
  places,
  plan = [],
}: {
  places: PlaceView[];
  /** The intended route, drawn behind the real one. */
  plan?: PlannedStop[];
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
  const base = useMemo(() => {
    const pts =
      places.length > 0
        ? places.map((p) => project(p.lat, p.lng))
        : plan.map((s) => project(s.lat, s.lng));
    if (pts.length === 0) {
      return { x: 0, y: 0, w: MAP_VIEWBOX.width, h: MAP_VIEWBOX.height };
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const padX = 70;
    const padY = 55;
    const minX = Math.max(0, Math.min(...xs) - padX);
    const maxX = Math.min(MAP_VIEWBOX.width, Math.max(...xs) + padX);
    const minY = Math.max(0, Math.min(...ys) - padY);
    const maxY = Math.min(MAP_VIEWBOX.height, Math.max(...ys) + padY);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [places, plan]);

  // Where the stops actually are. Zooming in drifts the camera from the
  // route's bounding-box centre toward this, so you end up over the places
  // rather than the empty ocean in the middle of a long-haul leg.
  const focus = useMemo(() => {
    if (places.length === 0) return null;
    const pts = places.map((p) => project(p.lat, p.lng));
    return {
      x: pts.reduce((s, p) => s + p[0], 0) / pts.length,
      y: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    };
  }, [places]);

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

  const clusters = useMemo(() => clusterPlaces(places, zoom), [places, zoom]);

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
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
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
          <g fill="#dff3e0" stroke="#bfe3c4" strokeWidth={0.6 / zoom}>
            {worldLand.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>

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
                    const [x, y] = project(s.lat, s.lng);
                    return `${i === 0 ? "M" : "L"}${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#5a6a80"
                strokeWidth={1.4 / zoom}
                strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                strokeLinecap="round"
                opacity={0.45}
              />
              {planAhead
                .filter((s) => !s.reached)
                .map((s, i) => {
                  const [x, y] = project(s.lat, s.lng);
                  return (
                    <circle
                      key={`${s.location}-${i}`}
                      cx={x}
                      cy={y}
                      r={3.2 / zoom}
                      fill="#fffaf0"
                      stroke="#5a6a80"
                      strokeWidth={1.3 / zoom}
                      opacity={0.75}
                    />
                  );
                })}
            </g>
          )}

          {legs.map((leg, i) => {
            const [x1, y1] = project(leg.from.lat, leg.from.lng);
            const [x2, y2] = project(leg.to.lat, leg.to.lng);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const bow = Math.min(24, len * 0.18);
            const cx = mx - (dy / len) * bow;
            const cy = my + (dx / len) * bow;
            const style = TRANSPORT_STYLE[leg.mode];
            return (
              <motion.path
                key={i}
                d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                fill="none"
                stroke={style.color}
                strokeWidth={2 / zoom}
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
            const r = (many ? 8 : isSelected ? 7 : 5) / zoom;
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
                    const nextZoom = Math.min(8, zoom * 2);
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
                  strokeWidth={1.6 / zoom}
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
                    fontSize={8 / zoom}
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
                <circle cx={cluster.x} cy={cluster.y} r={27 / zoom} fill="transparent" />
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
