"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { useSnapDrag } from "@/components/SnapSheet";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { flagFor } from "@/lib/flags";
import { googleMapsHref } from "@/lib/tripMap";
import type { PlaceView } from "@/components/WorldMap";

/** Peek, half, full — B2427 (docs/plans/map-redesign.md §3 Phase 2 item 2),
 * generalising `MobileDaySheet`'s (B2327) drag/snap logic through
 * `useSnapDrag` rather than a second bespoke implementation. */
const PEEK = 0;
const HALF = 1;
const FULL = 2;

/** Half never asks for more than this share of the viewport, so whatever the
 * map is drawn at keeps at least 55% of the screen — the other named
 * constraint in the plan. Comfortably under 0.45 rather than exactly at the
 * line, so a rounding pixel never tips it over. */
const HALF_MAX_VH = 0.42;
const FULL_MAX_VH = 0.86;
/** The peek row: the stats grid plus the scrubber slot, a fixed content
 * height rather than a vh fraction — it doesn't grow with the screen.
 * `MapPageContent` pads its own bottom by this same number so the page's
 * content never sits behind the sheet at rest — keep the two in sync. */
const PEEK_PX = 176;

function useViewportHeight(): number {
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vh;
}

/** Whether this sheet is actually on screen — the wrapping div is
 * `lg:hidden`, and above that breakpoint the map keeps the desktop layout
 * (a stop list beside it) where nothing covers the map at all. Compared
 * against the same `lg` Tailwind breakpoint (1024px, unset in this app's
 * own theme) via `window.innerWidth` rather than measuring the DOM node, so
 * the reported inset lands on the sheet's own settled snap height rather
 * than tracking every frame of its open/close spring. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return desktop;
}

export default function MobileMapSheet({
  places,
  stats,
  scrubberSlot,
  hrefForDay,
  selectedKey,
  onSelectKey,
  onInsetChange,
}: {
  places: PlaceView[];
  stats: { tripDays: number; places: number; countries: number; totalMedia: number };
  /** Where B2428's time scrubber sits, at peek — the map page's own copy of
   * it (`WorldMap`'s is desktop-only, `hidden lg:block`), reading and
   * writing the same `selectedKey`/`onSelectKey` this sheet does. */
  scrubberSlot?: ReactNode;
  hrefForDay: (slug: string) => string;
  /** The map page's one selection (lifted to `MapPageContent`, reviewed
   * after B2427's first pass) — a marker tap, the scrubber, or a stop here
   * all land on this same key, and `WorldMap` applies it through its own
   * `selectPlace`, so the camera follows exactly as a tap on the map itself
   * would. */
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  /** B2517: called with how tall this sheet's *current snap* stands, in
   * CSS px, so `WorldMap` can frame the whole trip and a selected stop into
   * the part of the map above it rather than the box's full height. Fires
   * with 0 wherever the sheet is not actually on screen — no places at all,
   * or `lg` and up, where the desktop layout puts nothing over the map. Not
   * the sheet's live, mid-drag height: framing follows the settled snap,
   * the same "peek and half" the ticket names, not every animation frame of
   * the spring between them. */
  onInsetChange?: (px: number) => void;
}) {
  const { t, tn, locale, formatShortDate, formatStay } = useI18n();
  const reducedMotion = useReducedMotion();
  const vh = useViewportHeight();
  const isDesktop = useIsDesktop();

  const [snap, setSnap] = useState(PEEK);

  const heights = useMemo(
    () => [PEEK_PX, Math.round(vh * HALF_MAX_VH), Math.round(vh * FULL_MAX_VH)],
    [vh],
  );

  useEffect(() => {
    onInsetChange?.(places.length === 0 || isDesktop ? 0 : heights[snap]);
  }, [onInsetChange, places.length, isDesktop, heights, snap]);
  const { height, bind } = useSnapDrag({
    heights,
    index: snap,
    onIndexChange: setSnap,
    reducedMotion,
  });

  // Escape always goes to peek, wherever focus is inside the sheet — the
  // same convention `MobileDaySheet` uses for its own Escape-to-close.
  useEffect(() => {
    if (snap === PEEK) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSnap(PEEK);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap]);

  // A tap cycles snaps the same as Enter/Space; a drag settles through
  // `useSnapDrag` instead, and must not also fire this — a mouse drag (never
  // a touch one) still ends in a `click`, so the handle's own onPointerDown/
  // move track whether the gesture actually moved before deciding.
  const dragMoved = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // A new selection — a marker tapped on the map, the scrubber dragged (from
  // either copy of it), or a stop picked here — opens the sheet to Half, so
  // whichever surface drove it, the result is the same stop in view. Not on
  // the very first render (the page's own default selection shouldn't pop
  // the sheet open by itself), and not on a selection *clearing* (`null`
  // only ever comes from the map's own close button, which shouldn't reopen
  // a sheet that was closed).
  const lastKey = useRef(selectedKey);
  useEffect(() => {
    if (selectedKey && selectedKey !== lastKey.current) setSnap(HALF);
    lastKey.current = selectedKey;
  }, [selectedKey]);

  if (places.length === 0) return null;

  const selectedIndex = Math.max(
    0,
    places.findIndex((p) => p.key === selectedKey),
  );
  const selected = places[selectedIndex];

  const goToStop = (place: PlaceView) => onSelectKey(place.key);

  const cycleLabel =
    snap === PEEK ? t("map.thisStop") : snap === HALF ? t("map.everyStop") : t("map.sheet.peek");

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
      <motion.div
        style={{ height }}
        className="flex flex-col overflow-hidden rounded-t-2xl border-t border-line-quiet bg-surface-subtle/95 shadow-[0_-6px_24px_rgba(30,41,59,0.16)] backdrop-blur"
      >
        {/* The drag handle is a real button — Enter/Space cycles snaps,
            keyboard users are never limited to the drag gesture the pill
            invites everyone else to try. */}
        <button
          type="button"
          onPointerDown={(e) => {
            dragStart.current = { x: e.clientX, y: e.clientY };
            dragMoved.current = false;
            bind.onPointerDown(e);
          }}
          onPointerMove={(e) => {
            const start = dragStart.current;
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
              dragMoved.current = true;
            }
            bind.onPointerMove(e);
          }}
          onPointerUp={bind.onPointerUp}
          onPointerCancel={bind.onPointerCancel}
          onClick={() => {
            if (!dragMoved.current) setSnap((s) => (s + 1) % 3);
          }}
          className="flex shrink-0 touch-none items-center justify-center gap-1.5 py-2 text-xs font-semibold text-ink-secondary"
          aria-label={cycleLabel}
        >
          <span className="h-1 w-9 rounded-full bg-line-quiet" aria-hidden />
          {snap === FULL ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
          {snap === PEEK && (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-4 gap-2">
                <PeekStat label={tn("map.days", stats.tripDays)} value={stats.tripDays} />
                <PeekStat label={tn("map.stops", stats.places)} value={stats.places} />
                <PeekStat label={tn("map.countries", stats.countries)} value={stats.countries} />
                <PeekStat label={t("map.media")} value={stats.totalMedia} />
              </dl>
              {scrubberSlot}
            </div>
          )}

          {snap === HALF && selected && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-base font-semibold text-ink-strong">
                    {flagFor(selected.country, selected.countryCode)} {selected.location}
                  </div>
                  <div className="text-xs text-ink-secondary">
                    {formatShortDate(selected.firstDate)}
                    {selected.lastDate !== selected.firstDate && ` – ${formatShortDate(selected.lastDate)}`}
                    {" · "}
                    {formatStay(selected.nights)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => goToStop(places[(selectedIndex - 1 + places.length) % places.length])}
                    aria-label={t("tripMap.previousStop")}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line-quiet text-ink-body"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStop(places[(selectedIndex + 1) % places.length])}
                    aria-label={t("tripMap.nextStop")}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line-quiet text-ink-body"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              {/* The day's own opening line — never invented, only what
                  `PlaceEntry.headline` already carries for the reader's
                  locale (falls back to whichever locale it has). */}
              {(selected.entries[0]?.headline[locale] ??
                Object.values(selected.entries[0]?.headline ?? {})[0]) && (
                <p className="text-sm text-ink-body">
                  {selected.entries[0].headline[locale] ?? Object.values(selected.entries[0].headline)[0]}
                </p>
              )}

              {selected.entries.some((e) => e.gallery.length > 0) && (
                <div className="flex gap-1.5 overflow-x-auto">
                  {selected.entries
                    .flatMap((e) => e.gallery)
                    .slice(0, 8)
                    .map((m) => (
                      <span
                        key={m.src}
                        className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line-quiet bg-surface-muted"
                      >
                        {m.type === "video" ? (
                          <video
                            src={m.src}
                            poster={posterSrc(m.poster, POSTER_WIDTH.GRID)}
                            preload={m.poster ? "none" : "metadata"}
                            className="h-full w-full object-cover"
                            muted
                          />
                        ) : (
                          <Image
                            src={m.src}
                            loader={mediaLoader}
                            alt={m.alt ?? m.caption ?? selected.location}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        )}
                      </span>
                    ))}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-semibold">
                <a
                  href={hrefForDay(selected.entries[0].slug)}
                  className="text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-2"
                >
                  {t("map.readDay")} →
                </a>
                <a
                  href={googleMapsHref(selected)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-ink-secondary underline decoration-line-quiet underline-offset-2"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {t("tripMap.googleMaps")}
                </a>
              </div>
            </div>
          )}

          {snap === FULL && (
            <ol className="divide-y divide-line-quiet">
              {places.map((place) => (
                <li key={place.key}>
                  <button
                    type="button"
                    onClick={() => {
                      // Explicit, not only the generic "a new selection opens
                      // Half" effect below: re-tapping the stop already
                      // selected changes no key, so that effect wouldn't
                      // fire, and tapping a row in Full should always jump to
                      // Half.
                      goToStop(place);
                      setSnap(HALF);
                    }}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-sm font-semibold text-ink-strong">
                        {flagFor(place.country, place.countryCode)} {place.location}
                      </span>
                      <span className="block text-xs text-ink-secondary">
                        {formatShortDate(place.firstDate)}
                        {place.lastDate !== place.firstDate && ` – ${formatShortDate(place.lastDate)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-secondary">
                      {formatStay(place.nights)} · {place.mediaCount} {t("media.count")}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function PeekStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line-quiet bg-surface-raised px-2 py-1.5 text-center">
      <dt className="text-[10px] text-ink-secondary">{label}</dt>
      <dd className="font-display text-base font-semibold text-ink-strong">{value}</dd>
    </div>
  );
}
