"use client";

import { useEffect, useState } from "react";
import CreditsScreen, { commitReadyDays } from "@/components/extract/CreditsScreen";
import DayBoard from "@/components/extract/DayBoard";
import FoundStep from "@/components/extract/FoundStep";
import IntroStep from "@/components/extract/IntroStep";
import PreviewScreen from "@/components/extract/PreviewScreen";
import ResumeScreen, { type RunSummaryClient } from "@/components/extract/ResumeScreen";
import TripModeStep, { type TripOption } from "@/components/extract/TripModeStep";
import { useI18n } from "@/components/LocaleProvider";
import UploadStep from "@/components/extract/UploadStep";
import { resumeExpiryState, type ResumeExpiryState } from "@/lib/staging/resumeState";
import type { RunManifest } from "@/lib/staging/manifest";

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
 * starting a fresh run, the shell asks `GET .../extract/runs` (read-only)
 * whether this owner already has one going. A live run means `ResumeScreen`
 * renders instead of `start()` firing: continue picks that run up exactly
 * where its photographs and answers left it (straight to the board once it
 * already has photographs, or back to uploading if it does not yet), and
 * starting a new import is still one tap away. No runs at all — the common
 * case, a first visit — skips the extra screen entirely and behaves exactly
 * as before.
 *
 * **The one extension happens on the resumed run, not on the list.** The
 * list never touches a manifest (see the route's own doc comment); the
 * actual extension is `GET .../extract/run`'s existing `extendOnTouch` call,
 * unchanged, firing the moment `DayBoard` loads the picked run. `resumeNotice`
 * is this shell's own record of whether that touch was the one that just
 * extended it — computed once, from the run as `ResumeScreen` last saw it
 * (before any touch) compared against what `DayBoard`'s first load comes
 * back with (after) — and rendered once, above whichever screen the resumed
 * run lands on, in the three sentences `lib/staging/resumeState.ts` decides
 * between.
 */
export default function ExtractFlow({
  username,
  consentedSpeech,
  speechProvider,
  trips,
}: {
  username: string;
  consentedSpeech: boolean;
  speechProvider: string;
  /** This owner's real trips, for Step 02's "add to a trip you have" —
   *  B1797. Fetched server-side by the page (`getTrips`, the same function
   *  every other owner-facing trip list already calls) rather than a new
   *  client route: the owner is looking at their own journal, and nothing
   *  here needs filtering by reader. */
  trips: TripOption[];
}) {
  const { t } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  // Step 01/02 — B1797. `awaitingStart` is true exactly when a fresh run is
  // about to be minted and the person has not yet been asked anything: the
  // moment between "no live run to resume" and `start()` actually firing.
  // `askPhase` is which of the two screens is showing while that is true.
  const [awaitingStart, setAwaitingStart] = useState(false);
  const [askPhase, setAskPhase] = useState<"intro" | "ask">("intro");
  // Whether this run's "What we found" screen (Step 04) has already been
  // shown. Resumed runs skip it — `continueRun` sets this true straight
  // away — because a returning visit has its own "welcome back" moment
  // (`ResumeScreen`) and does not need a second one.
  const [foundSeen, setFoundSeen] = useState(false);
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
  // Set the instant a run is picked off `ResumeScreen`, to whether *this*
  // resume is the one that will consume the run's single extension — read
  // from the pre-touch summary `ResumeScreen` was showing, before `DayBoard`
  // ever asks the server for anything. `null` once `resumeNotice` has been
  // computed from it (a one-shot flag: `DayBoard` reloads on every answer,
  // and only its first load after a resume is what this describes).
  const [pendingWillExtend, setPendingWillExtend] = useState<boolean | null>(null);
  const [resumeNotice, setResumeNotice] = useState<ResumeExpiryState | null>(null);

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
   * run or offer `ResumeScreen` instead — B1751 Task 4.3.
   *
   * A failed check is answered as an error, the same `extract.flow.startError`
   * plus retry `start()` itself already uses, rather than silently falling
   * through to a fresh run. Starting fresh behind a failed check would mint
   * a second run the person never asked for on top of whichever one this
   * call could not confirm — doubling what sits staged on the server and
   * making the real one invisible until its own expiry mail turns up days
   * later. A visible, retryable error is the honest answer to "the network
   * hiccuped": it costs one tap, not a silently orphaned import.
   */
  async function checkResume() {
    setError(false);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/runs`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { runs?: RunSummaryClient[] };
      const runs = Array.isArray(json.runs) ? json.runs : [];
      if (runs.length > 0) {
        setResumable(runs);
        return;
      }
      setResumable(null);
      beginAsking();
    } catch {
      setError(true);
    }
  }

  /** No live run to resume — instead of minting one straight away, ask what
   *  it should be. `askPhase` always resets to "intro": both entry points
   *  (a first visit, and "start new" off `ResumeScreen`) get the same
   *  expectation-setter, not just the returning one. */
  function beginAsking() {
    setAskPhase("intro");
    setAwaitingStart(true);
  }

  /** `POST .../extract/start` with the person's own answers to Step 02 —
   *  B1797. `RunManifest.tripId` and `.mode` have carried these fields since
   *  B1751's Task 1.2; this is the first caller that ever sends them instead
   *  of the route's own `{}`-body defaults (a new trip, typing mode). */
  async function start(answers: { tripId: string | null; mode: "voice" | "type" }) {
    setError(false);
    setRun(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(answers),
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
   *  re-created; `runId` is the one this owner already had.
   *
   *  `picked` is the pre-touch summary the (read-only) list route returned:
   *  `picked.warnedAt` set and `picked.extendedAt` not is exactly the
   *  condition under which `GET .../extract/run`'s own `extendOnTouch` will
   *  extend this run the moment it is next loaded — recorded here so
   *  `onBoardLoaded` can tell "this load is what just did it" from "already
   *  done, nothing changed". */
  function continueRun(picked: RunSummaryClient) {
    setResumable(null);
    setPendingWillExtend(Boolean(picked.warnedAt) && !picked.extendedAt);
    setResumeNotice(null);
    setRun({ runId: picked.runId, expiresAt: picked.expiresAt });
    setUploaded(picked.photos.length);
    setDone(picked.photos.length > 0);
    // A resumed run already had its Step 02 answered when it was created,
    // and a returning visit gets `resumeNotice` as its own "welcome back" —
    // Step 04's "what we found" is a first-visit screen, not shown twice.
    setFoundSeen(true);
  }

  function startNew() {
    setResumable(null);
    beginAsking();
  }

  /** Step 01's "Start with my photographs" — moves on to Step 02 without
   *  starting anything yet. */
  function onIntroContinue() {
    setAskPhase("ask");
  }

  /** Step 02's own submit — the only place `start()` is ever called with
   *  real answers rather than the defaults nobody used to ask for. */
  function onAskSubmit(tripId: string | null, mode: "voice" | "type") {
    setAwaitingStart(false);
    start({ tripId, mode });
  }

  /** `DayBoard`'s first successful load after a resume — the same
   *  `GET .../extract/run` call that has always carried `extendOnTouch`,
   *  unchanged. `pendingWillExtend` is consumed once, here: later reloads
   *  (after every answer) call this again, but `pendingWillExtend` is
   *  already `null` by then, so nothing further happens. A fresh-started
   *  run (not resumed) never sets `pendingWillExtend` in the first place, so
   *  this is a no-op for it. */
  function onBoardLoaded(manifest: RunManifest) {
    if (pendingWillExtend === null) return;
    setResumeNotice(resumeExpiryState(manifest, pendingWillExtend));
    setPendingWillExtend(null);
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
    // `w-full` — B1799. `<body>` is `flex flex-col`, and this div is its
    // direct child with no wrapper page layout giving it a width of its
    // own. Without an explicit width, a flex-column child's box is sized by
    // shrink-to-fit, which floors at its content's own min-content width —
    // and `UploadStep`'s long, unbreakable filenames pushed that floor past
    // 390px even with `min-w-0 truncate` correctly applied further down:
    // that class fixes the *local* flex-shrink inside one row, not this
    // ancestor's own intrinsic sizing pass, which runs before any row width
    // is known. `w-full` gives this div body's own definite width instead,
    // and every nested truncate below it works exactly as it looks like it
    // should.
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink-strong">{t("extract.title")}</h1>

      {error && (
        <div className="mt-4">
          <p className="text-sm text-red-700">{t("extract.flow.startError")}</p>
          <button
            type="button"
            onClick={checkResume}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
          >
            {t("err.retry")}
          </button>
        </div>
      )}

      {resumable && resumable.length > 0 && (
        <ResumeScreen runs={resumable} onContinue={continueRun} onStartNew={startNew} />
      )}

      {(resumable === undefined || (resumable === null && !run && !awaitingStart)) && !error && (
        <p className="mt-4 text-sm text-ink-secondary">{t("extract.flow.starting")}</p>
      )}

      {/* Step 01 and Step 02 — B1797. Shown only while a fresh run is about
       *  to be minted (see `beginAsking`); a resumed run skips straight past
       *  both, since it was already asked once, when it was created. */}
      {awaitingStart && askPhase === "intro" && <IntroStep onContinue={onIntroContinue} />}
      {awaitingStart && askPhase === "ask" && (
        <TripModeStep trips={trips} consentedSpeech={consentedSpeech} onSubmit={onAskSubmit} />
      )}

      {resumeNotice && (
        <div className="mt-4">
          {/* The reassurance comes first and stays adjacent to the clock —
           *  R33 review finding. Somebody reading "no further extension"
           *  needs, in the same breath, that finished days are already safe
           *  in the journal; a screen earlier is not the same as here. */}
          <p data-testid="resume-notice-reassurance" className="text-sm text-ink-body">
            {t("extract.resume.daysStay")}
          </p>
          <p data-testid="resume-notice-clock" className="mt-1 text-sm text-ink-body">
            {resumeNotice.kind === "notWarned" && t("extract.resume.notWarned")}
            {resumeNotice.kind === "justExtended" &&
              t("extract.resume.justExtended", {
                had: new Date(resumeNotice.hadUntil).toLocaleString(),
                until: new Date(resumeNotice.until).toLocaleString(),
              })}
            {resumeNotice.kind === "extended" &&
              t("extract.resume.extended", { until: new Date(resumeNotice.until).toLocaleString() })}
          </p>
        </div>
      )}

      {run && !done && (
        <div className="mt-4">
          <UploadStep username={username} runId={run.runId} onDone={onUploadAttempt} />
        </div>
      )}

      {done && !foundSeen && !atBoardEnd && run && (
        <>
          <p className="mt-4 text-sm text-ink-body">{t("extract.flow.done", { count: String(uploaded) })}</p>
          <FoundStep username={username} runId={run.runId} onContinue={() => setFoundSeen(true)} />
        </>
      )}

      {done && foundSeen && !atBoardEnd && run && (
        <DayBoard
          username={username}
          runId={run.runId}
          consentedSpeech={consentedSpeech}
          speechProvider={speechProvider}
          onLeave={onLeaveBoard}
          onLoaded={onBoardLoaded}
        />
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
