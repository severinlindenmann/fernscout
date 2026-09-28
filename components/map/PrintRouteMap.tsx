import { frameRoute, place as placeIn } from "@/lib/mapFrame";
import { scaleBar, type TripStop } from "@/lib/tripMap";
import type { Basemap } from "@/lib/basemap";
import type { TripAccent } from "@/lib/types";
import { translateIn } from "@/lib/locales";
import { PRINT_PALETTE, printAccent, type PrintPalette } from "@/lib/map/printPalette";
import { hopPath, isArcLeg, type RouteHop } from "./RouteLine";

/**
 * A trip's route, drawn once into a fixed frame for print — B2431, Phase 4
 * of docs/plans/map-redesign.md. The private photobook and postcard package
 * adopts this behind the `@paid/*` seam (AGENTS.md: application code here
 * never imports a `paid/` path); nothing in this file knows that caller
 * exists.
 *
 * Deliberately not `TripMap`: that component is a `"use client"` map with
 * pan, zoom, a `ResizeObserver` for its own drawn size and a `fetch` for lazy
 * stop photos — none of which exist in a print context (a PDF renderer, a
 * static export, `renderToStaticMarkup` with no browser at all). This is a
 * plain function component, no hooks, nothing that resolves after mount:
 * every size comes from the `width`/`height` props rather than measuring the
 * page it landed on, and every colour comes from `lib/map/printPalette.ts`'s
 * concrete hex rather than `lib/map/style.ts`'s `var(--map-…)` tokens, which
 * a print pipeline has no cascade to resolve against.
 *
 * What it does not do, on purpose: cluster crowded stops (`TripMap`'s own
 * `clusterStops` — a page has already chosen which stops fit before calling
 * this), draw a recorded `track.json` line (only the straight/arced hop
 * between stops — the caller can add that once a print surface actually
 * wants it), or offer any control. A print page cannot be panned.
 */

export type PrintStop = TripStop;

/** One legend row, in the order the trip travelled it — the "stop list
 * data" callers can lay out themselves (a photobook's own margin list,
 * `paid/photobook/lib/photobook/routeMap.ts`'s numbered style) instead of
 * this component's own rendered `<ol>`. */
export type PrintLegendEntry = {
  order: number;
  location: string;
  country: string;
};

/** The numbered legend, independent of any particular frame or pixel size —
 * pure data, so a caller who draws its own PDF operators for the list (as
 * the private photobook already does for its margin list) has the same
 * order and names this component's own `<ol>` renders. */
export function printLegend(stops: readonly PrintStop[]): PrintLegendEntry[] {
  return stops.map((stop, i) => ({ order: i + 1, location: stop.location, country: stop.country }));
}

const NORTH_SIZE = 22;
const MARGIN = 16;

