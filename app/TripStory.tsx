"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronUp, ChevronDown, LayoutDashboard, Plus } from "lucide-react";
import GamePath from "@/components/GamePath";
import LatestDayButton from "@/components/LatestDayButton";
import MobileDaySheet from "@/components/MobileDaySheet";
import PageHeader from "@/components/PageHeader";
import PagerNav, { type PagerNavState } from "@/components/PagerNav";
import ReactionsProvider from "@/components/ReactionsProvider";
import StoryPager, { buildSteps } from "@/components/StoryPager";
import TripHero from "@/components/TripHero";
import type { Basemap } from "@/lib/basemap";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { flagFor } from "@/lib/flags";
import { WindowLedger } from "@/lib/dayLoader";
import { isOver } from "@/lib/tripTime";
import {
  LEGACY_KEYS,
  lastVisitKey,
  newestDate,
  resumeKey,
  visitMark,
  visitMarkKey,
  whatsNew,
} from "@/lib/whatsNew";
import type { DaySummary, PhotobookEntry } from "@/lib/types";
import type { StoryDay } from "@/lib/prose";
import type { HeroStats } from "@/components/TripHero";

/** How many days either side of the one on screen are kept loaded. Mirrors
 * `STORY_WINDOW` on the server; the client asks for the same shape. */
const WINDOW = 2;

/** Owner-only, so its own chunk — the same split, and the same reasons, as
 * the day card's copy in `components/StoryPager.tsx`. */
const OwnerTools = dynamic(() => import("@/components/OwnerTools"), { loading: () => null });

/** `#day-<slug>` — a shareable link straight to one day. */
function hashForDay(day: DaySummary) {
  return `#day-${day.slug}`;
}

