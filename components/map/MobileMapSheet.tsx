"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, MapPin } from "lucide-react";
import { useSnapDrag } from "@/components/SnapSheet";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { flagFor } from "@/lib/flags";
import { googleMapsHref } from "@/lib/tripMap";
import type { PlaceView } from "@/components/WorldMap";
import type { MapDay } from "@/lib/map/mapDays";

/** B2572 — the two things to do with a selected day, as buttons rather than
 * underlined text: read it (primary), or find it in Google Maps. Shared with
 * the desktop list in MapPageContent. */
export const READ_DAY_BUTTON =
  "inline-flex min-h-11 flex-1 basis-36 items-center justify-center gap-1.5 rounded-full border-2 border-navy-900 " +
  "bg-yellow-400 px-4 text-sm font-bold text-navy-900 shadow-[0_2px_0_var(--color-navy-900)] transition-colors " +
  "hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
export const MAPS_BUTTON =
  "inline-flex min-h-11 flex-1 basis-36 items-center justify-center gap-1.5 rounded-full border-2 border-line-ink " +
  "px-4 text-sm font-bold text-ink-strong transition-colors hover:bg-surface-subtle " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

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
/** The peek row: the day strip alone (the stat tiles that used to sit above
 * it are gone — review: "the map is the page"), a fixed content height
 * rather than a vh fraction — it doesn't grow with the screen.
 * `MapPageContent` pads its own bottom by this same number so the page's
 * content never sits behind the sheet at rest — keep the two in sync. */
