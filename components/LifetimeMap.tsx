"use client";

import { useMemo, useState } from "react";
import { frameRoute, isPlottable, place as placeIn, type Point } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import { flagFromCode } from "@/lib/flags";
import { mapAccent, mapStyle } from "@/lib/map/style";
import RouteLine, { type RouteHop } from "./map/RouteLine";
import StopMarker from "./map/StopMarker";
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
    <figure className="overflow-hidden rounded-2xl border border-line-quiet bg-sky-300">
      <svg
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
        {routes.map((route) => {
          const pts = route.points.filter(isPlottable).map((p) => placeIn(view, p));
          if (pts.length === 0) return null;
          const hops: RouteHop[] = pts.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = pts[i + 1];
            return { x1, y1, x2, y2 };
          });
          const [mx, my] = pts[0];
          return (
            <g key={route.id}>
              {hops.length > 0 && <RouteLine hops={hops} accent={route.accent} px={size} />}
              <StopMarker x={mx} y={my} order={1} ariaLabel={route.title} px={size} />
            </g>
          );
        })}
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