export default function TripStory({
  index,
  days,
  windowStart,
  initialDate,
  openAtDate,
  stats,
  basemap = null,
  locals,
  photobook,
  travellerNames,
  dayTrack,
}: {
  /** Every day of the trip, cheaply. */
  index: DaySummary[];
  /** Full days for the window the page was rendered around, their prose
   * already rendered on the server — see lib/prose.ts. */
  days: StoryDay[];
  /** Where `days[0]` sits in `index`. */
  windowStart: number;
  /** The day the story lands on when no day was asked for: today while the
   * trip is running, its last day once it is over. `getDefaultDay` decides —
   * see lib/entries.ts. */
  initialDate?: string;
  /** A specific day to open at, from the /day/<slug> route. */
  openAtDate?: string;
  stats: HeroStats;
  /** Clipped to this trip's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
  /** One town-scale basemap per stop area — see `components/TripMap.tsx`. */
  locals?: Record<string, Basemap>;
  /**
   * Present only for the journal's owner, on a journal with photobook and
   * credits switched on — B569. See `TripHero`, which is the only place this
   * is rendered.
   */
  photobook?: PhotobookEntry;
  /** Who took this trip, joined for display — `travellerNamesOf` in
   * lib/site.ts. B10: the hero is the one place every reader of the story
   * lands, and until now the only page that named them was the one about
   * money. */
  travellerNames?: string;
  /**
   * The recorded route for `openAtDate` — B2199. Only the `/day/<slug>`
   * routes pass this; the overview and `/trips/<id>` pages leave it out and
   * the hero's map draws no track, as before. See `TripMap`'s own doc for
   * what it draws.
   */
  dayTrack?: [number, number][][];
}) {
  const { t, formatLongDate, localizedTrip, locale } = useI18n();
  // TripStory is always rendered inside TripProvider (both the current-trip
  // and /trips/<id> pages mount it there), so this is null only in the
  // unexpected case where that ever stops being true — reactions degrade to
  // inert rather than crash the story page.
  const trip = useTrip();

  const steps = useMemo(() => buildSteps(index), [index]);

  /**
   * The days whose full content is in hand, keyed by their position in
   * `index`. Seeded with what the server sent and filled in as the reader
   * moves — see the loader effect below.
   */
  const [loaded, setLoaded] = useState<Record<number, StoryDay>>(() =>
    Object.fromEntries(days.map((d, i) => [windowStart + i, d])),
  );
  /** Windows already requested, so paging back and forth doesn't refetch —
   * and, just as importantly, one that was never answered goes back on the
   * list. See lib/dayLoader.ts. */
  const ledger = useRef(new WindowLedger());
  const [loadFailed, setLoadFailed] = useState(false);

  /** The step showing a given day's card. */
  const stepForDay = useCallback(
    (dayIndex: number) =>
      Math.max(
        0,
        steps.findIndex((s) => s.kind === "day" && s.dayIndex === dayIndex),
      ),
    [steps],
  );

  /** Where `initialDate` sits in `index`. Not necessarily today — on a
   * finished trip it is the last day of the trip. */
  const landingIndex = Math.max(
    0,
    index.findIndex((d) => d.date === initialDate),
  );

  // Where to open. /day/<slug> opens at that day; anything else starts on the
  // overview, so a reload lands on the summary rather than dropping you back
  // mid-story with no context.
  //
  // A #day-… link is applied *after* mount, not here: reading the URL during
  // render would make the client pick a different step than the server did,
  // which is a hydration mismatch.
  const [stepIndex, setStepIndex] = useState(() => {
    if (openAtDate) {
      const i = index.findIndex((d) => d.date === openAtDate);
      if (i >= 0) return stepForDay(i);
    }
    return 0;
  });

  // Honour a #day-… link once we're on the client.
  useEffect(() => {
    const slug = window.location.hash.replace(/^#day-/, "");
    if (!slug || slug === window.location.hash) return;
    const i = index.findIndex((d) => d.slug === slug);
    if (i < 0) return;
    // Always a day step, never a leg, so this can't trigger an auto-advance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStepIndex(stepForDay(i));
    // Only on mount — later hash changes come from our own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const slug = window.location.hash.replace(/^#day-/, "");
      if (!window.location.hash) {
        setStepIndex(0);
        return;
      }
      if (slug === window.location.hash) return;
      const i = index.findIndex((d) => d.slug === slug);
      if (i >= 0) setStepIndex(stepForDay(i));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [index, stepForDay]);

  /** Which trip's reading marks to keep. Null outside TripProvider, in which
   * case there is no trip to be up to date with and the feature sits out. */
  const storageRef = trip?.trip.ref ?? null;

  /** The day the reader last reached, remembered across reloads. */
  const [resumeSlug, setResumeSlug] = useState<string | null>(null);
  /** The newest day that existed the last time they were here. */
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  /** The newest day they have opened during this visit. */
  const [reached, setReached] = useState<string | null>(null);
  const newest = newestDate(index);
  // Read after the first paint: web storage only exists in the browser, and
  // reading it during render would make the client HTML differ from the
  // server's.
  //
  // Deliberately idempotent rather than guarded to run once. Arriving stamps
  // the last-visit mark forward, so anything that re-runs this after that
  // reads back its own stamp and decides the reader is up to date — which is
  // why the visit's starting mark is written to sessionStorage on the first
  // pass and read from there on every later one. Remounts are not ours to
  // prevent: `next dev` does one on every page, and that alone was enough to
  // make the banner impossible to see locally.
  useEffect(() => {
    if (!storageRef) return;
    const mark = visitMark(
      window.sessionStorage.getItem(visitMarkKey(storageRef)),
      window.localStorage.getItem(lastVisitKey(storageRef)),
    );
    window.sessionStorage.setItem(visitMarkKey(storageRef), mark);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResumeSlug(window.localStorage.getItem(resumeKey(storageRef)));
    setLastVisit(mark || null);
    // Stamp the visit immediately, but read from the session mark above — so
    // the "what's new" line stays put until the reader has actually taken it
    // up, instead of vanishing the moment they arrive.
    if (newest) window.localStorage.setItem(lastVisitKey(storageRef), newest);
    // The marks predating per-trip scoping. Whatever they hold was written by
    // whichever trip was read last, so it cannot be migrated into a scoped
    // key — only cleared, at the cost of one visit with no banner.
    for (const legacy of LEGACY_KEYS) window.localStorage.removeItem(legacy);
  }, [storageRef, newest]);
  // Which step's travel leg has finished playing. Kept here so both the
  // desktop nav and the merged mobile bar can label Continue vs Skip.
  const [doneStep, setDoneStep] = useState<number | null>(null);
  // Which way the reader last moved. A finished leg only carries them onward
  // if they were going forward — otherwise pressing Back onto a leg would
  // replay it and bounce them straight forward again.
  const directionRef = useRef(1);

  const step = steps[stepIndex];

  // On the hero, the header and path still point at day 1.
  const activeIndex = step && step.kind !== "hero" ? step.dayIndex : 0;
  const active = index[activeIndex];

  /**
   * Keeps a window of full days around the reader.
   *
   * Only the day card needs prose and photos; the path, the day list and the
   * travel legs all run off `index`. So this fetches lazily and one window at
   * a time, and a failure leaves the rest of the page working.
   */
  useEffect(() => {
    if (!trip) return;
    const windows = ledger.current;
    const want = windows.plan({
      centre: activeIndex,
      length: index.length,
      radius: WINDOW,
      has: (i) => Boolean(loaded[i]),
    });
    if (!want) return;

    const { start, end } = want;
    windows.claim(want);

    // `lang`: the days come back with their prose rendered on the server in
    // the language this page is showing — see lib/prose.ts.
    const url = `${trip.userHref("/story.json")}?trip=${encodeURIComponent(trip.trip.ref)}&from=${start}&to=${end}&lang=${encodeURIComponent(locale)}`;
    const abort = new AbortController();
    // Whether this request ever got an answer, and so whether the claim above
    // still stands when the effect is torn down.
    let settled = false;
    fetch(url, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { from: number; days: StoryDay[] }) => {
        settled = true;
        setLoaded((prev) => {
          const next = { ...prev };
          data.days.forEach((d, i) => {
            next[data.from + i] = d;
          });
          return next;
        });
        setLoadFailed(false);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        settled = true;
        // Let the reader try again by moving away and back — an offline bus
        // ride shouldn't permanently blank a day.
        windows.release(want);
        setLoadFailed(true);
        console.warn("[story] could not load days", start, "–", end, err);
      });
    return () => {
      abort.abort();
      // An unanswered request leaves nothing behind, so it must not leave its
      // claim behind either — otherwise these days are never asked for again
      // and sit on their placeholder for good. Released here rather than in the
      // catch above because the abort's rejection arrives too late: the effect
      // has already been set up again and found nothing missing.
      if (!settled) windows.release(want);
    };
  }, [activeIndex, index.length, loaded, trip, locale]);

  useEffect(() => {
    const s = steps[stepIndex];
    if (!s) return;
    if (s.kind === "hero") {
      // B2334 — the pathname before this step was often a day's own permalink;
      // the hero step is the trip's own path, not whatever page opened it.
      history.replaceState(
        null,
        "",
        (trip ? trip.href("/") : window.location.pathname) + window.location.search,
      );
      return;
    }
    const day = index[s.dayIndex];
    // A real permalink, not `#day-…` — /day/<slug> is a route of its own
    // (see app/[user]/(trip)/day/[slug]/page.tsx) that opens the story
    // window centred on this day server-side. A `#fragment` never reaches
    // the server, so a link copied from the address bar mid-scroll opened on
    // whatever day the page happened to land on by default (B329).
    history.replaceState(null, "", trip ? trip.href(`/day/${day.slug}`) : hashForDay(day));
    if (s.kind === "day") {
      if (storageRef) {
        window.localStorage.setItem(resumeKey(storageRef), day.slug);
        // Opening one of the new days is taking the prompt up, so this visit
        // stops needing its starting mark — and dropping it is what makes the
        // banner stay gone across a reload or a remount, where component state
        // does not survive. The stamped mark is the truth from here on.
        if (lastVisit && day.date > lastVisit) {
          window.sessionStorage.removeItem(visitMarkKey(storageRef));
        }
      }
      // The furthest-forward day they have opened this visit. `whatsNew` reads
      // it to know the prompt has been taken up; kept as the newest rather
      // than the latest so paging back afterwards can't undo it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReached((prev) => (prev && prev > day.date ? prev : day.date));
    }
  }, [stepIndex, steps, index, storageRef, lastVisit, trip]);

  const progress =
    index.length > 0 ? ((activeIndex + 1) / index.length) * 100 : 0;
  const awayFromLanding = initialDate ? activeIndex !== landingIndex : false;

  /**
   * The key StoryPager's own crossfade is keyed on — B2326.
   *
   * Leaving the overview for a day, and coming back to it, is the one move in
   * the reader that is going deeper and coming out again, so it pushes like
   * an iPhone page (the CSS is `.fs-story-page` in globals.css). It is not a
   * route change — the pager swaps steps in place and only `replaceState`s
   * the address — so the transition is `document.startViewTransition` around
   * the state change rather than React's `<ViewTransition>` on navigation.
   *
   * The browser needs the new step in the DOM when its callback returns, and
   * `AnimatePresence mode="wait"` would hold it back behind the old step's
   * exit. So a pushed move keeps the pager's key where it was — no key
   * change, no crossfade, the content swaps synchronously — and every other
   * move still changes the key and crossfades exactly as before.
   */
  const [pushed, setPushed] = useState<{ from: number; to: number } | null>(null);
  const motionKey = pushed && pushed.to === stepIndex ? pushed.from : stepIndex;

  /** Every move the reader makes. Only across the overview does it push;
   * without the View Transitions API it is the plain state change it was. */
  const moveTo = useCallback(
    (next: number) => {
      if ((stepIndex === 0) === (next === 0) || typeof document.startViewTransition !== "function") {
        setStepIndex(next);
        return;
      }
      const root = document.documentElement;
      const way = next === 0 ? "back" : "forward";
      root.dataset.pageNav = way;
      document
        .startViewTransition(() =>
          flushSync(() => {
            setPushed({ from: motionKey, to: next });
            setStepIndex(next);
          }),
        )
        .finished.finally(() => {
          // ponytail: a second push inside 380ms can leave the first one's
          // direction on for its tail; harmless, both are pushes.
          if (root.dataset.pageNav === way) delete root.dataset.pageNav;
        });
    },
    [stepIndex, motionKey],
  );

  const jumpToDay = useCallback(
    (date: string) => {
      const i = index.findIndex((d) => d.date === date);
      if (i < 0) return;
      directionRef.current = 0;
      moveTo(stepForDay(i));
    },
    [index, stepForDay, moveTo],
  );

  /** Step 0 is the trip summary. */
  const goToOverview = useCallback(() => {
    directionRef.current = 0;
    moveTo(0);
  }, [moveTo]);
  const onOverview = stepIndex === 0;

  const jumpToLanding = useCallback(() => {
    directionRef.current = 0;
    moveTo(stepForDay(landingIndex));
  }, [stepForDay, landingIndex, moveTo]);

  const goStep = useCallback(
    (delta: number) => {
      const next = stepIndex + delta;
      if (next < 0 || next >= steps.length) return;
      directionRef.current = delta;
      moveTo(next);
    },
    [stepIndex, steps.length, moveTo],
  );

  // For a finished trip, `landingDay` (below) is already its last day — see
  // `getDefaultDay` — so this just decides how the hero, the pager and the
  // jump button talk about it, not which day they show.
  const over = trip ? isOver(trip.trip, index) : false;

  // Said the way the reader thinks about it, not the way the pager is built.
  const stepLabel =
    !step || step.kind === "hero"
      ? t("nav.overview")
      : step.kind === "travel"
        ? `→ ${index[step.dayIndex].location}`
        : `${t("day.label")} ${step.dayIndex + 1} ${t("day.of")} ${index.length}`;

  const nav: PagerNavState = {
    stepIndex,
    stepCount: steps.length,
    isTravel: step?.kind === "travel",
    legDone: doneStep === stepIndex,
    label: stepLabel,
    tripOver: over,
    onBack: () => goStep(-1),
    onNext: () => goStep(1),
  };

  const stepDay = useCallback(
    (delta: number) => {
      const next = activeIndex + delta;
      if (next < 0 || next >= index.length) return;
      directionRef.current = 0;
      moveTo(stepForDay(next));
    },
    [activeIndex, index.length, stepForDay, moveTo],
  );

  if (index.length === 0) {
    return (
      <div className="min-h-screen">
        <PageHeader />
        {trip?.canPublish ? (
          // The owner's own empty trip: point at the one thing to do next,
          // the studio's add-day flow with this trip already chosen.
          <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
            {/* The trip's name: on a phone the header shows only the journal. */}
            <h1 className="text-2xl font-semibold text-ink-strong">{localizedTrip(trip.trip).title}</h1>
            <p className="mt-3 text-ink-secondary">{t("story.emptyOwner.body")}</p>
            <Link
              href={`/${encodeURIComponent(trip.trip.username)}/studio/day/new?trip=${encodeURIComponent(trip.trip.id)}`}
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-action-strong px-5 py-2 font-semibold text-on-action"
            >
              <Plus className="h-4 w-4" />
              {t("story.emptyOwner.cta")}
            </Link>
          </div>
        ) : (
          <p className="p-6 text-ink-secondary">{t("story.empty")}</p>
        )}
      </div>
    );
  }

  const landingDay = index[landingIndex];
  // The hero's cover comes from the window the server sent, which is centred
  // on today — so it is there on a normal visit and simply absent if a reader
  // deep-linked to the far end of the trip.
  //
  // B1740. `findLast`, not `find`: the landing day is the last day that has
  // happened (`getDefaultDay`), so on a trip in progress this is the newest
  // photograph of it — the picture just taken, rather than the one that
  // opened the morning. `trip.cover` is the fallback and never the override:
  // a cover somebody set mid-trip would otherwise freeze the hero on one
  // picture for the rest of the journey. The trips index has the opposite
  // precedence, and says so there.
  const heroCover =
    loaded[landingIndex]?.lead.gallery.findLast((g) => g.type === "image")?.src ??
    trip?.trip.cover;

  const resumeIndex = resumeSlug ? index.findIndex((d) => d.slug === resumeSlug) : -1;
  const canResume = resumeIndex >= 0 && resumeIndex !== landingIndex;

  // Days published since their last visit — see lib/whatsNew.ts for when this
  // says nothing at all.
  const { firstIndex: firstNewIndex, count: newDayCount } = whatsNew(
    index,
    lastVisit,
    reached,
  );

  const story = (
    // The bottom padding clears the floating day pill on a phone (B2161):
    // its height plus the inset it floats at, and nothing on desktop where
    // the pill does not exist.
    <div className="flex min-h-screen flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
      <PageHeader onHome={goToOverview} hideOnScroll>
        <div className="hidden w-36 text-right text-xs text-ink-secondary xl:block">
          <div className="font-display font-semibold text-ink-strong">
            {t("day.label")} {activeIndex + 1} {t("day.of")} {index.length}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-selected">
            <div
              className="h-full rounded-full bg-yellow-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </PageHeader>

      {/* Day bar — desktop only; mobile uses the bottom sheet instead. */}
      <div className="sticky top-[61px] z-20 hidden border-b border-line-quiet bg-surface-base/95 backdrop-blur sm:top-[65px] lg:block">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold text-ink-strong">
              {t("day.label")} {activeIndex + 1} ·{" "}
              {flagFor(active.country, active.countryCode)} {active.location}
            </div>
            <div className="truncate text-[11px] text-ink-secondary">
              {formatLongDate(active.date)}
              {active.updates > 1 && ` · ${active.updates} ${t("day.updates")}`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {awayFromLanding && (
              <LatestDayButton
                tripOver={over}
                onClick={jumpToLanding}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-yellow-400 px-4 py-2 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
              />
            )}
            <button
              onClick={() => stepDay(-1)}
              disabled={activeIndex === 0}
              aria-label={t("day.prev")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line-quiet bg-surface-raised text-ink-body transition-colors hover:text-ink-strong disabled:opacity-60"
            >
              <ChevronUp className="h-5 w-5" />
            </button>
            <button
              onClick={() => stepDay(1)}
              disabled={activeIndex === index.length - 1}
              aria-label={t("day.next")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line-quiet bg-surface-raised text-ink-body transition-colors hover:text-ink-strong disabled:opacity-60"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-6 px-4 sm:px-6 lg:gap-10 lg:px-8">
        <aside className="scrollbar-thin sticky top-[112px] hidden h-[calc(100vh-112px)] w-52 shrink-0 overflow-y-auto py-6 lg:block">
          <button
            onClick={goToOverview}
            className={`mx-auto mb-4 flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              onOverview
                ? "bg-action-strong text-on-action"
                : "border border-line-quiet bg-surface-raised text-ink-body hover:border-line-prominent"
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            {t("nav.overview")}
          </button>
          <GamePath days={index} currentIndex={activeIndex} onSelect={jumpToDay} />
        </aside>

        <main id="main" tabIndex={-1} className="fs-story-page min-w-0 flex-1 py-4">
          {/*
            The document's h1. On the overview it is the hero's own visible
            heading; on every other step the hero is not rendered at all, so a
            reader arriving at /day/<slug> from an email got a page with no h1
            and a heading outline that started at h2. This supplies one, and
            deliberately supplies the *trip* rather than the day: it does not
            change as the reader pages, and a heading that mutates under a
            screen reader is worse than a heading that is merely general. The
            day's own title stays the h2 beneath it.
          */}
          {!onOverview && trip && (
            <h1 className="sr-only">{localizedTrip(trip.trip).title}</h1>
          )}
          <StoryPager
            index={index}
            dayAt={(i) => loaded[i]}
            loadFailed={loadFailed}
            steps={steps}
            stepIndex={stepIndex}
            hasPlaces={stats.places > 0}
            motionKey={motionKey}
            onStepChange={(next) => {
              directionRef.current = next > stepIndex ? 1 : -1;
              moveTo(next);
            }}
            onLegDone={() => {
              setDoneStep(stepIndex);
              if (directionRef.current <= 0) return;
              // Let the arrival land before moving on.
              const finished = stepIndex;
              window.setTimeout(() => {
                setStepIndex((cur) =>
                  cur === finished && cur + 1 < steps.length ? cur + 1 : cur,
                );
              }, 900);
            }}
            hero={
              landingDay && (
                <TripHero
                  stats={stats}
                  route={index}
                  current={landingDay}
                  track={dayTrack}
                  basemap={basemap}
                  locals={locals}
                  over={over}
                  coverSrc={heroCover}
                  onStart={() => {
                    directionRef.current = 0;
                    moveTo(stepForDay(0));
                  }}
                  onLatest={jumpToLanding}
                  onResume={
                    canResume ? () => jumpToDay(index[resumeIndex].date) : undefined
                  }
                  resumeLabel={
                    canResume
                      ? `${t("hero.resume")} · ${t("day.label")} ${resumeIndex + 1}`
                      : undefined
                  }
                  newDayCount={newDayCount}
                  onShowNew={
                    newDayCount > 0
                      ? () => jumpToDay(index[firstNewIndex].date)
                      : undefined
                  }
                  photobook={photobook}
                  travellerNames={travellerNames}
                />
              )
            }
          />

          {/* The same owner block the day card renders — B877. On the
              overview only: paging through the trip already shows it on every
              day, and a second one under the story would be the same controls
              twice on one screen. No `day` here, so the two day-specific tiles
              are simply not in the grid. */}
          {onOverview && trip?.canPublish && (
            <OwnerTools username={trip.trip.username} tripId={trip.trip.id} />
          )}

          {/* Desktop keeps its own nav; on mobile it lives in the bottom bar. */}
          <div className="hidden lg:block">
            <PagerNav state={nav} />
          </div>
        </main>
      </div>

      <MobileDaySheet
        days={index}
        currentIndex={activeIndex}
        onSelect={jumpToDay}
        onLatest={jumpToLanding}
        onOverview={goToOverview}
        onOverviewActive={onOverview}
        showLatest={awayFromLanding}
        tripOver={over}
        nav={{ ...nav, onEnd: goToOverview }}
      />
    </div>
  );

  return trip ? (
    <ReactionsProvider tripId={trip.trip.ref}>{story}</ReactionsProvider>
  ) : (
    story
  );
}

