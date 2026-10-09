"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useTrip } from "@/components/TripProvider";
import { useOptionalSite } from "@/components/SiteProvider";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import CutProse from "./CutProse";
import DayComments from "./DayComments";
import DayReactions from "./DayReactions";
import PushPrompt from "./PushPrompt";
import DualTime from "./DualTime";
import DayWeather from "./DayWeather";
import DraftNotice from "./DraftNotice";
import TestNotice from "./TestNotice";
import Prose from "./Prose";
import { EntryVisibility } from "./Visibility";
import Gallery from "./Gallery";
import { MapRow } from "./map/MapCard";
import { useI18n } from "./LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { flagFor } from "@/lib/flags";
import { isPlottable } from "@/lib/mapFrame";
import { useMoney } from "./CurrencyProvider";
import type { DaySummary, Entry } from "@/lib/types";
import type { ProseNode, StoryDay } from "@/lib/prose";
import type { CardMeta } from "@/lib/map/tripCard";
import {
  SOURCE_CREDIT,
  weatherGroup,
  type DayWeather as WeatherReading,
} from "@/lib/weather";

/**
 * The trip, one screen at a time.
 *
 * This replaced an endlessly-scrolling feed. That version fought the reader:
 * the sidebar stole the scroll position, tall pinned travel scenes made CSS
 * scroll-snap land almost anywhere, and every attempt to make it "settle"
 * added another thing to go wrong. Paging removes the whole class of problem —
 * there is exactly one thing on screen, and you move with Back / Continue.
 *
 * One screen at a time is also what makes the page cheap: the pager is handed
 * the trip's `index` for navigation and asks `dayAt` for the day it is
 * actually about to draw. Days outside the loaded window simply aren't here
 * yet — see the loader in `app/TripStory.tsx`.
 *
 * Several things the pager can draw are not needed to draw the page a reader
 * lands on, so they are not in its JavaScript: a travel leg (never the first
 * step — a page opens on the overview or on a day), the owner's own tools and
 * correction panel, and a markdown parser. Each arrives as its own chunk when
 * it is wanted; see `preloadLater` for why the leg is fetched ahead anyway.
 */

/**
 * The owner's block under a day — drawn for nobody else, so nobody else
 * downloads it. On an owner's page it is server-rendered like everything
 * else, and the page names its chunk, so it is there before hydration.
 * `loading` gives it a Suspense boundary of its own: without one, the wait
 * for a chunk would reach whatever boundary sits above the pager.
 */
const OwnerTools = dynamic(() => import("./OwnerTools"), { loading: () => null });

/**
 * The owner's correction panel — 1,000 lines no reader ever opens. Fetched
 * the moment an owner's day card mounts (see `DayCard`), so pressing
 * "Correct this day" does not wait on it.
 */
const EditDay = dynamic(() => import("./EditDay"), { loading: () => null });

/**
 * A travel leg. No `loading` of its own: the pager wraps it in a boundary
 * that holds the scene's box open at the height it draws at, which only the
 * pager knows (`LegBox`). In practice it has long since arrived, because the
 * pager fetches it once the page is idle.
 */
const TravelScene = dynamic(() => import("./TravelScene"));

/** `TravelScene`'s own box, empty — the two heights it draws at. */
function LegBox({ leg }: { leg: DaySummary }) {
  return (
    <div
      aria-hidden
      className={`w-full rounded-2xl border border-line-quiet bg-surface-neutral shadow-sm ${
        leg.travelScene === "quick" ? "h-[110px]" : "h-[280px] sm:h-[340px]"
      }`}
    />
  );
}

/**
 * Markdown rendered in the browser, for a day that arrives without its prose
 * already drawn (`lib/prose.ts`). Every story page's days carry it; this is
 * for anything else that renders a `DayCard` from a bare `Day`, which then
 * pays for the parser only when it actually draws one.
 */
const EntryContent = dynamic(() => import("./EntryContent"), { loading: () => null });

/**
 * Fetch a split-off chunk once the page has settled, so the reader never
 * waits on it later.
 *
 * Not only for speed. A trip kept for reading offline (B2158, `public/sw.js`)
 * keeps the scripts its pages name in their HTML, and a chunk that is only
 * ever `import()`ed is named by none of them — the first travel leg on a
 * plane would be a leg that never loads. Fetched here, it is in the worker's
 * cache from the first online visit on.
 */
