"use client";

import { useEffect, useRef, useState } from "react";
import { useWorldLand } from "./useWorldLand";
import { useI18n } from "./LocaleProvider";
import { flagFromCode } from "@/lib/flags";
import { mapStyle } from "@/lib/map/style";
import type { Basemap } from "@/lib/basemap";
import type { LifetimeView, ContinentButton } from "@/lib/lifetimeMapViews";
import countryColours from "@/lib/countryColours.json";

/** One country somebody has been to, and which trips took them there. */
export type CountryVisit = {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** The country's own name, for the legend and the focus/hover label. */
  name: string;
  /**
   * Its SVG outline, resolved from `lib/worldCountries.json` **on the
   * server** — see `app/at/[user]/trips/page.tsx`. Carried here rather than
   * looked up in the browser because the fill is the meaning of this map:
   * loading the country shapes client-side left the server render with no
   * countries in it at all, so a reader without JavaScript, and everyone's
   * first paint, got an empty frame. B361.
   */
  path: string;
  trips: { id: string; title: string }[];
  /**
   * The country's own label position on the fixed 1000-unit world
   * (`lib/worldCountries.json`'s `x`), read for one thing only: the
   * Einstieg's west-to-east colour-in order (decision 5). Not used for
   * anything drawn — the fill's actual position always comes from `path`.
   */
  x: number;
};

const WORLD_FRAME = { x: 0, y: 0, w: 1000, h: 500, lngScale: 1 };

/** 700 ms — decision 5, "Gleiten". */
const GLIDE_MS = 700;
/** 1400 ms, once per page load — decision 5, "Einstieg". */
const EINSTIEG_MS = 1400;
/** ~28% — decision 6. */
const FADE_OPACITY = 0.28;

/**
 * "Once per page load", not once per mount: a client-side route change that
 * remounts this component (leaving `/trips` and coming back without a full
 * reload) must not replay the world-to-"Alle" glide a second time. Module
 * state rather than a prop, since nothing upstream of this component has a
 * reason to know whether the intro has already played.
 */
let einstiegPlayed = false;

type Vec = { x: number; y: number; w: number; h: number; lngScale: number };

