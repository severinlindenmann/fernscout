"use client";

import { ArrowLeft, ArrowRight, SkipForward } from "lucide-react";
import { useI18n } from "./LocaleProvider";

export type PagerNavState = {
  stepIndex: number;
  stepCount: number;
  /** True while a travel leg is still playing — Continue reads as Skip. */
  isTravel: boolean;
  legDone: boolean;
  /** Where the reader is, in their terms — "Day 6 of 13", "→ Hoi An". Steps
   * interleave days with travel legs, so the raw step number ("12 / 25") said
   * nothing useful and disagreed with the day counter in the header. */
  label: string;
  /** Whether the trip itself has finished — see `isOver` in lib/tripTime.ts.
   * Only changes what the last step says when reached; every other step is
   * unaffected. */
  tripOver: boolean;
  onBack: () => void;
  onNext: () => void;
};

/** Back / position / Continue. Rendered on its own below the content on
 * desktop, and folded into the day bar on mobile so there aren't two stacked
 * bars competing for the bottom of a phone screen. */
export default function PagerNav({
  state,
  compact = false,
}: {
  state: PagerNavState;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { stepIndex, stepCount, isTravel, legDone, label, tripOver, onBack, onNext } = state;

  const atStart = stepIndex === 0;
  const atEnd = stepIndex === stepCount - 1;
  const skipping = isTravel && !legDone;
  const nextLabel = skipping ? t("pager.skip") : t("pager.continue");

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={onBack}
          disabled={atStart}
          aria-label={t("pager.back")}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-navy-200 bg-white text-navy-700 transition-colors disabled:opacity-35"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onNext}
          disabled={atEnd}
          aria-label={nextLabel}
          className={`flex min-h-11 items-center gap-1 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-35 ${
            skipping
              ? "border border-navy-200 bg-white text-navy-700"
              : "bg-yellow-400 text-yellow-950"
          }`}
        >
          {nextLabel}
          {skipping ? <SkipForward className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <nav className="mt-6 flex items-center justify-between gap-3 border-t border-navy-200 py-4">
      <button
        onClick={onBack}
        disabled={atStart}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-4 text-base font-semibold text-navy-700 transition-colors hover:border-navy-500 disabled:opacity-40"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("pager.back")}
      </button>

      <span className="truncate px-2 text-[11px] text-navy-600">{label}</span>

      {atEnd ? (
        // A trip still going says "more soon"; a finished one shouldn't
        // promise days that are never coming.
        <span className="text-xs text-navy-600">
          {tripOver ? t("story.tripEnd") : `${t("story.caughtUp")} 🎒`}
        </span>
      ) : (
        <button
          onClick={onNext}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-base font-semibold transition-colors ${
            skipping
              ? "border border-navy-200 bg-white text-navy-700 hover:border-navy-500"
              : "bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          }`}
        >
          {nextLabel}
          {skipping ? <SkipForward className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        </button>
      )}
    </nav>
  );
}