function preloadLater(load: () => Promise<unknown>): () => void {
  const run = () => void load().catch(() => undefined);
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 2000);
  return () => window.clearTimeout(id);
}

export type Step =
  | { kind: "hero" }
  | { kind: "travel"; dayIndex: number }
  | { kind: "day"; dayIndex: number };

export function buildSteps(days: DaySummary[]): Step[] {
  const steps: Step[] = [{ kind: "hero" }];
  days.forEach((day, i) => {
    // `travelScene: "skip"` leaves the leg out of the pager entirely — the
    // one thing a reader on their fortieth identical hop can actually ask
    // for, since a scene that never gets a step can never stall on `onDone`.
    if (i > 0 && day.transport && day.travelScene !== "skip") {
      steps.push({ kind: "travel", dayIndex: i });
    }
    steps.push({ kind: "day", dayIndex: i });
  });
  return steps;
}

export default function StoryPager({
  index,
  dayAt,
  loadFailed = false,
  steps,
  stepIndex,
  onStepChange,
  onLegDone,
  hero,
  card,
}: {
  index: DaySummary[];
  /** The full day at that position, once it has arrived. */
  dayAt: (dayIndex: number) => StoryDay | undefined;
  /** True when the last neighbour fetch failed — offline, most likely. */
  loadFailed?: boolean;
  steps: Step[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  onLegDone: () => void;
  hero?: React.ReactNode;
  /** The trip's own card facts — B2538. Only `usedStreet` is read here (for
   * a day's own credit line, which doesn't vary by day); whether *this* day
   * gets a card at all is decided client-side, from `index` alone
   * (`isPlottable`), which is why a day fetched client-side through
   * `story.json` (never `dayCardMeta`, a server-only call) still gets one —
   * the `<img>` itself (`/card.svg?day=…`) is what actually enforces the
   * gate and leaves out a draft's line, same as every other day. */
  card?: CardMeta | null;
}) {
  const step = steps[stepIndex];

  const go = useCallback(
    (delta: number) => {
      const next = stepIndex + delta;
      if (next < 0 || next >= steps.length) return;
      onStepChange(next);
    },
    [stepIndex, steps.length, onStepChange],
  );

  // A trip with a travel leg in it will play one; fetch it ahead.
  const hasLegs = steps.some((s) => s.kind === "travel");
  useEffect(() => {
    if (hasLegs) return preloadLater(() => import("./TravelScene"));
  }, [hasLegs]);

  // Every step starts at the top of its own screen.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [stepIndex]);

  // Keyboard paging, as long as focus isn't in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!step) return null;

  return (
    <div>
      {/* B2550: `initial={false}` skips only the very first mount's own
          enter animation — the case a page arrives by navigation (a Link
          tap, a fresh load) and should show at once rather than fade up from
          nothing. A step change after that still swaps `key`s and animates
          exactly as before; reduced motion is `MotionConfig` in
          LocaleProvider.tsx, untouched by this. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {step.kind === "hero" && hero}

          {/* A leg needs only where it went and how — all of which the index
                carries, so travel never waits for a fetch. `from` is the day
                before it, in the same index, so the scene can measure the
                distance it just crossed. */}
          {step.kind === "travel" && (
            <div className="py-4">
              {/* The scene's own box, held open while its chunk lands. */}
              <Suspense fallback={<LegBox leg={index[step.dayIndex]} />}>
                <TravelScene
                  leg={index[step.dayIndex]}
                  from={index[step.dayIndex - 1]}
                  onDone={onLegDone}
                />
              </Suspense>
            </div>
          )}

          {step.kind === "day" &&
            (dayAt(step.dayIndex) ? (
              <DayCard
                day={dayAt(step.dayIndex)!}
                summary={index[step.dayIndex]}
                dayIndex={step.dayIndex}
                isNewestDay={step.dayIndex === index.length - 1}
                titleIsPageHeading
                mapCard={
                  isPlottable(index[step.dayIndex])
                    ? { query: `?day=${encodeURIComponent(index[step.dayIndex].date)}`, usedStreet: card?.usedStreet ?? false }
                    : undefined
                }
              />
            ) : (
              <DayPlaceholder
                summary={index[step.dayIndex]}
                failed={loadFailed}
              />
            ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * What stands in for a day still on its way.
 *
 * It says which day it is and where, because the index already knows both —
 * so even on a stalled connection the reader can see they're in the right
 * place rather than staring at grey boxes.
 */
function DayPlaceholder({
  summary,
  failed,
}: {
  summary: DaySummary;
  failed: boolean;
}) {
  const { t, formatLongDate } = useI18n();
  return (
    <article
      className="rounded-2xl border border-line-quiet bg-surface-raised p-5 shadow-sm sm:p-7"
      aria-busy={!failed}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-secondary">
        <span>{formatLongDate(summary.date)}</span>
        <span className="font-medium text-ink-body">
          {flagFor(summary.country, summary.countryCode)} {summary.location}
        </span>
      </div>
      <p role="status" className="text-base text-ink-body">
        {failed ? t("story.dayFailed") : t("story.dayLoading")}
      </p>
      {!failed && (
        <div className="mt-6 space-y-3" aria-hidden>
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-selected" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-selected" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-selected" />
        </div>
      )}
    </article>
  );
}

/**
 * One day, as the story draws it.
 *
 * Exported for `/docs/branding/day`, which is the only caller outside this
 * file. The states worth looking at — a draft, a day half-published, one
 * marked as test, one with no photographs — are all reachable on a real site
 * only by owning it and writing the day, so the bench renders them directly.
 */
export function DayCard({
  day,
  summary,
  dayIndex,
  canPublish,
  tripTest,
  isNewestDay = false,
  titleIsPageHeading = false,
  mapCard,
}: {
  /** The story page's day card names the page — B2479: its first update's
   *  title is the document's h1, the same thing the tab title says. The docs
   *  bench leaves it out and keeps an h2 under its own heading. */
  titleIsPageHeading?: boolean;
  /** With its prose already drawn on the server, on the story page — see
   *  `lib/prose.ts`. A bare `Day` still renders: its markdown is parsed
   *  here instead, at the cost of fetching the parser. */
  day: StoryDay;
  summary: DaySummary;
  dayIndex: number;
  /** Passed straight through to `DraftNotice` — B1257. Every public caller
   *  leaves this out and reads the real `TripProvider` in scope, as before;
   *  the helper room's preview pane, which has none, passes `true`. */
  canPublish?: boolean;
  /** The trip's own `test` flag, for a caller with no `TripProvider` in
   *  scope — B1426. Every public caller leaves this out and the real
   *  context answers instead; the helper room's preview pane has no
   *  provider to read, so it passes the trip's own flag through. */
  tripTest?: boolean;
  /** True for the last position in the pager's own day index — B2464. Only
   * `StoryPager` passes it (`step.dayIndex === index.length - 1`); the docs
   * bench and any other direct caller leave it out and simply get no card.
   * `NextDayPrompt` itself still gates on the trip being current/upcoming
   * and this day being published, so a caller passing `true` by mistake
   * cannot make the card appear on a finished trip or under a draft. */
  isNewestDay?: boolean;
  /** This day's own still preview card — B2538. `StoryPager` is the only
   * caller that ever hands one in (it decides client-side, from `isPlottable`
   * on this day's own summary); every other caller of this exported
   * component leaves it out and shows no map, the same as every other
   * optional prop here. */
  mapCard?: { query: string; usedStreet: boolean };
}) {
  // Trip-relative: URLs carry a username now, so a bare "/costs" would send a
  // reader to somebody else's site — or to nothing at all.
  const trip = useTrip();
  const site = useOptionalSite();
  const { t, formatLongDate, localized } = useI18n();
  const { spendParts } = useMoney();
  const [editing, setEditing] = useState(false);
  // The photograph the owner pressed "remove" on from the lightbox itself
  // rather than from the correction panel — B862. Carried across into
  // `EditDay` so it opens already marked to go, and cleared when the panel
  // closes so a later, ordinary "Correct this day" starts from nothing.
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  // Which updates of a several-update day are open — the first, to begin with.
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set([day.lead.slug]));
  // The owner's panel is its own chunk (see `EditDay` above); an owner is
  // the one reader who may press for it, so theirs is fetched now.
  const owner = trip?.canPublish === true;
  useEffect(() => {
    if (owner) void import("./EditDay").catch(() => undefined);
  }, [owner]);
  const lead = day.lead;
  const multi = day.entries.length > 1;
  const cost = summary.cost;
  const paidAndConverted = spendParts(summary.cost, summary.costLocal);

  // A day is only ever wholly a draft in practice — an agent writes one entry
  // at a time. The per-update badge below covers the day that is half-published.
  const allDraft = day.entries.every((e) => e.draft);
  // Marked on the trip, or on any update of the day. Either way the whole day
  // gets the banner: a day that is half-invented is not a day anybody should
  // be reading as a record of anything.
  // `trip` here is the context, whose `.trip` is the trip itself.
  const isTest =
    (tripTest ?? trip?.trip.test === true) || day.entries.some((e) => e.test);

  const leadText = localized(lead);
  const weather = lead.weather ? (
    // B325 — in the day's furniture, never in the prose.
    <DayWeather
      weather={lead.weather}
      labels={weatherLabels(lead.weather, t, formatLongDate)}
      units={trip?.units}
    />
  ) : null;
  const spend =
    cost > 0 ? (
      <Link
        href={trip ? trip.href("/costs") : "/"}
        title={t("cost.today")}
        className="group inline-flex items-baseline gap-1.5"
      >
        {/* What was actually paid leads — a reader can check it against a
            receipt, unlike the converted figure (B544) — so it carries the
            weight and the underline, and the conversion trails it, lighter
            and smaller. */}
        <span className="font-medium text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-2 group-hover:decoration-coral-600">
          {paidAndConverted.paid}
        </span>
        {paidAndConverted.converted && (
          <span className="text-[11px] text-ink-secondary">{paidAndConverted.converted}</span>
        )}
      </Link>
    ) : null;
  // The leg that brought the day here, said once — beside the map it
  // describes, not in the facts line as well (B2570).
  const leg = summary.transport;
  const mapDetail = leg
    ? [
        t(`studio.day.transport.${leg.mode}` as TranslationKey),
        [leg.from, leg.to].filter(Boolean).join(" → "),
      ]
        .filter(Boolean)
        .join(" · ")
    : (summary.mapName ?? summary.location);
  const removePhoto = trip?.canPublish
    ? (src: string) => {
        setRemoving(src);
        setEditing(true);
      }
    : undefined;
  const Heading = titleIsPageHeading ? "h1" : "h2";

  /*
    B2570 — the day as the owner chose it on 30 Sep, from six drafts: the
    photographs across the top; one small mono line saying which day and
    when (the day number used to be a waymark in the corner); then the words.
    A day with one update is a page: its title, the place, the measured
    facts, the prose cut at about eight lines. A day with several is an
    index: the place heads it and each update is a row — its time, its title
    — that opens in place, the first one open. The street map that used to
    fill the bottom half of the card is a row with a thumbnail now.

    From `md` up the measured facts (weather, spend) sit in a narrow column
    beside the words instead of on a line above them.
  */
  const card = (
    <article
      className={`overflow-hidden rounded-2xl border bg-surface-raised shadow-sm ${
        allDraft || isTest ? "border-coral-600" : "border-line-quiet"
      }`}
    >
      {(isTest || allDraft) && (
        <div className="px-5 pt-5 sm:px-7">
          {isTest && <TestNotice />}
          {allDraft && <DraftNotice canPublish={canPublish} />}
        </div>
      )}

      {/* The lead update's photographs. A later update's own are inside its
          row — pooled here they would stop saying which moment they are of. */}
      <Gallery items={lead.gallery} onRemove={removePhoto} />

      <div className="p-5 sm:p-7">
        <p className="font-mono text-[11px] tracking-[0.08em] text-ink-secondary">
          <span className="uppercase">
            {t("day.label")} {dayIndex + 1} · {formatLongDate(day.date)}
          </span>
          {!multi && lead.time && (
            <>
              {" · "}
              <DualTime date={lead.date} time={lead.time} timezone={lead.timezone} />
            </>
          )}
          {multi && (
            <>
              {" · "}
              {day.entries.length} {t("day.updates")}
            </>
          )}
        </p>

        <div className="md:flex md:gap-8">
          <div className="min-w-0 md:flex-1">
            {multi ? (
              <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-strong sm:text-3xl">
                {flagFor(lead.country, lead.countryCode)} {lead.location}
              </div>
            ) : (
              <>
                <Heading className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight text-ink-strong sm:text-3xl">
                  {leadText.title}
                  <EntryVisibility entry={lead} />
                </Heading>
                <p className="mt-1 text-sm text-ink-secondary">
                  {flagFor(lead.country, lead.countryCode)} {lead.location}
                </p>
              </>
            )}

            {(weather || spend) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary md:hidden">
                {weather}
                {spend}
              </div>
            )}

            {multi ? (
              <div className="mt-5 border-t border-line-faint">
                {day.entries.map((entry, i) => (
                  <UpdateRow
                    key={entry.slug}
                    entry={entry}
                    prose={day.prose?.[entry.slug]}
                    heading={i === 0 && titleIsPageHeading ? "h1" : "h2"}
                    open={openRows.has(entry.slug)}
                    onToggle={() =>
                      setOpenRows((rows) => {
                        const next = new Set(rows);
                        if (!next.delete(entry.slug)) next.add(entry.slug);
                        return next;
                      })
                    }
                    photos={i > 0}
                    onRemovePhoto={removePhoto}
                  />
                ))}
              </div>
            ) : (
              <>
                {/* B305 — a day carried over from before B294 with no
                    translation for this reader's language. */}
                {leadText.fallbackNotice && (
                  <p className="mt-4 text-xs italic text-ink-secondary">
                    {t(leadText.fallbackNotice)}
                  </p>
                )}
                <CutProse>
                  <EntryText prose={day.prose?.[lead.slug]} content={leadText.content} />
                </CutProse>
              </>
            )}

            {/* This day's own map — B2538, D9, as a row since B2570. Absent
                until the day has a place of its own. */}
            {mapCard && (
              <MapRow
                src={trip?.href("/card.svg") ?? "/card.svg"}
                query={mapCard.query}
                mapHref={trip?.href("/map") ?? "/map"}
                detail={mapDetail}
                usedStreet={mapCard.usedStreet}
              />
            )}
          </div>

          {(weather || spend) && (
            <aside className="mt-3 hidden w-44 shrink-0 space-y-3 border-l border-line-faint pl-6 text-sm text-ink-secondary md:block">
              {weather && (
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted">
                    {t("studio.day.field.weather")}
                  </p>
                  {weather}
                </div>
              )}
              {spend && (
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted">
                    {t("cost.today")}
                  </p>
                  {spend}
                </div>
              )}
            </aside>
          )}
        </div>

        {/* Keyed on the lead slug, which is also what #day-… links use. */}
        <div className="mt-8 border-t border-line-faint pt-3">
          <DayReactions daySlug={lead.slug} />
          <DayComments daySlug={lead.slug} />
        </div>

        {/*
          "Get the next day?" — B2464. It renders here, the one place asking
          it makes sense: the end of the newest published day of a trip that
          is still going. `PushPrompt` itself still gates on eligibility and
          engagement (browser support, dwell time) before it shows anything.
        */}
        {isNewestDay &&
          trip &&
          trip.trip.status !== "past" &&
          !lead.draft &&
          !site?.isShowcase && (
            <PushPrompt username={trip.trip.username} nextDayNumber={dayIndex + 2} />
          )}
      </div>
    </article>
  );

  // B877 put the owner's controls under the reactions row, inside the card.
  // They are out of it again. Inside, they inherited the rail indent a multi-update day
  // adds (`pl-6`), so the block sat off-centre — and, more than that, they were
  // drawn as though they were part of the day. They are not: the day is what a
  // reader sees, and this is the owner's own side of the page. Below the card,
  // its own width, nothing of the reader's.
  //
  // `canPublish` is exactly `isOwner`, see `lib/tripGate.ts`. Each control
  // still asks the server its own remaining question.
  if (!trip?.canPublish) return card;
  return (
    <>
      {card}
      {editing ? (
        // B980 — the panel takes the block's place rather than sitting under
        // it: while a day is being corrected, the things to do *with* the day
        // (tell the readers, invite somebody) are not the question.
        <EditDay
          username={trip.trip.username}
          tripId={trip.trip.id}
          day={day}
          initialDrop={removing}
          onClose={() => {
            setEditing(false);
            setRemoving(undefined);
          }}
        />
      ) : (
        <OwnerTools
          username={trip.trip.username}
          day={{
            tripId: trip.trip.id,
            slug: lead.slug,
            date: day.date,
            published: !allDraft,
          }}
          onCorrect={() => setEditing(true)}
          deletable={{ tripId: trip.trip.id, slug: lead.slug, title: lead.title, published: !lead.draft }}
        />
      )}
    </>
  );
}

/**
 * The two strings `DayWeather` shows — B325.
 *
 * Built here rather than inside the component because the dictionary already
 * lives in this tree, and because the credit is not decoration: `via` is what
 * tells a reader that a number beside somebody's day came from Open-Meteo, or
 * from a thermometer they named, and when. There is no code path that renders
 * the reading without it.
 */
function weatherLabels(
  weather: WeatherReading,
  t: ReturnType<typeof useI18n>["t"],
  formatLongDate: ReturnType<typeof useI18n>["formatLongDate"],
): { description: string; via: string } {
  const group = weatherGroup(weather.code);
  return {
    description: group ? t(`weather.${group}`) : t("weather.unknown"),
    via: t("weather.via", {
      // The stored value is a machine name; `SOURCE_CREDIT` is how it is said
      // to a person. A hand-supplied source has no entry and is shown exactly
      // as whoever recorded it wrote it.
      source: SOURCE_CREDIT[weather.source]?.label ?? weather.source,
      when: formatLongDate(weather.recordedAt.slice(0, 10)),
    }),
  };
}

/** An update's prose — drawn on the server when it could be, parsed here
 *  when it could not (see `lib/prose.ts`). */
function EntryText({ prose, content }: { prose?: ProseNode; content: string }) {
  return prose !== undefined ? <Prose tree={prose} /> : <EntryContent markdown={content} />;
}

/**
 * One update of a day that has several — B2570, replacing the rail of
 * stacked updates. The row is its time and its title; it opens in place.
 * The title is a heading with the button inside it, the disclosure pattern
 * a screen reader already knows. The visibility control is the owner's only
 * and sits under the button, since it is a control of its own.
 */
function UpdateRow({
  entry,
  prose,
  heading: Heading,
  open,
  onToggle,
  photos,
  onRemovePhoto,
}: {
  entry: Entry;
  prose?: ProseNode;
  heading: "h1" | "h2";
  open: boolean;
  onToggle: () => void;
  /** False for the lead update, whose photographs are the card's cover. */
  photos: boolean;
  onRemovePhoto?: (src: string) => void;
}) {
  const { t, localized } = useI18n();
  const { title, content, fallbackNotice } = localized(entry);
  const panel = `update-${entry.slug}`;

  return (
    <div className="border-b border-line-faint">
      <div className="flex items-center">
        <Heading className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panel}
            className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left"
          >
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-400" />
            {/* The time above the title rather than beside it: for a reader
                in another zone it is two clocks, and beside the title those
                took half the row. */}
            <span className="min-w-0 flex-1">
              {entry.time && (
                <span className="block font-mono text-xs text-ink-secondary">
                  <DualTime date={entry.date} time={entry.time} timezone={entry.timezone} />
                </span>
              )}
              <span className="block font-display text-lg font-semibold leading-snug tracking-tight text-ink-strong">
                {title}
              </span>
            </span>
            <span aria-hidden className="w-6 shrink-0 text-center text-xl text-ink-secondary">
              {open ? "−" : "+"}
            </span>
          </button>
        </Heading>
      </div>
      {/* Under the title rather than beside it, where on a phone it took
          the room the title needed. Empty for a reader — the visibility
          control is the owner's only — and then drawn not at all. */}
      <div className="-mt-1 flex flex-wrap items-center gap-2 pb-2.5 pl-5.5 empty:hidden">
        {entry.draft && (
          <span className="rounded-full border border-coral-600 bg-coral-300 px-2.5 py-0.5 font-display text-xs font-semibold text-on-bright">
            {t("draft.badge")}
          </span>
        )}
        <EntryVisibility entry={entry} />
      </div>
      {open && (
        <div id={panel} className="pb-6 pl-5.5">
          {fallbackNotice && (
            <p className="mb-3 text-xs italic text-ink-secondary">{t(fallbackNotice)}</p>
          )}
          <EntryText prose={prose} content={content} />
          {photos && entry.gallery.length > 0 && (
            <div className="mt-5">
              <Gallery items={entry.gallery} onRemove={onRemovePhoto} inset />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
