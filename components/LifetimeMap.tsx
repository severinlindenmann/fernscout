"use client";

import { useMemo } from "react";
import { frameRoute, isPlottable, place as placeIn } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import type { Basemap } from "@/lib/basemap";
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
 * A stop is a thin stem rising from the coordinate to a small ringed head —
 * a pin drawn as a flag rather than a teardrop. The first version here was a
 * solid teardrop (a circular head fused straight onto its own tail), which
 * looked right in isolation but not in a cluster: two or three stops within
 * a few screen pixels of each other — the ordinary case for a multi-stop
 * trip on a world-scale map — fused their solid heads and thick cream
 * outlines into a single illegible blob with no way to tell how many stops
 * were under it. A thin stem and a small head shrink each marker's own
 * footprint, so the same cluster reads as a few separate, thin lines
 * converging on nearby points rather than one shape.
 *
 * `headR` is the head's radius and `stemLen` the tip-to-head-centre
 * distance, both already in on-screen units (the caller passes them through
 * `size()`) — there is no local coordinate space to build a path in, unlike
 * the teardrop this replaces.
 */
const PIN_HEAD_R = 1.3;
const PIN_STEM_LEN = 4;
const PIN_STEM_WIDTH = 0.55;
const PIN_RING_WIDTH = 0.55;

/**
 * Every trip's route on one map. Deliberately read-only: no clustering, no
 * zoom, no detail panel — that is what the per-trip WorldMap is for, and
 * this only has to answer "where have we been".
 */
export default function LifetimeMap({
  routes,
  basemap = null,
}: {
  routes: TripRoute[];
  /** Clipped to every trip's combined frame on the server — lib/basemap.ts. */
  basemap?: Basemap | null;
}) {
  const { t } = useI18n();
  const worldLand = useWorldLand();

  // Frame the visited area rather than the whole world — otherwise two European
  // trips are two dots in an ocean of empty Pacific.
  //
  // This was the third copy of that arithmetic in the codebase, with a third
  // set of constants: 60/40 units of padding here, 70/55 in WorldMap, 90/60 in
  // MiniMap. B46 put it in one place, so all three now agree on what "framed"
  // means and all three get the latitude correction that stops a north-south
  // route being drawn stretched sideways.
  const view = useMemo(
    () => frameRoute(routes.flatMap((r) => r.points)),
    [routes],
  );

  // Route strokes and dots keep their size on screen rather than being viewBox
  // constants — the same fix WorldMap needed, for the same reason: a journal
  // whose trips are all in one country now gets a small frame, and a
  // radius-2.2 dot on a 5-unit map is most of the map. 140 is the frame width
  // these numbers were originally chosen against.
  const size = (units: number) => (units * view.w) / 140;

  const label =
    routes.length > 0
      ? `${t("trips.mapLabel")}: ${routes.map((r) => r.title).join(", ")}`
      : t("trips.mapLabel");

  return (
    <figure className="overflow-hidden rounded-2xl border border-navy-200 bg-sky-300">
      <svg
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        // A map is the point of this figure, so it gets a floor to stand on:
        // framed to a landscape shape it would otherwise be a 150-pixel band on
        // a phone, which is a picture of nothing.
        className="block h-auto min-h-[260px] w-full sm:min-h-0"
        role="img"
        aria-label={label}
      >
        {/* Same fills as the per-trip WorldMap (components/WorldMap.tsx), so the
            two read as the same map — including the basemap when it has been
            built, which is what lets a Swiss trip show a border rather than an
            empty green field. */}
        <g transform={`scale(${view.lngScale} 1)`}>
          {basemap ? (
            <>
              <g fill="#dff3e0" stroke="#94c9a0" strokeWidth={1}>
                {basemap.borders.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g fill="#8fe0ef" stroke="#6fcfe0" strokeWidth={0.7}>
                {basemap.lakes.map((d, i) => (
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
        {routes.map((route) => {
          // A coordinate-less day (B265) is filtered here rather than drawn:
          // an undefined lat/lng is not a point, and a polyline through one
          // would be a line to nowhere the reader has no way to read as a gap.
          const pts = route.points.filter(isPlottable).map((p) => placeIn(view, p));
          const colour = ACCENT_HEX[route.accent];
          return (
            <g key={route.id}>
              {/* No line between the stops, deliberately (B344). The per-trip
                  map draws one because that page *is* one journey in order and
                  the line is the journey. This map answers a different
                  question — everywhere we have been — over trips that have
                  nothing to do with each other, and a line between two of them
                  asserts a sequence and a path nobody travelled: two stops
                  joined across an ocean read as a crossing when they were two
                  separate holidays. The pins carry position, and the legend
                  ties each colour back to a trip by name, which is the whole
                  of what an overview owes the reader. */}
              {/* A pin, tip on the coordinate, rather than a dot centred on
                  it (B88): a dot both covers the ground it marks — worse the
                  wider the frame, since size() grows it with the map — and
                  merges into its neighbours as soon as two are close, where a
                  thin stem and a small head can overlap and still leave both
                  tips readable. */}
              {pts.map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={-size(PIN_STEM_LEN)}
                    stroke={colour}
                    strokeWidth={size(PIN_STEM_WIDTH)}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={0}
                    cy={-size(PIN_STEM_LEN)}
                    r={size(PIN_HEAD_R)}
                    fill={colour}
                    stroke="#fffaf0"
                    strokeWidth={size(PIN_RING_WIDTH)}
                  />
                </g>
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
