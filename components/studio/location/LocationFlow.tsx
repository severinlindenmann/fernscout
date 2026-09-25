"use client";

import { useState } from "react";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";
import WhatStep from "@/components/studio/WhatStep";
import StepIndicator from "@/components/extract/StepIndicator";
import DoneScreen, { type DoneNext } from "@/components/studio/DoneScreen";
import { PhotoPicker } from "@/components/PhotoPicker";
import type { TranslationKey } from "@/lib/i18n";
import type { Extent, TripCoverage } from "@/lib/gps/api";
import { useStep } from "@/lib/studio/useStep";
import { useSkipIntro } from "@/lib/studio/fromHub";
import StepBody from "@/components/studio/StepBody";

/** The screens a person counts, in `?step=` (B2079). A file that could not
 *  be read is the "read" step's own answer, and done is the write's outcome,
 *  not a step a reload or Back should land on. */
const STEPS = ["what", "get", "send", "read", "decide"] as const;
type Platform = "android" | "iphone";

type TripOption = { id: string; title: string; start: string; end: string };

type InboxItem = { id: string; filename: string };
type InboxUploadResponse = { ok?: true; items?: InboxItem[]; error?: string };

type PeekResponse = {
  ok?: true;
  read?: number;
  from?: string | null;
  to?: string | null;
  extent?: Extent | null;
  coverage?: TripCoverage[];
  error?: string;
  message?: string;
  problems?: string[];
  filename?: string;
};

type WriteResponse = {
  ok?: true;
  read?: number;
  drawn?: { tripId: string; segments: number; points: number }[];
  discarded?: boolean;
  error?: string;
};

/** Refusals from `importGps` that mean "wrong file entirely" (L4✗) rather
 *  than "right file, our parser's own gap" (L4✗✗ — the B1819 bug this flow
 *  was blocked on). Anything else falls back to a generic message. */
const WRONG_FILE_REFUSALS = new Set(["unknown_format", "unreadable"]);

/**
 * "Where you actually went" — B1937, spec §7.3. The location flow's five
 * steps, wearing the same skeleton `PeopleFlow.tsx` (B1823) and
 * `StatementFlow.tsx` (B1822) do. Three things here are load-bearing rather
 * than decorative — see the doc comments at each site below:
 *
 * 1. **The promise is made on `what`, not in a footer**, and restated on
 *    `decide` beside the keep/discard choice.
 * 2. **`peek` shows a bounding box, never the route.** `extent` is four
 *    numbers; nothing this component receives is an ordered list of
 *    positions, and nothing here could draw one even by accident. See
 *    `lib/gps/api.ts`'s `Extent` type and `test/gps-extent-not-route.test.ts`.
 * 3. **`decide`'s default keeps the history privately (D7)** — `discard`
 *    starts `false`, one tap from `true`, never the other way round.
 *
 * **Nothing is written before `decide`'s own button.** `peek` always calls
 * `.../import` with `dryRun: true`; only the final press sends `commit: true`.
 *
 * **One door.** Picking the file lands on the same `peek` read every other
 * import in this repository uses. B2240 removed the WhatsApp door this flow
 * used to offer alongside it — the server-side inbox path it polled is
 * untouched, since other kinds of file still deliver through it, but this
 * flow no longer reads from it.
 */
