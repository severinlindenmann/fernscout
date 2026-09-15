"use client";

import { resumeExpiryState } from "@/lib/staging/resumeState";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { RunManifest } from "@/lib/staging/manifest";

/** What `GET .../extract/runs` hands back for one run — the manifest, plus
 *  whether that very request just extended it (see the route's own doc
 *  comment) and how many days still have open questions. `daysLeftToTell`
 *  is computed on the server, not here: `groupIntoDays` reaches
 *  `lib/ingest/geo.ts` and `node:fs` through `lib/ingest/cluster.ts`, and a
 *  client bundle that imports it anyway fails to build outright. Named
 *  separately from the server's `RunSummary` only because a client
 *  component cannot import a type from a module that also carries runtime
 *  code guarded by `server-only` — the same reason `lib/staging/resumeState.ts`
 *  exists as its own file. */
export type RunSummaryClient = RunManifest & { justExtended: boolean; daysLeftToTell: number };

/**
 * One run's clock, in the three sentences `lib/staging/resumeState.ts`
 * decides between. `t`/`tn` are threaded in rather than called from
 * `useI18n()` here, so this stays a small pure-ish renderer next to the
 * pure state function it reads.
 */
function ExpiryLine({
  run,
  t,
}: {
  run: RunSummaryClient;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const state = resumeExpiryState(run, run.justExtended);
  if (state.kind === "notWarned") {
    return <p className="mt-1 text-xs text-ink-secondary">{t("extract.resume.notWarned")}</p>;
  }
  if (state.kind === "justExtended") {
    return (
      <p className="mt-1 text-xs text-ink-secondary">
        {t("extract.resume.justExtended", {
          had: new Date(state.hadUntil).toLocaleString(),
          until: new Date(state.until).toLocaleString(),
        })}
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-ink-secondary">
      {t("extract.resume.extended", { until: new Date(state.until).toLocaleString() })}
    </p>
  );
}

/**
 * "You left this half-finished" — B1751 Task 4.3. Shown by `ExtractFlow`
 * instead of minting a new run whenever `GET .../extract/runs` finds one
 * already live for this owner.
 *
 * Above the fold, in every state: finished days already belong to the
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
              <ExpiryLine run={run} t={t} />
              <button
                type="button"
                onClick={() => onContinue(run)}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-ink-strong px-5 text-base font-semibold text-white"
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