export default function PrintRouteMap({
  stops,
  accent = "navy",
  basemap = null,
  width,
  height,
  palette = PRINT_PALETTE,
  locale = "en",
  className,
}: {
  /** In day order — `tripStops(days)` (lib/tripMap.ts) already collapses a
   * run of days in one place into a single stop, the same list `TripMap`
   * draws. */
  stops: readonly PrintStop[];
  accent?: TripAccent;
  /** Clipped to `frameRoute(stops)` by the caller — `basemapForRoute` (server-
   * only, lib/basemap.ts) computed the same way every other server-rendered
   * map here already computes its own ground. `null` draws the sea alone: a
   * print page has no client-side `useWorldLand` fallback to reach for. */
  basemap?: Basemap | null;
  /** The SVG's own pixel size — fixed, never measured. A print page decides
   * its own dimensions (a book's trim box, a postcard's back) and hands them
   * in rather than this component guessing at a `ResizeObserver`. */
  width: number;
  height: number;
  /** Concrete colours, resolved to the light theme by default — see
   * `lib/map/printPalette.ts`'s own doc for why print cannot read
   * `var(--map-…)`. A caller with its own print palette (a differently
   * papered book stock, say) can pass one in rather than fork this file. */
  palette?: PrintPalette;
  /** Only the "north" abbreviation and the scale bar's caption are
   * translated (`site/locales/*.json`'s `printRouteMap.*` keys) — the north
   * letter itself differs by language (Hungarian "É" for Észak, not "N"),
   * unlike "km"/"m", which every maintained locale already writes the same
   * way `tripMap`'s own on-screen scale bar does. */
  locale?: string;
  className?: string;
}) {
  const frame = frameRoute(stops);
  const px = (pixels: number) => (pixels * frame.w) / width;
  const points = stops.map((s) => placeIn(frame, s));

  const hops: RouteHop[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (x1 === x2 && y1 === y2) continue;
    hops.push({ x1, y1, x2, y2, mode: stops[i + 1].transport?.mode });
  }

  const bar = scaleBar(frame);
  const barLabel = bar.km < 1 ? `${bar.km * 1000} m` : `${bar.km} km`;
  const northLabel = translateIn(locale, "printRouteMap.north");
  const scaleCaption = translateIn(locale, "printRouteMap.scaleApprox", { distance: barLabel });

  const legend = printLegend(stops);

  return (
    <figure className={className} style={{ margin: 0 }}>
      <svg
        width={width}
        height={height}
        viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
        role="img"
        aria-label={scaleCaption}
      >
        <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={palette.sea} />
        <g transform={`scale(${frame.lngScale} 1)`}>
          {basemap && (
            <>
              <g fill={palette.land} stroke={palette.border} strokeWidth={1}>
                {basemap.borders.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g fill="none" stroke={palette.borderInternal} strokeWidth={0.8} strokeDasharray="3 3">
                {basemap.admin1.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g fill={palette.water} stroke="none">
                {basemap.lakes.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
              <g fill="none" stroke={palette.water} strokeWidth={1.4} strokeLinecap="round">
                {basemap.rivers.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            </>
          )}
        </g>

        {points.length > 1 && (
          <g aria-hidden="true" fill="none" strokeLinecap="round">
            {hops.map((hop, i) => (
              <path
                key={`casing-${i}`}
                d={hopPath(hop.x1, hop.y1, hop.x2, hop.y2, isArcLeg(hop.mode), px)}
                stroke={palette.routeCasing}
                strokeWidth={px(4) + px(3)}
              />
            ))}
            {hops.map((hop, i) => (
              <path
                key={`line-${i}`}
                d={hopPath(hop.x1, hop.y1, hop.x2, hop.y2, isArcLeg(hop.mode), px)}
                stroke={printAccent(accent)}
                strokeWidth={px(4)}
              />
            ))}
          </g>
        )}

        {stops.map((stop, i) => {
          const [x, y] = points[i];
          return (
            <g key={stop.key}>
              <circle cx={x} cy={y} r={px(8)} fill={palette.stopFill} stroke={palette.stopRing} strokeWidth={px(2.5)} />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={px(10.5)}
                fontWeight={700}
                fill={palette.stopNumber}
              >
                {i + 1}
              </text>
            </g>
          );
        })}

        {/* Scale bar: top left, the corner `TripMap`'s own interactive scale
            bar already claims for the same reason (nothing else wants it). */}
        <g transform={`translate(${frame.x + frame.w * 0.04 + bar.units} ${frame.y + frame.h * 0.1})`}>
          <line x1={-bar.units} y1={0} x2={0} y2={0} stroke={palette.ink} strokeWidth={px(2)} strokeLinecap="round" />
          <text
            x={-bar.units / 2}
            y={-px(6)}
            fontSize={px(11)}
            fill={palette.ink}
            textAnchor="middle"
            stroke={palette.labelStopHalo}
            strokeWidth={px(3)}
            paintOrder="stroke"
          >
            ≈ {barLabel}
          </text>
        </g>

        {/* North arrow: top right, `MapControls`' own corner on every
            interactive map — free here, since a print frame carries no
            controls to compete with it. Sized and inset with `px()`, the
            same screen-pixel convention as every marker and stroke above,
            so it stays a fixed size in the printed page regardless of the
            route's own span. */}
        <g transform={`translate(${frame.x + frame.w - px(MARGIN) - px(NORTH_SIZE)} ${frame.y + px(MARGIN)})`}>
          <path d={`M0,${px(NORTH_SIZE)} L${px(NORTH_SIZE) / 2},0 L${px(NORTH_SIZE)},${px(NORTH_SIZE)} Z`} fill={palette.ink} />
          <text
            x={px(NORTH_SIZE) / 2}
            y={px(NORTH_SIZE) + px(12)}
            textAnchor="middle"
            fontSize={px(11)}
            fontWeight={700}
            fill={palette.ink}
          >
            {northLabel}
          </text>
        </g>
      </svg>

      {/* `<ul>`, not `<ol>` — the visible "N." is the marker's own day-order
          number (`entry.order`), and a browser's own list counter next to it
          would double-number the same row (found in the check-a-drawing
          render: "1. 1. Susten Pass"). */}
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {legend.map((entry) => (
          <li key={entry.order}>
            {entry.order}. {entry.location}
            {entry.country ? `, ${entry.country}` : ""}
          </li>
        ))}
      </ul>
    </figure>
  );
}
