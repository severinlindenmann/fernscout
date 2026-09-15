"use client";

import { useEffect, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { countdownFor, tickIntervalFor, type CountdownTier } from "@/lib/staging/countdown";
import type { RunManifest } from "@/lib/staging/manifest";

/** What `GET .../extract/runs` hands back for one run — the manifest,
 *  unmodified (the route is read-only, see its own doc comment), plus how
 *  many days still have open questions. `daysLeftToTell` is computed on the
 *  server, not here: `groupIntoDays` reaches `lib/ingest/geo.ts` and
 *  `node:fs` through `lib/ingest/cluster.ts`, and a client bundle that
 *  imports it anyway fails to build outright. */
export type RunSummaryClient = RunManifest & { daysLeftToTell: number };

/** `t`/`tn` typed loosely here on purpose — the countdown composes several
 *  keys at runtime and the exact union isn't worth re-deriving in this
 *  file's own types. */
type Translate = ReturnType<typeof useI18n>["t"];
type TranslateN = ReturnType<typeof useI18n>["tn"];

/** One tier's numbers turned into words — "2 days, 3 hours left", "45
 *  minutes left", "about to be cleared". Composes the same
 *  count-pluralised-then-joined "Part" keys `PhotoPicker` already uses for
 *  "3 Fotos und 1 Datei", because no plural system here declines two counts
 *  in one key. */
function describe(tier: CountdownTier, t: Translate, tn: TranslateN): string {
  if (tier.unit === "now") return t("extract.resume.countdown.now");

  if (tier.unit === "days") {
    const parts = [];
    if (tier.days > 0) {
      parts.push(tn("extract.resume.countdown.daysPart", tier.days, { count: String(tier.days) }));
    }
    if (tier.hours > 0) {
      parts.push(tn("extract.resume.countdown.hoursPart", tier.hours, { count: String(tier.hours) }));
    }
    return t("extract.resume.countdown.left", { time: parts.join(` ${t("agent.andJoin")} `) });
  }

  if (tier.unit === "minutes") {
    return t("extract.resume.countdown.left", {
      time: tn("extract.resume.countdown.minutesPart", tier.minutes, { count: String(tier.minutes) }),
    });
  }

  return t("extract.resume.countdown.left", {
    time: tn("extract.resume.countdown.secondsPart", tier.seconds, { count: String(tier.seconds) }),
  });
}

/**
 * "You left this half-finished" — B1751 Task 4.3. Shown by `ExtractFlow`
 * instead of minting a new run whenever `GET .../extract/runs` finds one
 * already live for this owner.
 *
 * **The countdown ticks, at the rate its own precision needs — B1805.**
 * `now` is one piece of state shared by the whole list rather than one timer
 * per run: every tick recomputes each run's tier from its own `expiresAt`
 * (never cached at mount, so a list re-fetched after an extension reflects
 * the new deadline for free) and reschedules itself for whichever run needs
 * the next update soonest. A list showing only "2 days left" reschedules
 * itself a minute out; one showing seconds reschedules every second — never
 * the other way around.
 *
 * **This list still states facts, and claims no extension.** Each card's own
 * countdown is exactly `run.expiresAt` — true whether the run has been
 * warned or not, and true whether it has already been extended or not,
 * because it names nothing more than what is already on the manifest. The
 * three-sentence "here is what just happened to your clock" framing — no
 * hurry yet / you just got extended / no further extension — belongs to the
 * run that was actually picked, not to a list somebody may only be glancing
 * at: `ExtractFlow` renders it once, right after `Continue`, above whichever
 * screen the resumed run lands on.
 *
 * Above the fold, in every case: finished days already belong to the
 * journal and are unaffected by anything on this screen or by the run
 * itself expiring — the sentence somebody reading a deletion clock needs
 * first, not last.
 *
 * **Destroying a run is the rare action, not the ordinary one.** It sits as
 * a small text link under the (real, weighted) Continue button rather than
 * a second button beside it, and goes through `ConfirmPanel` — this
 * repository forbids `window.confirm` outright — naming what is lost (the
 * staged photographs) and what is not (`extract.resume.daysStay`, reused
 * rather than a fourth copy of the same sentence this feature already
 * carries three of).
 */
export default function ResumeScreen({
  username,
  runs,
  onContinue,
  onStartNew,
  onDestroyed,
}: {
  username: string;
  runs: RunSummaryClient[];
  onContinue: (run: RunSummaryClient) => void;
  onStartNew: () => void;
  /** Called once a run is actually gone from disk, so the caller can drop it
   *  from whatever list it is holding. */
  onDestroyed: (runId: string) => void;
}) {
  const { t, tn } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // One shared timer for the whole list — not one per run — rescheduling
  // itself at whichever run's tier needs the soonest update. `setTimeout`
  // rather than `setInterval` because the needed delay changes as a run
  // crosses a tier boundary (days → minutes → seconds) and a fixed interval
  // cannot speed itself up.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      const at = new Date();
      setNow(at);
      const next = Math.min(
        ...runs.map((run) => tickIntervalFor(countdownFor(run.expiresAt, at))).filter((ms) => ms > 0),
      );
      if (Number.isFinite(next)) timer = setTimeout(tick, next);
    }
    tick();
    return () => clearTimeout(timer);
  }, [runs]);

  async function destroy(runId: string) {
    setBusy(true);
    setFailed(false);
    const res = await fetch(
      `/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setConfirming(null);
    onDestroyed(runId);
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-ink-body">{t("extract.resume.title")}</p>
      <p className="mt-1 text-xs text-ink-secondary">{t("extract.resume.daysStay")}</p>

      <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
        {runs.map((run) => {
          const live = run.photos.filter((p) => !p.dropped).length;
          const left = run.daysLeftToTell;
          const tier = countdownFor(run.expiresAt, now);
          return (
            <li key={run.runId} className="px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{run.createdAt.slice(0, 10)}</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {tn("extract.board.photoCount", live, { count: String(live) })}
                {" · "}
                {tn("extract.resume.daysLeft", left, { count: String(left) })}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">{describe(tier, t, tn)}</p>
              <button
                type="button"
                onClick={() => onContinue(run)}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
              >
                {t("extract.resume.continue")}
              </button>

              {confirming === run.runId ? (
                <div className="mt-2">
                  <ConfirmPanel
                    label={t("extract.resume.countdown.destroyButton")}
                    question={tn("extract.resume.countdown.destroyQuestion", live, { count: String(live) })}
                    details={t("extract.resume.daysStay")}
                    confirmLabel={t("extract.resume.countdown.destroyConfirm")}
                    busyLabel={t("extract.resume.countdown.destroyBusy")}
                    busy={busy}
                    error={failed ? t("extract.resume.countdown.destroyFailed") : undefined}
                    onConfirm={() => void destroy(run.runId)}
                    onCancel={() => {
                      setConfirming(null);
                      setFailed(false);
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(run.runId);
                    setFailed(false);
                  }}
                  className="mt-2 block text-xs font-semibold text-coral-600 underline underline-offset-2 hover:opacity-75"
                >
                  {t("extract.resume.countdown.destroyButton")}
                </button>
              )}
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
