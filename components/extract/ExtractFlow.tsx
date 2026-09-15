"use client";

import { useEffect, useState } from "react";
import CreditsScreen, { commitReadyDays } from "@/components/extract/CreditsScreen";
import DayBoard from "@/components/extract/DayBoard";
import PreviewScreen from "@/components/extract/PreviewScreen";
import ResumeScreen, { type RunSummaryClient } from "@/components/extract/ResumeScreen";
import { useI18n } from "@/components/LocaleProvider";
import UploadStep from "@/components/extract/UploadStep";

type Run = { runId: string; expiresAt: string };

/**
 * The camera roll import's shell — B1751, Tasks 1.3 and 2.3.
 *
 * Opens a run the moment the page loads (`POST .../extract/start`, Task 1.2)
 * and then hands the upload step its `runId`. Once an upload attempt comes
 * back with nothing left to retry, the shell hands the run to `DayBoard` —
 * the workspace where the photographs get grouped into days and asked
 * about.
 *
 * "Done for now" (`onLeave`/`onLeaveBoard`) no longer ends the flow by
 * itself — B1751 Task 4.1. Every answer and edit is already saved by the
 * time it fires, so nothing is at risk, but there is still a decision this
 * instance may have to offer: `CreditsScreen`, shown only when `credits`
 * actually charges for anything (`GET .../account`'s own `credits: null`
 * meaning it does not). With it off, the ready days are committed for free
 * straight away and the flow ends the same way it always did.
 *
 * `left` is the flow's real end — B1751 Task 4.2. `PreviewScreen` is what
 * it shows: the days this run actually finished, each a link to its own
 * real page rather than anything drawn here, plus the trip's people and a
 * pointer back to the agent room for publishing, which stays that room's
 * own call.
 *
 * **Nine days of stories is not one sitting — B1751 Task 4.3.** Before ever
 * starting a fresh run, the shell asks `GET .../extract/runs` whether this
 * owner already has one going. A live run means `ResumeScreen` renders
 * instead of `start()` firing: continue picks that run up exactly where its
 * photographs and answers left it (straight to the board once it already
 * has photographs, or back to uploading if it does not yet), and starting a
 * new import is still one tap away. No runs at all — the common case, a
 * first visit — skips the extra screen entirely and behaves exactly as
 * before.
 */
