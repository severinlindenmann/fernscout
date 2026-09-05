"use client";

import Link from "next/link";
import { useTrip } from "@/components/TripProvider";

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import DayReactions from "./DayReactions";
import DraftNotice from "./DraftNotice";
import TestNotice from "./TestNotice";
import EntryContent from "./EntryContent";
import Gallery from "./Gallery";
import TravelScene from "./TravelScene";
import { useI18n } from "./LocaleProvider";
import { flagFor } from "@/lib/flags";
import { useMoney } from "./CurrencyProvider";
import type { Day, DaySummary, Entry } from "@/lib/types";

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
  const { money } = useMoney();
  const lead = day.lead;
  const multi = day.entries.length > 1;
  const cost = summary.cost;

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
      className={`rounded-2xl border bg-white p-5 shadow-sm sm:p-7 ${
        allDraft || isTest ? "border-coral-600" : "border-navy-200"
      }`}
    >
      {isTest && <TestNotice />}
      {allDraft && <DraftNotice />}
      {/* One compact meta line rather than a stack of pills. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
        <span className="rounded-full bg-yellow-400 px-2.5 py-1 font-display font-semibold text-yellow-950">
          {t("day.label")} {dayIndex + 1}
        </span>
        <span>{formatLongDate(day.date)}</span>
        <Dot />
        <span className="font-medium text-navy-700">
          {flagFor(lead.country, lead.countryCode)} {lead.location}
        </span>
        {multi && (
          <>
            <Dot />
            <span>
              {day.entries.length} {t("day.updates")}
            </span>
          </>
        )}
        {cost > 0 && (
          <>
            <Dot />
            <Link
              href={trip ? trip.href("/costs") : "/"}
              title={t("cost.today")}
              className="font-medium text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              {money(cost)}
            </Link>
          </>
        )}
      </div>

      {/* Several updates in one day are drawn as a branch off the day. */}
      <div className={multi ? "border-l-2 border-navy-200 pl-4 sm:pl-5" : undefined}>
        {day.entries.map((entry, i) => (
          <UpdateBlock key={entry.slug} entry={entry} branched={multi} first={i === 0} />
        ))}
      </div>

      {/* Keyed on the lead slug, which is also what #day-… links use. */}
      <DayReactions daySlug={lead.slug} />
    </article>
  );
}

function Dot() {
  return (
    <span className="text-navy-600" aria-hidden>
      ·
    </span>
  );
}

function UpdateBlock({
  entry,
  branched,
  first,
}: {
  entry: Entry;
  branched: boolean;
  first: boolean;
}) {
  const { t, localized } = useI18n();
  const { title, content, fallbackNotice } = localized(entry);

  return (
    <div className={`relative ${first ? "" : "mt-9"}`}>
      {entry.draft && !first && (
        <span className="mb-2 inline-block rounded-full border border-coral-600 bg-coral-300 px-2.5 py-0.5 font-display text-xs font-semibold text-navy-900">
          {t("draft.badge")}
        </span>
      )}
      {branched && (
        <span
          className="absolute -left-[22px] top-2 h-3 w-3 rounded-full border-2 border-white bg-yellow-400 sm:-left-[26px]"
          aria-hidden
        />
      )}

      {entry.time && (
        <div className="mb-1 font-display text-xs font-semibold text-navy-600">{entry.time}</div>
      )}

      <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
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
