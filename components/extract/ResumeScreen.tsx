"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { RunManifest } from "@/lib/staging/manifest";

/** What `GET .../extract/runs` hands back for one run — the manifest,
 *  unmodified (the route is read-only, see its own doc comment), plus how
 *  many days still have open questions. `daysLeftToTell` is computed on the
 *  server, not here: `groupIntoDays` reaches `lib/ingest/geo.ts` and
 *  `node:fs` through `lib/ingest/cluster.ts`, and a client bundle that
 *  imports it anyway fails to build outright. */
export type RunSummaryClient = RunManifest & { daysLeftToTell: number };

/**
 * "You left this half-finished" — B1751 Task 4.3. Shown by `ExtractFlow`
 * instead of minting a new run whenever `GET .../extract/runs` finds one
 * already live for this owner.
 *
 * **This list states facts, and claims no extension.** Each card's own
 * `extract.resume.expiresOn` line is exactly `run.expiresAt` — true whether
 * the run has been warned or not, and true whether it has already been
 * extended or not, because it names nothing more than what is already on
 * the manifest. The three-sentence "here is what just happened to your
 * clock" framing — no hurry yet / you just got extended / no further
 * extension — belongs to the run that was actually picked, not to a list
 * somebody may only be glancing at: `ExtractFlow` renders it once, right
 * after `Continue`, above whichever screen the resumed run lands on.
 *
 * Above the fold, in every case: finished days already belong to the
 * journal and are unaffected by anything on this screen or by the run
 * itself expiring — the sentence somebody reading "your photographs will be
 * deleted" needs first, not last.
 */
export default function ResumeScreen({
  runs,
  onContinue,
  onStartNew,
}: {
  runs: RunSummaryClient[];
  onContinue: (run: RunSummaryClient) => void;
  onStartNew: () => void;
}) {
  const { t, tn } = useI18n();

  return (
    <div className="mt-4">
      <p className="text-sm text-ink-body">{t("extract.resume.title")}</p>
      <p className="mt-1 text-xs text-ink-secondary">{t("extract.resume.daysStay")}</p>

      <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
        {runs.map((run) => {
          const live = run.photos.filter((p) => !p.dropped).length;
          const left = run.daysLeftToTell;
          return (
            <li key={run.runId} className="px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{run.createdAt.slice(0, 10)}</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {tn("extract.board.photoCount", live, { count: String(live) })}
                {" · "}
                {tn("extract.resume.daysLeft", left, { count: String(left) })}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {t("extract.resume.expiresOn", { until: new Date(run.expiresAt).toLocaleString() })}
              </p>
              <button
                type="button"
                onClick={() => onContinue(run)}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
              >
                {t("extract.resume.continue")}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onStartNew}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("extract.resume.startNew")}
      </button>
    </div>
  );
}
