"use client";

import BusyButton from "@/components/BusyButton";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";

/** One answered (or declined) question, as the decide step shows it back —
 *  B1824, spec §4: "every row changeable, every decline shown as the answer
 *  it is." A row with neither `href` nor `onEdit` is not editable from here
 *  (rare — most answers came from an earlier gather step, reached either by
 *  a linkable URL, per H5, or — B2021 — a callback back to its own step in a
 *  single-page wizard). */
export type DecideRow = {
  label: string;
  /** The answer, or the decline reason — both render the same way. A blank
   *  answer is a legitimate one (AGENTS.md: "an empty field is better than
   *  plausible fiction") and is shown as the word for "nothing", never as
   *  empty space that reads as a bug. */
  value: string;
  /** Present when this row was declined rather than answered — rendered
   *  visibly different, never silently indistinguishable from a real
   *  answer. */
  declined?: boolean;
  href?: string;
  /** The client-side twin of `href` — B2021: a flow with no second URL for
   *  each of its own steps (a single-page wizard, not a page per question)
   *  jumps back with a callback rather than a link. Takes precedence over
   *  `href` when both are somehow given. */
  onEdit?: () => void;
};

/**
 * Step 04, "check answers" — B1824, spec §4.
 *
 * Every flow's decide step is this list plus one button. **The button's
 * label is the caller's own words, generated from the flow's actual
 * choices** ("File 45 costs to Four days round the Alps") — this component
 * never invents a generic one, and `test/studio-skeleton-no-generic-verbs.test.ts`
 * (grepped locale keys) is the check that no caller slipped "Next", "Save",
 * "Continue", "Submit" or "OK" past it (C3).
 *
 * This is the only place in the skeleton that writes — "nothing is written
 * before step five" (spec §4) means every gather and preview step before
 * this one is read-only, and `onCommit` is the one call in the whole flow
 * that is allowed to have a side effect.
 *
 * **`inStudioBar`** — B2002. A caller mounted under
 * `app/[user]/studio/layout.tsx`'s `StudioBarProvider` (every studio flow's
 * own decide step: `NewTripFlow`, `AddDayFlow`) sets this so the commit
 * button also becomes the bar's own step primary on a phone, via
 * `StepPrimary`. `EditDay.tsx` renders this same list for its own E3 save
 * confirmation and is *not* always under that provider — `StoryPager`'s
 * in-place panel mounts it outside the studio entirely — so the default
 * stays the plain button `StepPrimary` itself wraps, and only a caller that
 * knows it is inside the bar's provider opts in.
 */
export default function DecideList({
  rows,
  commitLabel,
  busyLabel,
  busy = false,
  error,
  onCommit,
  inStudioBar = false,
}: {
  rows: DecideRow[];
  /** Names the consequence — never a generic verb. See the doc comment. */
  commitLabel: string;
  busyLabel?: string;
  busy?: boolean;
  /** Set once a real write attempt failed — "nothing is written before the
   *  last step" has to hold when the write fails too (spec §4), so a caller
   *  renders this rather than leaving a half-written flow with no way to
   *  tell what happened. */
  error?: string;
  onCommit: () => void;
  /** See the doc comment above. */
  inStudioBar?: boolean;
}) {
  const { t } = useI18n();
  // B2077 — eleven bare "↺" glyphs read as one repeated symbol. The glyph
  // stays, a visible word says what it does, and the accessible name says
  // which answer it changes.
  const change = (label: string) => ({
    "aria-label": `${t("studio.decide.change")}: ${label}`,
    children: (
      <>
        <span aria-hidden>↺</span> {t("studio.decide.change")}
      </>
    ),
  });
  return (
    <div className="mt-4">
      <ul className="divide-y divide-line-faint rounded-xl border border-line-strong">
        {rows.map((row, i) => (
          <li key={i} data-decide-row className="flex items-start justify-between gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-ink-strong">{row.label}</span>
            <span
              className={`flex items-center gap-2 text-right text-sm ${row.declined ? "italic text-ink-secondary" : "text-ink-body"}`}
            >
              {row.value}
              {row.onEdit ? (
                <button
                  type="button"
                  onClick={row.onEdit}
                  className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center gap-1 font-semibold whitespace-nowrap text-ink-body not-italic underline underline-offset-2"
                  {...change(row.label)}
                />
              ) : (
                row.href && (
                  <a href={row.href} className="flex-none font-semibold whitespace-nowrap text-ink-body not-italic underline underline-offset-2" {...change(row.label)} />
                )
              )}
            </span>
          </li>
        ))}
      </ul>

      {inStudioBar ? (
        <div className="mt-4">
          <StepPrimary
            busy={busy}
            busyLabel={busyLabel}
            onClick={onCommit}
            label={commitLabel}
            tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          />
        </div>
      ) : (
        <BusyButton
          busy={busy}
          type="button"
          onClick={onCommit}
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {busy && busyLabel ? busyLabel : commitLabel}
        </BusyButton>
      )}

      <SubmitError message={error} />
    </div>
  );
}