export default function LocationFlow({
  username,
  trips,
  defaultTripId,
}: {
  username: string;
  trips: TripOption[];
  defaultTripId: string | null;
}) {
  const { t, tn, formatLongDate, locale } = useI18n();
  const [platform, setPlatform] = useState<Platform>("android");
  const [showTips, setShowTips] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliverError, setDeliverError] = useState<TranslationKey | null>(null);

  const [inboxId, setInboxId] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekResponse | null>(null);
  const [failure, setFailure] = useState<{ key: TranslationKey; filename: string; message?: string } | null>(null);

  const [selectedTrips, setSelectedTrips] = useState<Set<string>>(new Set());
  // D7 — pre-selected: the history is kept, not thrown away, until somebody
  // taps the other card. Never start this `true`.
  const [discard, setDiscard] = useState(false);

  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResponse | null>(null);

  // B2079 — the read and the choices ride in the session draft, so a reload
  // or Back keeps them. The extent is left out on purpose: it is a box
  // around somebody's location history, and nothing here draws it.
  const { step: urlStep, total, go, back, reset } = useStep(STEPS, {
    flowId: `location:${username}`,
    // B2136 (was B2079's `step`) — a reload or deep link on "read" or
    // "decide" with no read to show (the draft could not be kept) lands on
    // sending the file again; a failed read still shows on "read".
    complete: (s) => (s === "send" ? !!peek || !!failure : s === "read" ? !!peek : true),
    draft: {
      get: () => ({
        platform,
        inboxId,
        peek: peek && { read: peek.read, from: peek.from, to: peek.to, coverage: peek.coverage },
        selectedTrips: [...selectedTrips],
        discard,
      }),
      set: (d) => {
        if (d.platform === "android" || d.platform === "iphone") setPlatform(d.platform);
        if (typeof d.inboxId === "string") setInboxId(d.inboxId);
        const read = d.peek as PeekResponse | null;
        if (read && typeof read === "object" && typeof read.read === "number" && Array.isArray(read.coverage)) setPeek(read);
        if (Array.isArray(d.selectedTrips)) setSelectedTrips(new Set(d.selectedTrips.filter((x): x is string => typeof x === "string")));
        if (typeof d.discard === "boolean") setDiscard(d.discard);
      },
    },
  });
  // B2141: from the hub, the flow opens on its first real step.
  const skipIntro = useSkipIntro();
  const step = urlStep === "what" && skipIntro ? "get" : urlStep;

  // ── upload → read ───────────────────────────────────────────────────────
  async function runPeek(id: string, filename: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inbox: id, dryRun: true }),
      });
      const json = (await res.json().catch(() => null)) as PeekResponse | null;
      if (!res.ok || !json?.ok) {
        setFailure({
          key: WRONG_FILE_REFUSALS.has(json?.error ?? "")
            ? "studio.location.peekFail.wrongFile"
            : "studio.location.peekFail.empty",
          filename: json?.filename ?? filename,
          // `problems` names the actual measurement ("parse returned
          // nothing…"); the top-level `message` is the generic "does not
          // hold up" wrapper. The specific one is the honest one.
          message: json?.problems?.length ? json.problems.join(" ") : json?.message,
        });
        setPeek(null);
        go("read");
        return;
      }
      setFailure(null);
      setPeek(json);
      setInboxId(id);
      const withCoverage = new Set((json.coverage ?? []).filter((c) => c.days > 0).map((c) => c.tripId));
      setSelectedTrips(withCoverage);
      go("read");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndPeek() {
    if (!file) return;
    setBusy(true);
    setDeliverError(null);
    try {
      const form = new FormData();
      form.append("files", file, file.name);
      const staged = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, { method: "POST", body: form });
      const stagedJson = (await staged.json().catch(() => null)) as InboxUploadResponse | null;
      const item = stagedJson?.items?.[0];
      if (!staged.ok || !item) {
        setDeliverError("studio.location.deliver.error");
        return;
      }
      await runPeek(item.id, item.filename);
    } finally {
      setBusy(false);
    }
  }

  function toggleTrip(id: string) {
    setSelectedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function commit() {
    if (!inboxId) return;
    setWriteBusy(true);
    setWriteError(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inbox: inboxId, commit: true, trips: [...selectedTrips], discard }),
      });
      const json = (await res.json().catch(() => null)) as WriteResponse | null;
      if (!res.ok || !json?.ok) {
        setWriteError(t("studio.location.decide.error"));
        return;
      }
      setResult(json);
      reset();
    } catch {
      setWriteError(t("studio.location.decide.error"));
    } finally {
      setWriteBusy(false);
    }
  }

  const tripById = new Map(trips.map((tr) => [tr.id, tr]));
  const coverage = peek?.coverage ?? [];
  const untouched = coverage.filter((c) => c.days === 0).flatMap((c) => tripById.get(c.tripId)?.title ?? []);
  // The current trip wins ties (and is the natural first guess), but never
  // over a trip the file actually covers more of.
  const byDefaultFirst = [...coverage].sort((a, b) => {
    if (a.tripId === defaultTripId && b.tripId !== defaultTripId) return -1;
    if (b.tripId === defaultTripId && a.tripId !== defaultTripId) return 1;
    return b.days - a.days;
  });
  const primaryCoverage = byDefaultFirst.find((c) => c.days > 0) ?? byDefaultFirst[0];
  const primaryTrip = primaryCoverage ? tripById.get(primaryCoverage.tripId) : undefined;

  const selectedTitles = [...selectedTrips].map((id) => tripById.get(id)?.title ?? id);
  const commitLabel =
    selectedTitles.length === 1
      ? t("studio.location.decide.cta.one", { trip: selectedTitles[0] })
      : selectedTitles.length > 1
        ? t("studio.location.decide.cta.many", { count: String(selectedTitles.length) })
        : discard
          ? t("studio.location.decide.cta.discardOnly")
          : t("studio.location.decide.cta.keepOnly");

  // B2082 — done links to the map it just drew (one card per trip, two at
  // most); with no line drawn there is no map to see, so the next thing is
  // the photographs.
  const drawnNext: DoneNext[] = (result?.drawn ?? []).slice(0, 2).map((d) => ({
    title: t("studio.location.done.mapTitle", { trip: tripById.get(d.tripId)?.title ?? d.tripId }),
    href: `/${username}/trips/${encodeURIComponent(d.tripId)}/map`,
    label: t("studio.location.done.seeMap"),
  }));
  const doneNext: [DoneNext] | [DoneNext, DoneNext] =
    drawnNext.length === 2
      ? [drawnNext[0], drawnNext[1]]
      : [
          drawnNext[0] ?? {
            title: t("studio.newTrip.done.photos.title"),
            href: `/${username}/studio/photos`,
            label: t("studio.newTrip.done.photos.cta"),
          },
        ];

  return (
    <StepBody step={step}>

      {!result && step === "what" && (
        <>
          <div className="mt-4">
            <StepIndicator total={total} current={1} label={t("studio.location.what.stepLabel")} />
          </div>
          <WhatStep
            inStudioBar
            title={t("studio.location.what.title")}
            hideHeading
            consequence={t("studio.location.what.consequence")}
            promise={t("studio.location.what.promise")}
            cta={{ label: t("studio.location.what.cta"), onContinue: () => go("get") }}
          />
        </>
      )}

      {!result && step === "get" && (
        <div className="mt-4">
          <StepIndicator total={total} current={2} label={t("studio.location.getIt.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.location.getIt.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">{t("studio.location.getIt.intro")}</p>

          <div className="mt-3 flex gap-2">
            {(["android", "iphone"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                  platform === p ? "border-ink-strong text-ink-strong" : "border-line-strong text-ink-secondary"
                }`}
              >
                {t(`studio.location.getIt.platform.${p}` as TranslationKey)}
              </button>
            ))}
          </div>

          <div className="mt-3 whitespace-pre-line rounded-xl border border-line-strong px-4 py-3 text-sm text-ink-body">
            {/* B2143 — first, whether there is anything to export at all. */}
            <p data-timeline-check className="mb-2 font-semibold text-ink-strong">
              {t(`studio.location.getIt.check.${platform}` as TranslationKey)}
            </p>
            {t(`studio.location.getIt.steps.${platform}` as TranslationKey)}
          </div>

          {showTips && (
            <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.getIt.tips")}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <StepPrimary onClick={() => go("send")} label={t("studio.location.getIt.haveFile")} />
            <button
              type="button"
              onClick={() => setShowTips(true)}
              className="min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
            >
              {t("studio.location.getIt.cannotFind")}
            </button>
          </div>
        </div>
      )}

      {!result && step === "send" && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.location.deliver.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.location.deliver.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">{t("studio.location.deliver.introOne")}</p>

          <div className="mt-3 rounded-xl border border-line-strong px-4 py-3">
            <p className="font-display text-base font-semibold text-ink-strong">{t("studio.location.deliver.browse.title")}</p>
            <p className="mt-1 text-sm text-ink-body">{t("studio.location.deliver.browse.subtitle")}</p>
            <PhotoPicker
              id="location-export"
              accept=".json,application/json,.gpx"
              chosen={file ? [file] : []}
              showChosen={!!file}
              onPick={(files) => setFile(files?.[0] ?? null)}
            />
            <StepPrimary
              busy={busy}
              disabled={!file}
              onClick={() => void uploadAndPeek()}
              label={t("studio.location.deliver.browse.button")}
            />
          </div>

          {deliverError && (
            <p role="alert" className="mt-3 text-sm text-coral-600">
              {t(deliverError)}
            </p>
          )}
        </div>
      )}

      {!result && step === "read" && peek && (
        <div className="mt-4">
          <StepIndicator total={total} current={4} label={t("studio.location.peek.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.location.peek.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">
            {/* B2139 — one day reads as one date, not "from X to X". */}
            {peek.from && peek.to && peek.from.slice(0, 10) === peek.to.slice(0, 10)
              ? tn("studio.location.peek.summaryOneDay", peek.read ?? 0, {
                  count: new Intl.NumberFormat(locale).format(peek.read ?? 0),
                  date: formatLongDate(peek.from.slice(0, 10), { year: true }),
                })
              : tn("studio.location.peek.summary", peek.read ?? 0, {
                  count: new Intl.NumberFormat(locale).format(peek.read ?? 0),
                  from: peek.from ? formatLongDate(peek.from.slice(0, 10), { year: true }) : "",
                  to: peek.to ? formatLongDate(peek.to.slice(0, 10), { year: true }) : "",
                })}
          </p>
          {primaryTrip && primaryCoverage && primaryCoverage.days > 0 ? (
            <p className="mt-1 text-sm text-ink-body">
              {t("studio.location.peek.coverage", {
                days: String(primaryCoverage.days),
                tripDays: String(primaryCoverage.tripDays),
                trip: primaryTrip.title,
              })}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-body">{t("studio.location.peek.noCoverage")}</p>
          )}

          <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.peek.notWritten")}</p>

          <div className="mt-4">
            <StepPrimary onClick={() => go("decide")} label={t("studio.location.peek.cta")} />
          </div>
        </div>
      )}

      {!result && step === "read" && !peek && failure && (
        <div className="mt-4">
          <StepIndicator total={total} current={4} label={t("studio.location.peek.stepLabel")} />
          <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
            <p className="font-semibold text-ink-strong">{t(failure.key)}</p>
            <p className="mt-1 font-mono text-xs">{failure.filename}</p>
          </div>
          {failure.key === "studio.location.peekFail.empty" && failure.message && (
            <p className="mt-2 text-sm text-ink-secondary">{failure.message}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <StepPrimary onClick={back} label={t("studio.location.peekFail.tryAgain")} />
          </div>
        </div>
      )}

      {!result && step === "decide" && peek && (
        <div className="mt-4">
          <StepIndicator total={total} current={5} label={t("studio.location.decide.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.location.decide.heading")}</h2>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.location.decide.whichTrips")}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {/* B2139 — only trips the file touches get a row; the rest are
                one line underneath, not a column of disabled boxes. */}
            {coverage.map((c) => {
              const trip = tripById.get(c.tripId);
              if (!trip || c.days === 0) return null;
              return (
                <label key={c.tripId} className="flex items-center justify-between gap-3 rounded-xl border border-line-strong px-4 py-3">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={selectedTrips.has(c.tripId)} onChange={() => toggleTrip(c.tripId)} />
                    <span className="text-sm font-semibold text-ink-strong">{trip.title}</span>
                  </span>
                  <span className="text-right text-xs text-ink-body">
                    {t("studio.location.decide.daysCovered", { days: String(c.days), tripDays: String(c.tripDays) })}
                  </span>
                </label>
              );
            })}
          </div>
          {untouched.length > 0 && (
            <p className="mt-2 text-sm text-ink-secondary">
              {tn("studio.location.decide.noPositions", untouched.length, {
                count: String(untouched.length),
                trips: untouched.join(", "),
              })}
            </p>
          )}

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.location.decide.restHeading")}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <label
              className={`rounded-xl border px-4 py-3 ${!discard ? "border-ink-strong" : "border-line-strong"}`}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="location-keep-or-discard" checked={!discard} onChange={() => setDiscard(false)} />
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.decide.keep.title")}</span>
              </span>
              {/* The L1 promise, restated where it is being acted on. */}
              <p className="mt-1 text-sm text-ink-body">{t("studio.location.decide.keep.promise")}</p>
            </label>
            <label
              className={`rounded-xl border px-4 py-3 ${discard ? "border-ink-strong" : "border-line-strong"}`}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="location-keep-or-discard" checked={discard} onChange={() => setDiscard(true)} />
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.decide.discard.title")}</span>
              </span>
              {/* B1843 addendum — the discard is precise to this file's own
                  dates, not the whole month, and drawn maps are unaffected. */}
              <p className="mt-1 text-sm text-ink-body">{t("studio.location.decide.discard.promise")}</p>
            </label>
          </div>

          <div className="mt-4">
            <StepPrimary
              busy={writeBusy}
              onClick={commit}
              label={commitLabel}
              tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
            />
          </div>
          <SubmitError message={writeError} />
        </div>
      )}

      {result && (
        <DoneScreen
          username={username}
          done={[
            ...((result.drawn ?? []).length > 0
              ? (result.drawn ?? []).map((d) => t("studio.location.done.tripHasMap", { trip: tripById.get(d.tripId)?.title ?? d.tripId }))
              : [t("studio.location.done.noTrips")]),
            result.discarded ? t("studio.location.done.discarded") : t("studio.location.done.kept"),
          ].join(" ")}
          next={doneNext}
        />
      )}
    </StepBody>
  );
}
