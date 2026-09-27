"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { frameRoute, isPlottable, place as placeIn, type Point } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import { flagFromCode } from "@/lib/flags";
import { mapAccent, mapStyle } from "@/lib/map/style";
import RouteLine, { type RouteHop } from "./map/RouteLine";
import type { Px } from "./map/StopMarker";
import type { Basemap } from "@/lib/basemap";
import type { TripAccent } from "@/lib/types";

export type TripRoute = {
  id: string;
  title: string;
  accent: TripAccent;
  points: { lat: number; lng: number; location: string }[];
};

/** One country somebody has been to, and which trips took them there. */
export type CountryVisit = {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** The country's own name, for the hover/focus label. */
  name: string;
  /**
   * Its SVG outline, resolved from `lib/worldCountries.json` **on the server**
   * — see `app/[user]/trips/page.tsx`.
   *
   * Carried here rather than looked up in the browser because the fill is the
   * meaning of this map: loading the country shapes client-side left the
   * server render with no countries in it at all, so a reader without
   * JavaScript, and everyone's first paint, got an empty frame. Sending the
   * handful actually visited is also far less than the 143 KB of all 177.
   */
  path: string;
  trips: { id: string; title: string }[];
};

/** The five palette hues from app/globals.css, as literals — this is an SVG
 * stroke, which Tailwind classes can't reach. Exported so the trip cards can
 * use the same colour for their accent dot. Kept as a plain hex table for
 * that HTML usage (`app/[user]/trips/TripsIndexContent.tsx`); this map's own
 * SVG reads `mapAccent()` (`lib/map/style.ts`) instead, so a trip's route and
 * marker follow the map-only accent step (B2423, docs/plans/map-redesign.md
 * §7 Q2), not this brand hex. */
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
export default function LifetimeMap({
  routes,
  visits = [],
  framePoints = [],
  userPath = "",
  basemap = null,
}: {
  routes: TripRoute[];
  /**
   * Countries visited, and by which trips. When this is non-empty the map
   * fills countries with the one neutral "visited" tint (B2423) in addition
   * to each trip's own route and marker below; when it is empty only the
   * routes and markers are drawn.
   *
   * The fallback is not decoration. A journal whose days carry no `country:`
   * resolves nothing here, and filling nothing would render an empty world —
   * strictly worse than the plain routes it falls back to. `viki` is exactly
   * that journal. B361.
   */
  visits?: CountryVisit[];
  /**
   * Extra points the frame must contain, drawn from nothing — B600.
   *
   * A teasered trip contributes countries to `visits` and no route, so
   * framing on `routes` alone put its fill on a whole-world map. The page
   * sends the corners of the *country's own outline* rather than the trip's
   * stops, so what widens the frame is country-level; see the note beside
   * `countryCorners` in `app/[user]/trips/page.tsx`. Nothing here is
   * rendered — the frame is the only thing they touch.
   */
  framePoints?: Point[];
  /** `/<user>`, for linking a country to the trip that reached it. */
  userPath?: string;
  /** Clipped to every trip's combined frame on the server — lib/basemap.ts. */
  basemap?: Basemap | null;
}) {
  const { t } = useI18n();
  const worldLand = useWorldLand();
  const filling = visits.length > 0;

  // Which country, if any, is under the pointer or keyboard focus — the
  // visible half of the focusable label below (B2423/B361). Native <title>
  // hover text answers a mouse and nobody else: a screen reader gets it as
  // the link/group's own accessible name regardless (via `aria-label` on
  // each country below), but a sighted keyboard user tabbing through never
  // saw a hover-only tooltip render. This state drives one small caption
  // instead, updated by both focus and hover so a mouse user sees the same
  // thing a keyboard user does.
  const [active, setActive] = useState<CountryVisit | null>(null);

  // Frame the visited area rather than the whole world — otherwise two European
  // trips are two dots in an ocean of empty Pacific.
  //
  // This was the third copy of that arithmetic in the codebase, with a third
  // set of constants: 60/40 units of padding here, 70/55 in WorldMap, 90/60 in
  // MiniMap. B46 put it in one place, so all three now agree on what "framed"
  // means and all three get the latitude correction that stops a north-south
  // route being drawn stretched sideways.
  const view = useMemo(
    () => frameRoute([...routes.flatMap((r) => r.points), ...framePoints]),
    [routes, framePoints],
  );

  /**
   * `px` sizes a marker or a route in real screen pixels rather than in
   * viewBox units — the same fix WorldMap's own `px` needed, and the same
   * reason (see the block comment above `px` in `components/WorldMap.tsx`):
   * a fixed *fraction of the viewBox* is a different number of actual
   * pixels depending on both the container's rendered width and how large
   * an area the frame covers. This map's frame swings from one country to
   * the whole world, so a fraction-of-viewBox marker that looked right for
   * a single trip's own frame came out the size of a small country here —
   * B2423's own bug, caught in review. Measuring the SVG's own rendered
   * width with a `ResizeObserver`, the way WorldMap already does, is what
   * makes `px(8)` mean the same ~8 CSS pixels whether the frame is a single
   * country or six continents, and whatever the viewport width.
   *
   * `drawnWidth` starts at a plausible desktop guess so the server render
   * and the first client frame agree (no hydration mismatch); the observer
   * corrects it once the browser has actually laid the figure out.
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
  const px: Px = (pixels) => (pixels * view.w) / drawnWidth;

  /**
   * Each trip's route (its own stops, in order) and one marker — an
   * unnumbered dot in the trip's accent, not `StopMarker`'s numbered stop
   * disc: a single "1" on every trip's only marker read as "stop 1", which
   * misleads (B2423 review). Kept local rather than a new shared primitive,
   * since nothing else needs an unnumbered dot yet.
   *
   * The marker sits at the trip's first plottable point, then a single
   * decluttering pass nudges apart any two trips whose markers would
   * otherwise overlap on screen — two trips can start a few hundred
   * kilometres apart in the same country, which is nothing at world zoom.
   * The route line itself is drawn from the *un-nudged* points: only the
   * summary dot moves.
   */
  const MARKER_RADIUS_PX = 8;
  const tripDraws = useMemo(() => {
    const unitsToPx = (u: number) => (u * drawnWidth) / view.w;
    const pxToUnits = (p: number) => (p * view.w) / drawnWidth;
    const list = routes
      .map((route) => {
        const pts = route.points.filter(isPlottable).map((p) => placeIn(view, p));
        if (pts.length === 0) return null;
        const hops: RouteHop[] = pts.slice(0, -1).map(([x1, y1], i) => {
          const [x2, y2] = pts[i + 1];
          return { x1, y1, x2, y2 };
        });
        return { route, hops, mx: pts[0][0], my: pts[0][1] };
      })
      .filter((d): d is { route: TripRoute; hops: RouteHop[]; mx: number; my: number } => d !== null);

    // ponytail: a single pass separates a directly-overlapping pair; three
    // or more markers all mutually close (unseen in any real journal so
    // far) may still overlap. A real force-directed declutter if that turns
    // up.
    const minGapPx = MARKER_RADIUS_PX * 2.4;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.mx - a.mx;
        const dy = b.my - a.my;
        const distPx = unitsToPx(Math.hypot(dx, dy));
        if (distPx >= minGapPx) continue;
        const len = Math.hypot(dx, dy);
        const [ux, uy] = len > 0 ? [dx / len, dy / len] : [1, 0];
        const pushUnits = pxToUnits(minGapPx - distPx) / 2;
        a.mx -= ux * pushUnits;
        a.my -= uy * pushUnits;
        b.mx += ux * pushUnits;
        b.my += uy * pushUnits;
      }
    }
    return list;
  }, [routes, view, drawnWidth]);

  const label =
    routes.length > 0
      ? `${t("trips.mapLabel")}: ${routes.map((r) => r.title).join(", ")}`
      : t("trips.mapLabel");

  return (
    <figure className="overflow-hidden rounded-2xl border border-line-quiet bg-sky-300">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        // A map is the point of this figure, so it gets a floor to stand on:
        // framed to a landscape shape it would otherwise be a 150-pixel band on
        // a phone, which is a picture of nothing.
        className="block h-auto min-h-[260px] w-full sm:min-h-0"
        // `role="img"` promises there is nothing inside worth reaching, which
        // is true until a country becomes a link or a focusable group — an
        // image's children are not exposed, so they would exist for the mouse
        // and for nobody else. B361.
        role={filling ? "group" : "img"}
        aria-label={label}
      >
        {/* Same fills as the per-trip WorldMap (components/WorldMap.tsx), so the
            two read as the same map — including the basemap when it has been
            built, which is what lets a Swiss trip show a border rather than an
            empty green field. */}
        <g transform={`scale(${view.lngScale} 1)`}>
          {basemap ? (
            <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1}>
              {basemap.borders.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          ) : (
            <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1}>
              {worldLand.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {/*
            One neutral "visited" tint for every country, whoever reached it and
            however many trips did (B2423) — replacing the per-country flag
            colours `lib/flagColours.ts` used to assign, which put Switzerland
            in two trips and two unrelated coral trips in visibly different
            colours for no reason a reader could learn. The fill still carries
            the accessible name for a screen reader (`aria-label`); a sighted
            keyboard user reads it from the caption below the map, since the
            fill itself has nothing left to look different by.
          */}
          {filling && (
            <g stroke={mapStyle.ice} strokeWidth={0.8}>
              {visits.map((v) => {
                const shape = (
                  <path
                    d={v.path}
                    fill={mapStyle.visited}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer transition-opacity duration-150 hover:opacity-70"
                  />
                );
                const ariaLabel = `${v.name} — ${v.trips.map((tr) => tr.title).join(", ")}`;
                const focus = {
                  onMouseEnter: () => setActive(v),
                  onMouseLeave: () => setActive(null),
                  onFocus: () => setActive(v),
                  onBlur: () => setActive(null),
                };
                // A focus-visible ring: the paper fill gives a focused country
                // nothing else to look different by once colour stopped
                // carrying identity.
                const focusRing =
                  "outline-2 outline-offset-1 outline-transparent focus-visible:outline-[var(--map-stop-ring)]";

                /* One trip is a destination; several are not. Sending the
                   reader to the most recent silently is the same trap the
                   fill-colour decision already turned down, so a country
                   several trips reached names them and the cards below the
                   map are where you choose. B361. */
                return v.trips.length === 1 && userPath ? (
                  <a
                    key={v.code}
                    href={`${userPath}/trips/${v.trips[0].id}`}
                    aria-label={ariaLabel}
                    className={focusRing}
                    {...focus}
                  >
                    {shape}
                  </a>
                ) : (
                  <g key={v.code} tabIndex={0} aria-label={ariaLabel} className={focusRing} {...focus}>
                    {shape}
                  </g>
                );
              })}
            </g>
          )}
          {/* Water last, so a river does not disappear under a country
              somebody visited — a lake that vanishes exactly where the map
              is most coloured in reads as a rendering fault. */}
          {basemap && (
            <>
              <g fill="none" stroke={mapStyle.water} strokeWidth={0.5}>
                {basemap.rivers.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g fill={mapStyle.water} stroke={mapStyle.border} strokeWidth={0.7}>
                {basemap.lakes.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            </>
          )}
        </g>
        {/*
          Every trip is its own accent route plus one marker (B2423,
          docs/plans/map-redesign.md §1 "Reisen" row) — drawn over the ground
          and the visited tint alike, and independently of whether `visits`
          filled anything. This supersedes B344's "no line" rule for this map:
          that rule was about a line asserting a journey *between two separate
          trips'* pins, which never happened here; a straight line through one
          trip's own stops, in its own accent, is the same route `TripMap`
          already draws for that trip, only smaller. `placeIn` already bakes
          in `view.lngScale`, so these are sibling to the scaled `<g>` above,
          not inside it — the same convention the pins this replaces used.
        */}
        {tripDraws.map(({ route, hops, mx, my }) => (
          <g key={route.id}>
            {hops.length > 0 && <RouteLine hops={hops} accent={route.accent} px={px} />}
            {/* An unnumbered dot, not `StopMarker` — a "1" on every trip's
                only marker reads as "stop 1" (B2423 review). */}
            <g aria-label={route.title} role="img">
              <circle
                cx={mx}
                cy={my}
                r={px(MARKER_RADIUS_PX)}
                fill={mapAccent(route.accent)}
                stroke={mapStyle.stopRing}
                strokeWidth={px(1.5)}
              />
            </g>
          </g>
        ))}
      </svg>
      {/* The visible half of the focus/hover label above — a screen reader
          already has the country's name on the shape itself (`aria-label`),
          so this exists for a sighted keyboard user with no other way to see
          what just gained focus. Empty and out of the way otherwise. */}
      {filling && (
        <div aria-live="polite" className="min-h-0 px-4 pt-2 text-xs text-ink-body empty:hidden empty:p-0">
          {active && `${active.name} — ${active.trips.map((tr) => tr.title).join(", ")}`}
        </div>
      )}
      {/* The legend carries whatever the map just encoded, so colour is never
          the only thing saying it. */}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-quiet bg-surface-raised px-4 py-3 text-xs text-ink-body">
        {routes.map((r) => (
          <span key={r.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: mapAccent(r.accent) }}
            />
            {r.title}
          </span>
        ))}
        {filling &&
          visits.map((v) => (
            <span key={v.code} className="flex items-center gap-1.5">
              {/* The flag is decoration beside a name that already says the
                  country — `aria-hidden`, or a screen reader reads the
                  country twice, once as a flag emoji. */}
              <span aria-hidden>{flagFromCode(v.code)}</span>
              {v.name}
              {v.trips.length > 1 && (
                <span className="text-ink-secondary">×{v.trips.length}</span>
              )}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