export default function ExtractFlow({
  username,
  consentedSpeech,
  speechProvider,
}: {
  username: string;
  consentedSpeech: boolean;
  speechProvider: string;
}) {
  const { t } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState(false);
  // Accumulated across the initial send and every retry — `UploadStep`
  // reports only its own attempt's count, not a running total.
  const [uploaded, setUploaded] = useState(0);
  const [done, setDone] = useState(false);
  // "Done for now", pressed on the board — B1751 Task 2.3. Everything is
  // already saved by the time this fires, so leaving needs no confirmation.
  const [left, setLeft] = useState(false);
  // Whether the board has been left and, if so, this journal's own balance —
  // `null` means either "not looked yet" or "this instance charges for
  // nothing" (`balanceOf`'s own two meanings for null, B366). Fetched only
  // once the board is actually left, not up front: nobody needs to know a
  // price before they have finished telling their days. `undefined` is "not
  // fetched yet", `null` is "fetched, and this instance has no such number".
  const [atBoardEnd, setAtBoardEnd] = useState(false);
  const [credits, setCredits] = useState<number | null | undefined>(undefined);
  // `undefined` until `GET .../extract/runs` answers; `null` once the person
  // has either picked a run to continue or chosen to start fresh, so the
  // resume screen never reappears mid-flow. A non-empty array is what
  // renders it.
  const [resumable, setResumable] = useState<RunSummaryClient[] | null | undefined>(undefined);

  /**
   * `UploadStep` calls this after every attempt, success or partial failure
   * — Task 1.3's review finding: treating *any* call as terminal made the
   * tile list and retry button disappear the moment a person actually
   * needed them, with no way back short of reloading and orphaning the run.
   * The upload is only done once an attempt comes back with nothing left to
   * retry; until then `UploadStep` stays mounted, tiles and all.
   */
  function onUploadAttempt(thisUpload: number, thisFailed: number) {
    setUploaded((total) => total + thisUpload);
    if (thisFailed === 0) setDone(true);
  }

  useEffect(() => {
    checkResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the board is left, and only then, build the free days it left
  // ready — no capability check of its own; `commitReadyDays` is the same
  // free path `CreditsScreen`'s own free button calls, and `credits === null`
  // (fetched by `onLeaveBoard`) is what says nobody is going to be asked for
  // money on top of it, so there is nothing here for a screen to show.
  useEffect(() => {
    if (atBoardEnd && credits === null && run) {
      commitReadyDays(username, run.runId)
        .then(() => setLeft(true))
        .catch(() => setLeft(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atBoardEnd, credits]);

  /**
   * The one call this shell makes before deciding whether to start a fresh
   * run or offer `ResumeScreen` instead — B1751 Task 4.3. Any failure here
   * (network, a 404 from the capability being off) falls back to starting a
   * new run exactly as before: not finding out whether an old one exists is
   * never a reason to leave the person stuck on nothing.
   */
  async function checkResume() {
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/runs`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { runs?: RunSummaryClient[] };
      const runs = Array.isArray(json.runs) ? json.runs : [];
      if (runs.length > 0) {
        setResumable(runs);
        return;
      }
    } catch {
      // Fall through to starting fresh.
    }
    setResumable(null);
    start();
  }

  async function start() {
    setError(false);
    setRun(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as Run;
      setRun(json);
    } catch {
      setError(true);
    }
  }

  /** Picking a run off `ResumeScreen` — its photographs and answers decide
   *  where this lands: straight to the board if it already has photographs
   *  to sort, back to uploading if it does not. Either way nothing is
   *  re-created; `runId` is the one this owner already had. */
  function continueRun(picked: RunSummaryClient) {
    setResumable(null);
    setRun({ runId: picked.runId, expiresAt: picked.expiresAt });
    setUploaded(picked.photos.length);
    setDone(picked.photos.length > 0);
  }

  function startNew() {
    setResumable(null);
    start();
  }

  /**
   * "Done for now" on the board leads here rather than straight to `left` —
   * B1751 Task 4.1. What this instance charges decides what happens next:
   * `credits: null` (`/api/helper/[user]/account`, itself reading
   * `balanceOf`'s own null-means-off) skips the credits screen entirely
   * (see the effect above), and a real number renders `CreditsScreen`.
   */
  async function onLeaveBoard() {
    setAtBoardEnd(true);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/account`);
      const json = (await res.json().catch(() => null)) as { credits?: number | null } | null;
      setCredits(json && typeof json.credits === "number" ? json.credits : null);
    } catch {
      // No balance to show is the same as "this instance charges for
      // nothing" from here — the free path still has to work.
      setCredits(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-ink-strong">{t("extract.title")}</h1>

      {error && (
        <div className="mt-4">
          <p className="text-sm text-red-700">{t("extract.flow.startError")}</p>
          <button
            type="button"
            onClick={start}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
          >
            {t("err.retry")}
          </button>
        </div>
      )}

      {resumable && resumable.length > 0 && (
        <ResumeScreen runs={resumable} onContinue={continueRun} onStartNew={startNew} />
      )}

      {(resumable === undefined || (resumable === null && !run)) && !error && (
        <p className="mt-4 text-sm text-ink-secondary">{t("extract.flow.starting")}</p>
      )}

      {run && !done && (
        <div className="mt-4">
          <UploadStep username={username} runId={run.runId} onDone={onUploadAttempt} />
        </div>
      )}

      {done && !atBoardEnd && run && (
        <>
          <p className="mt-4 text-sm text-ink-body">{t("extract.flow.done", { count: String(uploaded) })}</p>
          <DayBoard
            username={username}
            runId={run.runId}
            consentedSpeech={consentedSpeech}
            speechProvider={speechProvider}
            onLeave={onLeaveBoard}
          />
        </>
      )}

      {atBoardEnd && !left && run && credits !== undefined && credits !== null && (
        <CreditsScreen username={username} runId={run.runId} credits={credits} onDone={() => setLeft(true)} />
      )}

      {atBoardEnd && !left && (credits === undefined || credits === null) && (
        <p className="mt-4 text-sm text-ink-secondary">{t("extract.flow.building")}</p>
      )}

      {left && run && <PreviewScreen username={username} runId={run.runId} />}
    </div>
  );
}