function toRaw(f: Vec) {
  const rawW = f.w / f.lngScale;
  return { rawCx: f.x / f.lngScale + rawW / 2, rawW, cy: f.y + f.h / 2, h: f.h };
}
function latOfCy(cy: number): number {
  return 90 - (cy / 500) * 180;
}
function kOf(lat: number): number {
  return Math.max(0.2, Math.cos((lat * Math.PI) / 180));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

/**
 * Every trip's route on one map — rewritten for B2491.
 *
 * Deliberately not what B2423 drew. That version filled every visited
 * country in one neutral tint and added a route line and an unnumbered
 * marker per trip; on a real journal of 31 trips it became unreadable (see
 * "Why" in docs/plans/2026-09-27-reisen-continent-switch.md) — 25 markers
 * piled into Europe, one flight leg drawn corner to corner across the whole
 * world, and a legend of 31 trips plus 20 countries. This map answers the
 * simpler question a lifetime map is actually for — *where* has this
 * journal been — with one fixed colour per visited country and a continent
 * switch to zoom in where it happened, and draws no route, no dot and no
 * trip legend at all.
 */
export default function LifetimeMap({
  visits = [],
  views = [],
  continents = [],
  pinned,
  onPinnedChange,
}: {
  /** Countries visited, and by which trips — for the fill, the legend and
   * the focus/hover label. Empty falls back to nothing drawn but ground:
   * a journal whose days carry no `country:` (`viki`) gets a plain world
   * rather than an empty one. B361. */
  visits?: CountryVisit[];
  /** Every selectable view ("all", each qualifying continent, each
   * qualifying area), pre-framed and pre-clipped on the server —
   * `lib/lifetimeMapViews.ts`. Empty when there is nothing to frame at all
   * (an upcoming-only journal), in which case the map draws the plain
   * world with no fill. */
  views?: LifetimeView[];
  /** The continent (and, per continent, area) buttons to draw above the
   * map — same source as `views`. */
  continents?: ContinentButton[];
  /** The pinned country's code, or `null` — owned by the parent
   * (`TripsIndexContent`), which is also what filters the trip cards below
   * the map to it (decision 7). Controlled rather than internal state: the
   * cards' own "✕ All trips" button has to clear the same value the map's
   * pulsing outline reads, and two copies of it would drift the moment
   * either side clears without the other. */
  pinned: string | null;
  onPinnedChange: (code: string | null) => void;
}) {
  const { t, tn } = useI18n();
  const worldLand = useWorldLand();
  const filling = visits.length > 0;
  const allView = views.find((v) => v.id === "all") ?? null;

  const [selectedId, setSelectedId] = useState<string>("all");
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  // Not a lazy initializer: `matchMedia` is browser-only, and reading it
  // while rendering (even guarded) is exactly what B454's hydration-safety
  // keeper (test/hydration-safety.test.ts) exists to catch — a component
  // must produce the same tree on the server and on the browser's first
  // pass. An effect is the accepted place for this (`components/CurrencyProvider.tsx`).
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting a media-query capability on mount, the same pattern CurrencyProvider and nine other components in this codebase use.
    setCanHover(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  const [activeCode, setActiveCode] = useState<string | null>(null); // keyboard focus, for the visible caption

  // Also lazy: a remount after the Einstieg already played (a client-side
  // route change back to this page) starts directly on the target view
  // rather than the whole-world frame the effect below would otherwise
  // have to `setState` its way out of on the very first render.
  const [displayFrame, setDisplayFrame] = useState<Vec>(() =>
    einstiegPlayed ? (allView?.frame ?? WORLD_FRAME) : WORLD_FRAME,
  );
  const [displayBasemap, setDisplayBasemap] = useState<Basemap | null>(() =>
    einstiegPlayed ? (allView?.basemap ?? null) : null,
  );
  // Starts at 1 (fully revealed), not 0 — B361's "no JavaScript still gets
  // fills" applies to the very first paint too, server-rendered or not, so
  // every fill is visible before any client effect runs. The Einstieg effect
  // below is what drops this to 0 and animates it back up, entirely inside
  // the one client-only tween — a brief flash on a fresh load rather than a
  // blank map for anyone without JavaScript at all.
  const [revealed, setRevealed] = useState(1);

  const frameRef = useRef<Vec>(displayFrame);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The basemap a glide should end on — read at completion time rather
   * than captured in `animateTo`'s own closure. Found live, on a real
   * journal: a continent view starts its glide with no basemap yet (still
   * being fetched), and if `/api/lifetime-map-view` resolved *faster* than
   * the 700ms glide, the fetch's own `setDisplayBasemap` ran first and the
   * glide's completion then overwrote it right back to the `null` it was
   * called with — the ground never actually updated, every time the fetch
   * happened to win the race, which on a local dev server is most of the
   * time. Both the fetch and the glide's completion now write through
   * this ref and read it back, so whichever finishes last is what shows,
   * instead of whichever was captured first.
   */
  const targetBasemapRef = useRef<Basemap | null>(null);

  function cancelAnimation() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    rafRef.current = null;
    timeoutRef.current = null;
  }

  function animateTo(target: Vec, targetBasemap: Basemap | null, opts: { duration: number; einstieg?: boolean }) {
    cancelAnimation();
    targetBasemapRef.current = targetBasemap;
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      if (opts.einstieg) einstiegPlayed = true;
      setDisplayFrame(target);
      frameRef.current = target;
      setDisplayBasemap(targetBasemapRef.current);
      setRevealed(1);
      return;
    }
    const from = frameRef.current;
    const startRaw = toRaw(from);
    const endRaw = toRaw(target);
    const startTime = performance.now();
    if (opts.einstieg) setRevealed(0);

    const step = (now: number) => {
      // Only marked "played" once a frame actually runs — not when the
      // tween is merely requested. React's development StrictMode mounts
      // an effect, immediately cleans it up, then mounts it again; the
      // cleanup here (`cancelAnimation`, from the other effect below)
      // cancels the *pending* rAF before the browser ever calls it, so if
      // `einstiegPlayed` were set synchronously in the effect body, the
      // second, surviving mount would see it already true and never
      // restart what the first mount's cancellation just threw away. This
      // way the flag is only true once the browser has actually painted a
      // frame of it.
      if (opts.einstieg) einstiegPlayed = true;
      const t = Math.min(1, (now - startTime) / opts.duration);
      const e = easeInOut(t);
      const rawCx = lerp(startRaw.rawCx, endRaw.rawCx, e);
      const rawW = Math.exp(lerp(Math.log(startRaw.rawW), Math.log(endRaw.rawW), e));
      const cy = lerp(startRaw.cy, endRaw.cy, e);
      const h = Math.exp(lerp(Math.log(startRaw.h), Math.log(endRaw.h), e));
      const k = kOf(latOfCy(cy));
      const w = rawW * k;
      const next: Vec = { x: rawCx * k - w / 2, y: cy - h / 2, w, h, lngScale: k };
      frameRef.current = next;
      setDisplayFrame(next);
      if (opts.einstieg) setRevealed(t);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplayBasemap(targetBasemapRef.current);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    // A tab backgrounded mid-glide, or headless capture where rAF never
    // fires, must not leave the map frozen half-way — the same guard the
    // clickable draft gave every tween.
    timeoutRef.current = setTimeout(() => {
      if (opts.einstieg) einstiegPlayed = true;
      frameRef.current = target;
      setDisplayFrame(target);
      setDisplayBasemap(targetBasemapRef.current);
      setRevealed(1);
      cancelAnimation();
    }, opts.duration + 300);
  }

  // Einstieg: once per page load, the world glides into "Alle" while
  // countries colour in west to east — decision 5. Never replayed on a
  // later switch, and skipped outright under reduced motion (handled
  // inside `animateTo`).
  useEffect(() => {
    if (!allView || einstiegPlayed) return; // the lazy initializers above already reflect this state.
    frameRef.current = WORLD_FRAME;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off a requestAnimationFrame tween is exactly the "external system" case the rule carves out; it is not a synchronous re-render loop.
    animateTo(allView.frame, allView.basemap, { duration: EINSTIEG_MS, einstieg: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, keyed on mount only.
  }, []);

  useEffect(() => () => cancelAnimation(), []);

  /**
   * Basemaps fetched on demand (`/api/lifetime-map-view`) for every view
   * but "Alle" — measured at up to 1.7 MB inline for a real journal's ten
   * views, so only the frame ships up front and this is filled in the
   * first time each view is actually selected. A plain object, not state:
   * nothing about *drawing* the map depends on this cache directly — only
   * `displayBasemap` (below) does, and that is what a fetch's `then` sets.
   */
  const fetchedBasemapsRef = useRef<Map<string, Basemap>>(new Map());
  const selectedIdRef = useRef(selectedId);

  function selectView(id: string) {
    if (id === selectedId) return;
    const view = views.find((v) => v.id === id);
    if (!view) return;
    setSelectedId(id);
    selectedIdRef.current = id;
    const cached = view.basemap ?? fetchedBasemapsRef.current.get(id) ?? null;
    animateTo(view.frame, cached, { duration: GLIDE_MS });
    if (view.basemap === null && !fetchedBasemapsRef.current.has(id)) {
      const { x, y, w, h, lngScale } = view.frame;
      fetch(`/api/lifetime-map-view?x=${x}&y=${y}&w=${w}&h=${h}&lngScale=${lngScale}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { basemap: Basemap | null } | null) => {
          if (!data?.basemap) return;
          fetchedBasemapsRef.current.set(id, data.basemap);
          // Swap in only if still on this view — a reader who has already
          // moved on by the time this resolves must not have their new
          // view's ground pulled out from under them. Also updates the
          // ref a still-in-flight glide's own completion reads, so a fetch
          // that resolves before the glide finishes is not overwritten
          // back to null once it does.
          if (selectedIdRef.current === id) {
            targetBasemapRef.current = data.basemap;
            setDisplayBasemap(data.basemap);
          }
        })
        .catch(() => {
          // A failed fetch leaves the plain world outline drawn — the same
          // fallback a journal with no basemap bundle at all already gets.
        });
    }
    if (pinned && !view.countryCodes.includes(pinned)) setPin(null);
  }

  function setPin(code: string | null) {
    onPinnedChange(code);
  }

  function togglePin(code: string) {
    setPin(pinned === code ? null : code);
  }

  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  const currentView = views.find((v) => v.id === selectedId);
  const inView = new Set(currentView?.countryCodes ?? visits.map((v) => v.code));

  const byCode = new Map(visits.map((v) => [v.code, v]));
  const pinnedVisit = pinned ? byCode.get(pinned) : null;
  const hoverVisit = hoverCode ? byCode.get(hoverCode) : null;

  // Legend: countries only, sorted by trip count, following the current
  // selection — decision 10.
  const legend = visits
    .filter((v) => inView.has(v.code))
    .slice()
    .sort((a, b) => b.trips.length - a.trips.length);

  const label = t("trips.mapLabel");

  return (
    <figure
      className="overflow-hidden rounded-2xl border border-line-quiet"
      style={{ backgroundColor: mapStyle.sea }}
    >
      {(continents.length >= 2 || (currentView?.kind === "continent" && (continents.find((c) => c.continent === currentView.continent)?.areas.length ?? 0) >= 2)) && (
        <div className="flex gap-2 overflow-x-auto border-b border-line-quiet bg-surface-raised px-4 py-2.5 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ViewButton active={selectedId === "all"} onClick={() => selectView("all")}>
            {t("trips.map.all")}
          </ViewButton>
          {continents.length >= 2 &&
            continents.map((c) => (
              <ViewButton key={c.continent} active={selectedId === c.continent} onClick={() => selectView(c.continent)}>
                {t(c.labelKey)} {c.count}
              </ViewButton>
            ))}
          {currentView &&
            (currentView.kind === "continent" || currentView.kind === "area") &&
            continents
              .find((c) => c.continent === currentView.continent)
              ?.areas.map((a) => (
                <ViewButton
                  key={a.subregion}
                  active={selectedId === `${currentView.continent}\u0000${a.subregion}`}
                  onClick={() => selectView(`${currentView.continent}\u0000${a.subregion}`)}
                >
                  {t(a.labelKey)} {a.count}
                </ViewButton>
              ))}
        </div>
      )}
      <svg
        viewBox={`${displayFrame.x} ${displayFrame.y} ${displayFrame.w} ${displayFrame.h}`}
        className="block h-auto min-h-[260px] w-full sm:aspect-[2/1] sm:min-h-0 aspect-[1.08/1]"
        role={filling ? "group" : "img"}
        aria-label={label}
        // No pinch or drag on the map itself (decision 9) — the page
        // scrolls over it; the continent/area row above scrolls on its own.
        style={{ touchAction: "pan-y" }}
      >
        <g transform={`scale(${displayFrame.lngScale} 1)`}>
          {displayBasemap ? (
            <g fill={mapStyle.land} stroke={mapStyle.border} strokeWidth={1}>
              {displayBasemap.borders.map((d, i) => (
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
          {filling && (
            <g stroke={mapStyle.ice} strokeWidth={0.8}>
              {visits.map((v) => {
                const fill = (countryColours as Record<string, string>)[v.code] ?? mapStyle.visited;
                // Einstieg reveal — west to east across the fixed 1000-unit
                // world, independent of the current frame.
                const normalizedX = v.x / 1000;
                const revealOpacity = revealed >= normalizedX ? 1 : 0;
                const faded = inView.has(v.code) ? 1 : FADE_OPACITY;
                const opacity = Math.min(revealOpacity, faded);
                const isPinned = pinned === v.code;

                const focus = canHover
                  ? {
                      onMouseEnter: (e: React.MouseEvent) => {
                        setHoverCode(v.code);
                        setHoverPos({ x: e.clientX, y: e.clientY });
                      },
                      onMouseMove: (e: React.MouseEvent) => setHoverPos({ x: e.clientX, y: e.clientY }),
                      onMouseLeave: () => setHoverCode(null),
                    }
                  : {};

                const ariaLabel = `${v.name} — ${v.trips.length} ${tn("trips.lifetimeTrips", v.trips.length)}`;
                const focusRing =
                  "outline-2 outline-offset-1 outline-transparent focus-visible:outline-[var(--map-stop-ring)]";

                return (
                  <g
                    key={v.code}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isPinned}
                    aria-label={ariaLabel}
                    className={focusRing}
                    onFocus={() => setActiveCode(v.code)}
                    onBlur={() => setActiveCode(null)}
                    onClick={() => togglePin(v.code)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePin(v.code);
                      }
                    }}
                    {...focus}
                  >
                    <path
                      d={v.path}
                      fill={fill}
                      opacity={opacity}
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer transition-opacity duration-150"
                    />
                    {isPinned && (
                      <path
                        d={v.path}
                        fill="none"
                        stroke={mapStyle.stopRing}
                        strokeWidth={2.5}
                        vectorEffect="non-scaling-stroke"
                        className="lifetime-map-pin-pulse"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          )}
          {displayBasemap && (
            <>
              <g fill="none" stroke={mapStyle.water} strokeWidth={0.5}>
                {displayBasemap.rivers.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g fill={mapStyle.water} stroke={mapStyle.border} strokeWidth={0.7}>
                {displayBasemap.lakes.map((d, i) => (
                  <path key={i} d={d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            </>
          )}
        </g>
      </svg>
      {canHover && hoverVisit && hoverPos && (
        <div
          className="pointer-events-none fixed z-10 -translate-x-1/2 -translate-y-full rounded-md bg-surface-raised px-2 py-1 text-xs shadow-md"
          style={{ left: hoverPos.x, top: hoverPos.y - 8 }}
        >
          {flagFromCode(hoverVisit.code)} {hoverVisit.name} · {hoverVisit.trips.length}
        </div>
      )}
      {filling && (
        <div className="min-h-0 px-4 pt-2 text-xs text-ink-body empty:hidden empty:p-0">
          {pinnedVisit ? (
            <span className="flex items-center gap-2" aria-live="polite">
              {flagFromCode(pinnedVisit.code)} {pinnedVisit.name} · {pinnedVisit.trips.length}{" "}
              {tn("trips.lifetimeTrips", pinnedVisit.trips.length)} · {t("trips.map.filteredBelow")}
              <button
                type="button"
                onClick={() => setPin(null)}
                className="min-h-6 rounded px-1.5 text-ink-secondary underline underline-offset-2 hover:text-ink-strong"
              >
                ✕ {t("trips.allTrips")}
              </button>
            </span>
          ) : (
            activeCode &&
            byCode.get(activeCode) && (
              <span aria-live="polite">
                {byCode.get(activeCode)!.name} — {byCode.get(activeCode)!.trips.map((tr) => tr.title).join(", ")}
              </span>
            )
          )}
        </div>
      )}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-quiet bg-surface-raised px-4 py-3 text-xs text-ink-body">
        {legend.map((v) => (
          <span key={v.code} className="flex items-center gap-1.5">
            <span aria-hidden>{flagFromCode(v.code)}</span>
            {v.name}
            {v.trips.length > 1 && <span className="text-ink-secondary">×{v.trips.length}</span>}
          </span>
        ))}
      </figcaption>
    </figure>
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
      className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-medium transition-colors ${
        active
          ? "bg-ink-strong text-on-action"
          : "bg-surface-muted text-ink-secondary hover:bg-surface-subtle hover:text-ink-strong"
      }`}
    >
      {children}
    </button>
  );
}
