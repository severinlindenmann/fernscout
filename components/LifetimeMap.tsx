"use client";

import { useMemo } from "react";
import { project, MAP_VIEWBOX } from "@/lib/mapProjection";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import type { TripAccent } from "@/lib/types";

export type TripRoute = {
  id: string;
  title: string;
  accent: TripAccent;
  points: { lat: number; lng: number; location: string }[];
};

/** The five palette hues from app/globals.css, as literals — this is an SVG
 * stroke, which Tailwind classes can't reach. Exported so the trip cards can
 * use the same colour for their accent dot. */
export const ACCENT_HEX: Record<TripAccent, string> = {
  sky: "#3fa9c4",
  yellow: "#d69b0a",
  green: "#15803d",
  coral: "#c2334a",
  navy: "#3a4a63",
};

/**
 * Every trip's route on one map. Deliberately read-only: no clustering, no
 * zoom, no detail panel — that is what the per-trip WorldMap is for, and
 * this only has to answer "where have we been".
 */
export default function LifetimeMap({ routes }: { routes: TripRoute[] }) {
  const { t } = useI18n();
  const worldLand = useWorldLand();

  // Frame the visited area, padded, rather than the whole world — otherwise
  // two European trips are two dots in an ocean of empty Pacific.
  const view = useMemo(() => {
    const pts = routes.flatMap((r) => r.points.map((p) => project(p.lat, p.lng)));
    if (pts.length === 0) {
      return { x: 0, y: 0, width: MAP_VIEWBOX.width, height: MAP_VIEWBOX.height };
    }
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    const padX = Math.max(60, (Math.max(...xs) - Math.min(...xs)) * 0.25);
    const padY = Math.max(40, (Math.max(...ys) - Math.min(...ys)) * 0.25);
    return {
      x: Math.min(...xs) - padX,
      y: Math.min(...ys) - padY,
      width: Math.max(...xs) - Math.min(...xs) + padX * 2,
      height: Math.max(...ys) - Math.min(...ys) + padY * 2,
    };
  }, [routes]);

  const label =
    routes.length > 0
      ? `${t("trips.mapLabel")}: ${routes.map((r) => r.title).join(", ")}`
      : t("trips.mapLabel");

  return (
    <figure className="overflow-hidden rounded-2xl border border-navy-200 bg-sky-300">
      <svg
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={label}
      >
        {/* Same land fill/stroke as the per-trip WorldMap (components/WorldMap.tsx),
            so the two read as the same map. */}
        <g fill="#dff3e0" stroke="#bfe3c4" strokeWidth={0.6}>
          {worldLand.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {routes.map((route) => {
          const pts = route.points.map((p) => project(p.lat, p.lng));
          const colour = ACCENT_HEX[route.accent];
          return (
            <g key={route.id}>
              {pts.length > 1 && (
                <polyline
                  points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
              )}
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={2.2} fill={colour} stroke="#fffaf0" strokeWidth={0.7} />
              ))}
            </g>
          );
        })}
      </svg>
      {/* The legend names each trip, so colour alone never carries the meaning. */}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-navy-200 bg-white px-4 py-3 text-xs text-navy-700">
        {routes.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: ACCENT_HEX[r.accent] }}
            />
            {r.title}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
