"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import DayFacts from "@/components/map/DayFacts";
import { useViewerPreload } from "@/components/map/usePreload";
import { cachedDay, loadWindow, type StoryFetch } from "@/lib/map/storyCache";
import { pauseOthers } from "@/lib/mediaPreload";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { useOptionalSite } from "@/components/SiteProvider";
import CommentsProvider from "@/components/CommentsProvider";
import ReactionsProvider from "@/components/ReactionsProvider";
import DayComments from "@/components/DayComments";
import DayReactions from "@/components/DayReactions";
import Prose from "@/components/Prose";
import Lightbox from "@/components/Lightbox";
import FullPhoto from "@/components/FullPhoto";
import { mediaLoader, posterSrc } from "@/components/mediaLoader";
import { swipeIntent } from "@/components/swipe";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { flagFor } from "@/lib/flags";
import type { MapDay } from "@/lib/map/mapDays";

/** B-2980 — the day, read in place on the map: its text, photographs, reactions and comments. */

const NAV_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-quiet text-ink-body " +
  "hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-40";

/**
 * Horizontal swipe on a day card → previous/next day, through the same
 * threshold the photo viewer uses. Vertical scrolling and text fields are left alone.
 */
export function useDaySwipe(onPrev?: () => void, onNext?: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      const skip = (e.target as Element).closest("textarea,input,table,[data-no-swipe]");
      start.current = skip ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) < Math.abs(e.clientY - s.y) * 1.5) return;
      const intent = swipeIntent(dx, dx / Math.max(1, e.timeStamp - s.t) * 1000);
      if (intent === "prev") onPrev?.();
      else if (intent === "next") onNext?.();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/**
 * The selected day's text, fetched from the same `story.json` the story page
 * pages through (same gate, same photo visibility, prose rendered in the
 * reader's language), so the map's own payload carries none of it. Fetches the
 * day and its neighbours together, then the next one ahead of a step forward.
 */
const fetchWindow: StoryFetch = (url) => fetch(url).then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));

function useStoryDay(index: number, date: string, count: number) {
  const trip = useTrip();
  const { locale } = useI18n();
  const [, bump] = useState(0);
  const [failed, setFailed] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ref = trip?.trip.ref;
  const base = trip?.userHref("/story.json");
  // Read straight from the shared cache, which `usePrefetchDays` may already have filled.
  const day = ref && base ? cachedDay(base, ref, locale, index, date) : undefined;
  const nextCached = !(ref && base) || index + 1 >= count || cachedDay(base, ref, locale, index + 1) !== undefined;
  const missing = !day ? index : !nextCached ? index + 1 : -1;

  useEffect(() => {
    if (missing < 0 || !ref || !base) return;
    let live = true;
    loadWindow(base, ref, locale, missing, fetchWindow)
      .then(() => {
        if (!live) return;
        setFailed(null);
        bump((n) => n + 1);
      })
      .catch(() => {
        if (live && missing === index) setFailed(index);
      });
    return () => {
      live = false;
    };
  }, [missing, index, ref, base, locale, attempt]);

  return {
    day,
    failed: !day && failed === index,
    retry: () => {
      setFailed(null);
      setAttempt((n) => n + 1);
    },
  };
}

export default function DayReader({
  day,
  index,
  count,
  transportLine,
  pageHref,
  dir,
  reduced,
  onPrev,
  onNext,
  onClose,
  className = "",
  km,
  tripCost,
}: {
  day: MapDay;
  /** Position among every published day — also the story window's index. */
  index: number;
  count: number;
  transportLine?: string;
  /** The day's own page, for a link that deep-links. */
  pageHref: string;
  /** Which way the reader just moved, for the small slide: -1 back, 1 forward. */
  dir: -1 | 0 | 1;
  reduced: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  className?: string;
  /** Kilometres recorded on this day, when any were. */
  km?: number;
  /** The trip's total spend in the base currency, when this viewer may see costs. */
  tripCost?: number;
}) {
  const trip = useTrip();
  const site = useOptionalSite();
  const ref = trip?.trip.ref;
  const body = (
    <ReaderBody
      day={day}
      index={index}
      count={count}
      transportLine={transportLine}
      pageHref={pageHref}
      dir={dir}
      reduced={reduced}
      onPrev={onPrev}
      onNext={onNext}
      onClose={onClose}
      className={className}
      km={km}
      tripCost={tripCost}
    />
  );
  // The same providers, and the same gate for comments, as the day page
  // (app/TripStory.tsx); mounted only once somebody opens a day to read.
  if (!ref) return body;
  return (
    <ReactionsProvider tripId={ref}>
      {site?.commentsEnabled ? <CommentsProvider tripId={ref}>{body}</CommentsProvider> : body}
    </ReactionsProvider>
  );
}

