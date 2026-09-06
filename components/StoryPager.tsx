"use client";

import Link from "next/link";
import { useTrip } from "@/components/TripProvider";

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import DayReactions from "./DayReactions";
import DayWeather from "./DayWeather";
import DraftNotice from "./DraftNotice";
import TestNotice from "./TestNotice";
import EntryContent from "./EntryContent";
import Gallery from "./Gallery";
import TravelScene from "./TravelScene";
import { useI18n } from "./LocaleProvider";
import { flagFor } from "@/lib/flags";
import { useMoney } from "./CurrencyProvider";
import type { Day, DaySummary, Entry } from "@/lib/types";
import { SOURCE_CREDIT, weatherGroup, type DayWeather as WeatherReading } from "@/lib/weather";

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
 */

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
}: {
  index: DaySummary[];
  /** The full day at that position, once it has arrived. */
  dayAt: (dayIndex: number) => Day | undefined;
  /** True when the last neighbour fetch failed — offline, most likely. */
  loadFailed?: boolean;
  steps: Step[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  onLegDone: () => void;
  hero?: React.ReactNode;
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
        <AnimatePresence mode="wait">
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
                <TravelScene
                  leg={index[step.dayIndex]}
                  from={index[step.dayIndex - 1]}
                  onDone={onLegDone}
                />
              </div>
            )}

            {step.kind === "day" &&
              (dayAt(step.dayIndex) ? (
                <DayCard
                  day={dayAt(step.dayIndex)!}
                  summary={index[step.dayIndex]}
                  dayIndex={step.dayIndex}
                />
              ) : (
                <DayPlaceholder summary={index[step.dayIndex]} failed={loadFailed} />
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
function DayPlaceholder({ summary, failed }: { summary: DaySummary; failed: boolean }) {
  const { t, formatLongDate } = useI18n();
  return (
    <article
      className="rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-7"
      aria-busy={!failed}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
        <span>{formatLongDate(summary.date)}</span>
        <span className="font-medium text-navy-700">
          {flagFor(summary.country, summary.countryCode)} {summary.location}
        </span>
      </div>
      <p role="status" className="text-base text-navy-700">
        {failed ? t("story.dayFailed") : t("story.dayLoading")}
      </p>
      {!failed && (
        <div className="mt-6 space-y-3" aria-hidden>
          <div className="h-4 w-3/4 animate-pulse rounded bg-navy-200" />
          <div className="h-4 w-full animate-pulse rounded bg-navy-200" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-navy-200" />
        </div>
      )}
    </article>
  );
}

function DayCard({
  day,
  summary,
  dayIndex,
}: {
  day: Day;
  summary: DaySummary;
  dayIndex: number;
}) {
  // Trip-relative: URLs carry a username now, so a bare "/costs" would send a
  // reader to somebody else's site — or to nothing at all.
  const trip = useTrip();
  const { t, formatLongDate } = useI18n();
  const { spendParts } = useMoney();
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
  const isTest = trip?.trip.test === true || day.entries.some((e) => e.test);

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        allDraft || isTest ? "border-coral-600" : "border-navy-200"
      }`}
    >
      {/*
        The day's own identity, on its own paper.

        It used to be one wrapping row of dot-separated fragments above the
        first update's title, which put "Day 4", the date, the place, the
        weather and the spend at the same weight as each other and at less
        weight than anything below — so a day with two updates arrived as two
        stacked articles the reader had to infer were one day.

        Now the day is the frame and the updates are its contents. Three
        decisions carry that, and each of them is one thing rather than five:

        - **The place is the only headline.** Where you were is what a person
          reads a day for; everything else on this band is smaller than it.
        - **Everything measured shares one quiet line.** Date, weather, spend
          and update count are unlike things, and giving each its own chip is
          how a diary page turns into a dashboard. One line, one voice, no
          separators to make it look tabulated.
        - **The ordinal goes in the corner, under a painted yellow stroke.**
          This product's mark is a Wanderweg waymark, and a waymark's whole job
          is to say *you are at this point on the route* — which is exactly
          what a day number is. So the accent appears once, on the one element
          that is genuinely a trail marker, and the yellow pill that made it
          look like a status chip is gone.
      */}
      <header className="relative border-b border-navy-200 bg-cream-100 px-5 py-5 sm:px-7 sm:py-6">
        {/* The corner marker. Only the headline reserves room for it
            (`pr-24`); the line below clears it on height and needs the full
            width, because at 390px a reserved corner left it 250px and every
            item — date, weather, spend — wrapped onto a row of its own. */}
        <div className="absolute right-5 top-5 text-right sm:right-7 sm:top-6">
          <span className="ml-auto block h-1 w-8 rounded-full bg-yellow-400" aria-hidden />
          <span className="mt-1.5 block font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-600">
            {t("day.label")} {dayIndex + 1}
          </span>
        </div>

        <div className="pr-24 font-display text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">
          {flagFor(lead.country, lead.countryCode)} {lead.location}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-600">
          <span>{formatLongDate(day.date)}</span>
            {/* B325 — in the day's furniture, never in the prose. `DayWeather`
                renders nothing when the day has no reading. */}
            {lead.weather && (
              <DayWeather
                weather={lead.weather}
                labels={weatherLabels(lead.weather, t, formatLongDate)}
              />
            )}
            {cost > 0 && (
              <Link
                href={trip ? trip.href("/costs") : "/"}
                title={t("cost.today")}
                className="group inline-flex items-baseline gap-1.5"
              >
                {/* What was actually paid leads — a reader can check it against
                    a receipt, unlike the converted figure (B544) — so it is the
                    figure that carries the weight and the underline, and the
                    conversion trails it, lighter and smaller. Run together at
                    one weight, `USD 131 ≈ CHF 115` reads as a single strange
                    price rather than as one price said twice. */}
                <span className="font-medium text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-2 group-hover:decoration-coral-600">
                  {paidAndConverted.paid}
                </span>
                {paidAndConverted.converted && (
                  <span className="text-[11px] text-navy-500">{paidAndConverted.converted}</span>
                )}
              </Link>
            )}
          {multi && (
            <span>
              {day.entries.length} {t("day.updates")}
            </span>
          )}
        </div>
      </header>

      <div className="p-5 sm:p-7">
        {isTest && <TestNotice />}
        {allDraft && <DraftNotice />}

        {/* Several updates in one day are stops on one rail. Each stop draws
            the segment down to the *next* one rather than the list drawing one
            line behind all of them, so the rail ends at the last dot: a line
            trailing past the final update reads as a day with more coming. */}
        <div className={multi ? "pl-6 sm:pl-7" : undefined}>
          {day.entries.map((entry, i) => (
            <UpdateBlock
              key={entry.slug}
              entry={entry}
              branched={multi}
              first={i === 0}
              last={i === day.entries.length - 1}
            />
          ))}
        </div>

        {/* Keyed on the lead slug, which is also what #day-… links use.
            Inside the body and on the prose's own left edge, after a hairline
            that stops short of both margins: asking how the day was is the
            last line of the day, not a separate strip bolted underneath it.
            It had its own cream band for one iteration and read as somebody
            else's widget sitting under the writing. */}
        <div className="mt-10 border-t border-navy-200 pt-5">
          <DayReactions daySlug={lead.slug} />
        </div>
      </div>
    </article>
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

function UpdateBlock({
  entry,
  branched,
  first,
  last,
}: {
  entry: Entry;
  branched: boolean;
  first: boolean;
  /** The last stop of the day — draws a dot and no rail below it. */
  last: boolean;
}) {
  const { t, localized } = useI18n();
  const { title, content, fallbackNotice } = localized(entry);

  return (
    <div className={`relative ${first ? "" : "mt-10"}`}>
      {/* This stop, and the rail running from it down to the next one. Only
          on a day with more than one update: a single update is not a
          sequence and gets neither. The segment overshoots by the gap between
          blocks (`-bottom-10`, matching `mt-10`) so the line arrives exactly
          at the next dot. */}
      {branched && (
        <>
          <span
            className="absolute -left-6 top-1.5 h-3 w-3 rounded-full bg-yellow-400 sm:-left-7"
            aria-hidden
          />
          {!last && (
            <span
              className="absolute -bottom-10 -left-[19px] top-5 w-0.5 rounded-full bg-navy-200 sm:-left-[23px]"
              aria-hidden
            />
          )}
        </>
      )}

      {/* The time is the stop's label, so it leads rather than hiding under
          the heading — on a two-update day it is the thing that says these
          are two moments and not two days. */}
      {entry.time && (
        <div className="font-display text-xs font-semibold tracking-wide text-navy-600">
          {entry.time}
        </div>
      )}

      {entry.draft && !first && (
        <span className="mt-1 inline-block rounded-full border border-coral-600 bg-coral-300 px-2.5 py-0.5 font-display text-xs font-semibold text-navy-900">
          {t("draft.badge")}
        </span>
      )}

      <h2 className="mb-4 mt-1 font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
        {title}
      </h2>

      {/* B305 — a day carried over from before B294 that has no translation
          for this reader's language. Quiet on purpose: unlike DraftNotice
          and TestNotice this is a legacy-only path, not a caution, so it is
          a line rather than a banner. */}
      {fallbackNotice && <p className="mb-4 text-xs italic text-navy-500">{t(fallbackNotice)}</p>}

      <EntryContent markdown={content} />

      {entry.gallery.length > 0 && (
        <div className="mt-7">
          <Gallery items={entry.gallery} />
        </div>
      )}
    </div>
  );
}