const PEEK_PX = 118;

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
 * (a day list beside it) where nothing covers the map at all. Compared
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
  days,
  places,
  hrefForDay,
  selectedDate,
  onSelectDate,
  onInsetChange,
  onPlay,
}: {
  /** Every published day, in order, including one with no place at all
   * (greyed — B2537). The strip at peek and the full list both read this
   * rather than `places`, so a placeless day is never simply missing. */
  days: MapDay[];
  places: PlaceView[];
  hrefForDay: (slug: string) => string;
  /** The map page's one selection, by calendar date — B2537 (was a place
   * `key`; a date is what the day strip/list itself is keyed on, and it
   * still resolves to a place through `firstDate`…`lastDate` for the map). */
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  /** Opens the Diashow, from the start or at one day — B2654: the map
   * page's own Slideshow button lives in the desktop day list, so a phone
   * had no way in. Absent when the trip has no places to show. */
  onPlay?: (date?: string) => void;
  /** B2517: called with how tall this sheet's *current snap* stands, in
   * CSS px, so `WorldMap` can frame the whole trip and a selected stop into
   * the part of the map above it rather than the box's full height. Fires
   * with 0 wherever the sheet is not actually on screen — no days at all,
   * or `lg` and up, where the desktop layout puts nothing over the map. */
  onInsetChange?: (px: number) => void;
}) {
  const { t, locale, formatShortDate } = useI18n();
  const reducedMotion = useReducedMotion();
  const vh = useViewportHeight();
  const isDesktop = useIsDesktop();

  const [snap, setSnap] = useState(PEEK);

  const heights = useMemo(
    () => [PEEK_PX, Math.round(vh * HALF_MAX_VH), Math.round(vh * FULL_MAX_VH)],
    [vh],
  );

  useEffect(() => {
    onInsetChange?.(days.length === 0 || isDesktop ? 0 : heights[snap]);
  }, [onInsetChange, days.length, isDesktop, heights, snap]);
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

  // A new selection — a marker tapped on the map, or a day picked here —
  // opens the sheet to Half, so whichever surface drove it, the result is
  // the same day in view. Not on the very first render (the page's own
  // default selection shouldn't pop the sheet open by itself). Clearing a
  // selection returns to the strip, with no day's details left open.
  // Adjusted during render rather than in an effect (React's own pattern for
  // state that follows a prop), so there is no extra cascading render.
  const [lastDate, setLastDate] = useState(selectedDate);
  if (selectedDate !== lastDate) {
    setLastDate(selectedDate);
    setSnap(selectedDate ? HALF : PEEK);
  }

  if (days.length === 0) return null;

  const selectedIndex = days.findIndex((d) => d.date === selectedDate);
  const selectedDay = days[selectedIndex];
  const selectedPlace = places.find(
    (p) => selectedDay && selectedDay.date >= p.firstDate && selectedDay.date <= p.lastDate,
  );

  const goToDay = (day: MapDay) => onSelectDate(day.date);

  const cycleLabel =
    snap === PEEK ? t("map.thisStop") : snap === HALF ? t("map.everyDay") : t("map.sheet.peek");

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
            <div className="flex flex-col gap-3 pt-2">
              {/* The day strip — B2537, replacing the old time scrubber and
                  the stat tiles that used to sit above it (per review: "the
                  map is the page" — a stat grid isn't). "days along the
                  bottom on a phone: a strip of date + place + update count."
                  A day with no place still gets a row, greyed, so the strip
                  is never quietly missing one. */}
              <div className="flex gap-1.5">
              {/* Pinned beside the strip, not in it: the list is the days,
                  and this stays in reach however far the days scroll. */}
              {onPlay && (
                <button
                  type="button"
                  onClick={() => onPlay()}
                  className="flex shrink-0 flex-col items-start justify-center gap-1 rounded-lg border-2 border-navy-900 bg-yellow-400 px-2.5 py-1.5 text-left text-xs font-bold text-navy-900"
                >
                  <Clapperboard className="h-4 w-4" aria-hidden />
                  {t("show.start")}
                </button>
              )}
              <div
                role="list"
                aria-label={t("map.everyDay")}
                className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
              >
                {days.map((day) => {
                  const isSelected = day.date === selectedDate;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => goToDay(day)}
                      className={`flex shrink-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                        isSelected
                          ? "border-ink-strong bg-surface-selected"
                          : day.hasPlace
                            ? "border-line-quiet bg-surface-raised"
                            : "border-dashed border-line-quiet bg-surface-raised text-ink-secondary"
                      }`}
                    >
                      <span className="font-semibold text-ink-strong">
                        {formatShortDate(day.date)}
                      </span>
                      <span className="truncate">
                        {day.hasPlace ? day.location : t("map.noPlaceGiven")}
                      </span>
                      <span className="text-[10px] text-ink-secondary">
                        {day.mediaCount} {t("media.count")}
                      </span>
                    </button>
                  );
                })}
              </div>
              </div>
            </div>
          )}

          {snap === HALF && selectedDay && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-base font-semibold text-ink-strong">
                    {selectedDay.hasPlace
                      ? `${flagFor(selectedDay.country, selectedDay.countryCode)} ${selectedDay.location}`
                      : t("map.noPlaceGiven")}
                  </div>
                  <div className="text-xs text-ink-secondary">{formatShortDate(selectedDay.date)}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => goToDay(days[(selectedIndex - 1 + days.length) % days.length])}
                    aria-label={t("tripMap.previousStop")}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line-quiet text-ink-body"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToDay(days[(selectedIndex + 1) % days.length])}
                    aria-label={t("tripMap.nextStop")}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line-quiet text-ink-body"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              {selectedPlace && (
                <>
                  {(selectedPlace.entries[0]?.headline[locale] ??
                    Object.values(selectedPlace.entries[0]?.headline ?? {})[0]) && (
                    <p className="text-sm text-ink-body">
                      {selectedPlace.entries[0].headline[locale] ??
                        Object.values(selectedPlace.entries[0].headline)[0]}
                    </p>
                  )}

                  {selectedPlace.entries.some((e) => (e.gallery ?? []).length > 0) && (
                    <div className="flex gap-1.5 overflow-x-auto">
                      {selectedPlace.entries
                        .flatMap((e) => e.gallery ?? [])
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
                                alt={m.alt ?? m.caption ?? selectedPlace.location}
                                fill
                                sizes="64px"
                                className="object-cover"
                              />
                            )}
                          </span>
                        ))}
                    </div>
                  )}

                  <div className="mt-1 flex flex-wrap gap-2">
                    <a href={hrefForDay(selectedPlace.entries[0].slug)} className={READ_DAY_BUTTON}>
                      {t("map.readDay")}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </a>
                    <a href={googleMapsHref(selectedPlace)} target="_blank" rel="noreferrer" className={MAPS_BUTTON}>
                      <MapPin className="h-4 w-4" aria-hidden />
                      {t("map.googleMapsShort")}
                    </a>
                    {onPlay && (
                      // Starts the show at this day rather than the first.
                      <button type="button" onClick={() => onPlay(selectedDay.date)} className={MAPS_BUTTON}>
                        <Clapperboard className="h-4 w-4" aria-hidden />
                        {t("show.start")}
                      </button>
                    )}
                  </div>
                </>
              )}

              {!selectedPlace && (
                <div className="flex">
                  <a href={hrefForDay(selectedDay.slug)} className={READ_DAY_BUTTON + " flex-none"}>
                    {t("map.readDay")}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              )}
            </div>
          )}

          {snap === FULL && (
            <ol className="divide-y divide-line-quiet">
              {days.map((day) => (
                <li key={day.date}>
                  <button
                    type="button"
                    onClick={() => {
                      // A new day opens its details; repeating it returns
                      // to the whole-trip strip.
                      goToDay(day);
                      setSnap(day.date === selectedDate ? PEEK : HALF);
                    }}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-sm font-semibold text-ink-strong">
                        {day.hasPlace
                          ? `${flagFor(day.country, day.countryCode)} ${day.location}`
                          : t("map.noPlaceGiven")}
                      </span>
                      <span className="block text-xs text-ink-secondary">
                        {formatShortDate(day.date)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-secondary">
                      {day.mediaCount} {t("media.count")}
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