function ReaderBody({
  day: mapDay,
  index,
  count,
  transportLine,
  pageHref,
  dir,
  reduced,
  onPrev,
  onNext,
  onClose,
  className,
  km,
  tripCost,
}: React.ComponentProps<typeof DayReader> & { className: string }) {
  const { t, localized, formatShortDate } = useI18n();
  const { day, failed, retry } = useStoryDay(index, mapDay.date, count);
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipe = useDaySwipe(onPrev, onNext);
  const [photo, setPhoto] = useState<number | null>(null);

  // A new day starts at its top, with focus on its heading — a keyboard or
  // screen-reader user lands on what changed, not on a button that scrolled away.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, [mapDay.date]);

  const gallery = day?.entries.flatMap((e) => e.gallery) ?? [];
  useViewerPreload(gallery, photo);
  const title = mapDay.hasPlace
    ? `${flagFor(mapDay.country, mapDay.countryCode)} ${mapDay.location}`
    : formatShortDate(mapDay.date);
  const meta = [t("show.dayNumber", { n: String(index + 1) }), formatShortDate(mapDay.date), transportLine]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby={titleId} className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 items-start gap-2 pb-2 pt-1" {...swipe}>
        <button type="button" onClick={onClose} aria-label={t("map.read.close")} className={NAV_BUTTON}>
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="truncate font-display text-base font-semibold text-ink-strong outline-none"
          >
            {title}
          </h2>
          <p className="truncate text-xs text-ink-secondary">{meta}</p>
        </div>
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("day.prev")} className={NAV_BUTTON}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("day.next")} className={NAV_BUTTON}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-4" {...swipe}>
        {/* Keyed on the date: the old day is never shown under the new heading. */}
        <motion.div
          key={mapDay.date}
          initial={reduced ? false : { opacity: 0, x: dir * 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {!day && !failed && (
            <p role="status" className="py-6 text-sm text-ink-secondary">
              {t("story.dayLoading")}
            </p>
          )}
          {failed && (
            <div role="alert" className="flex flex-col items-start gap-2 py-6 text-sm text-ink-body">
              {t("map.read.failed")}
              <button
                type="button"
                onClick={retry}
                className="min-h-11 rounded-full border border-line-strong px-5 font-semibold hover:bg-surface-subtle"
              >
                {t("map.read.retry")}
              </button>
            </div>
          )}
          {day && (
            <>
              <DayFacts day={mapDay} km={km} tripCost={tripCost} className="mb-3" />
              {gallery.length > 0 && (
                <div className="mb-3 grid grid-cols-3 gap-1.5" data-no-swipe>
                  {gallery.map((m, i) => (
                    <button
                      key={m.src}
                      type="button"
                      onClick={() => setPhoto(i)}
                      aria-label={m.caption ?? t("a11y.openPhoto")}
                      className="relative block aspect-square overflow-hidden rounded-md border border-line-quiet bg-surface-muted"
                    >
                      {m.type === "video" ? (
                        <video
                          src={m.src}
                          poster={posterSrc(m.poster, POSTER_WIDTH.GRID)}
                          preload={m.poster ? "none" : "metadata"}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          onPlay={(e) => pauseOthers(e.currentTarget, document.querySelectorAll("video"))}
                        />
                      ) : (
                        <Image
                          src={m.src}
                          loader={mediaLoader}
                          alt={m.alt ?? m.caption ?? ""}
                          fill
                          sizes="(min-width: 1024px) 110px, 30vw"
                          className="object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {day.entries.map((entry) => {
                const text = localized(entry);
                return (
                  <article key={entry.slug} className="mb-4">
                    <h3 className="font-display text-lg font-semibold leading-snug text-ink-strong">
                      {text.title}
                      {entry.time && <span className="ml-2 font-mono text-[11px] font-normal text-ink-secondary">{entry.time}</span>}
                    </h3>
                    {text.fallbackNotice && <p className="mt-1 text-xs italic text-ink-secondary">{t(text.fallbackNotice)}</p>}
                    <div className="mt-2">
                      {day.prose?.[entry.slug] !== undefined ? (
                        <Prose tree={day.prose[entry.slug]} />
                      ) : (
                        <p className="whitespace-pre-line text-base leading-relaxed text-ink-body">{text.content}</p>
                      )}
                    </div>
                  </article>
                );
              })}

              {/* The same keys the day page uses: its first update's slug. */}
              <div className="mt-6 border-t border-line-faint pt-3">
                <DayReactions daySlug={day.lead.slug} compact />
                <DayComments daySlug={day.lead.slug} limit={2} compact />
              </div>

              <a
                href={pageHref}
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body underline decoration-line-quiet underline-offset-4 hover:decoration-line-prominent"
              >
                {t("map.read.openPage")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </>
          )}
        </motion.div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <Lightbox
            index={photo}
            count={gallery.length}
            onClose={() => setPhoto(null)}
            onPrev={() => setPhoto((i) => (i === null ? null : (i - 1 + gallery.length) % gallery.length))}
            onNext={() => setPhoto((i) => (i === null ? null : (i + 1) % gallery.length))}
            swipeable={photo === null || gallery[photo]?.type !== "video"}
          >
            {photo !== null && gallery[photo] && (
              <>
                <FullPhoto item={gallery[photo]} />
                {gallery[photo].caption && (
                  <p className="mt-3 text-center font-display text-base italic text-overlay-ink/90">{gallery[photo].caption}</p>
                )}
              </>
            )}
          </Lightbox>,
          document.body,
        )}
    </section>
  );
}
