"use client";

import { useEffect, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import WhatStep from "@/components/studio/WhatStep";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import DoneScreen from "@/components/studio/DoneScreen";
import PreviewNotice from "@/components/studio/PreviewNotice";
import StepIndicator from "@/components/extract/StepIndicator";
import { useI18n } from "@/components/LocaleProvider";
import type { EditablePickerTrip } from "@/lib/studio/editDay";
import DateField, { tripCalendar } from "@/components/studio/DateField";
import { cutEditPicker, editPickerHasMore } from "@/lib/studio/pickerCut";
import StepBody from "@/components/studio/StepBody";
import { useStep } from "@/lib/studio/useStep";
import { useSkipIntro } from "@/lib/studio/fromHub";

type Operation = "move" | "split" | "merge";

type DayDetail = {
  tripId: string;
  tripTitle: string;
  slug: string;
  title: string;
  date: string;
  time?: string;
  content: string;
  media: { src: string }[];
  published: boolean;
};

/** Every screen, in `?step=` (B2136) — the order is the one a clamp reads:
 *  a step is reachable only once every step before it here that applies to
 *  this run is answered. Done and a failed write are outcomes, not steps. */
const STEPS = [
  "what",
  "pickOperation",
  "pickDay",
  "pickSecondDay",
  "mergeCrossTrip",
  "moveTarget",
  "splitCut",
  "preview",
  "addressConfirm",
] as const;

/**
 * The four screens every run of this flow shows, whichever operation —
 * B2080, B2137. The step indicator counts these and nothing else: "what" is
 * the opening (no indicator, as in every studio wizard); `mergeCrossTrip`
 * and `addressConfirm` are interstitials only some runs meet; done and a
 * failed write are outcomes. `detail` is the operation's own gather screen —
 * `moveTarget`, `splitCut` or `pickSecondDay`.
 *
 * B2137: one ask, not two. The preview used to end in "Looks right", then a
 * sweep screen, then a separate "Move it?" screen asked again. Now the
 * preview is the decision: before/after, what else points at a moved day
 * (the sweep, read when "See what this moves" is pressed), and the one
 * `ConfirmPanel` that writes. A published move to another trip goes through
 * `addressConfirm` instead, whose own confirm ("Move it, and break the old
 * link") is that one write.
 *
 * On `useStep` since B2136: the draft keeps the chosen days' slugs, and a
 * reload re-fetches their detail from those before it draws the step.
 */
const COUNTED = ["pickOperation", "pickDay", "detail", "preview"] as const;

/**
 * "Something is filed wrong" — B1832, spec §7.1. Named on the hub by what
 * went wrong, not by the operation (M1). Three operations share one
 * skeleton here rather than three separate flows, because they share every
 * step except gather: pick the day(s), preview before/after, decide (the
 * reference sweep, M4, plus D2's own confirm when it applies), do it.
 *
 * **Nothing is written before `commit()`** — every step above it only reads,
 * through the GET half of `/api/web/{user}/studio/reshape` (day detail,
 * reference sweep), never the POST half.
 */
export default function ReshapeDayFlow({
  username,
  picker,
  trips,
}: {
  username: string;
  picker: EditablePickerTrip[];
  trips: { id: string; title: string; start?: string; end?: string }[];
}) {
  const { t, tn, formatLongDate } = useI18n();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [outcome, setOutcome] = useState<"done" | "writeFailed" | null>(null);
  // B1954 — same trim as "Change a day"'s own picker (`EditDayFlow`), which
  // this flow's picker inherited unchanged from `daysForEditPicker`. No
  // search box here to fall back on, so "Show more" is the only way past
  // it; reset per pick-a-day step, not carried from the first day to the
  // second.
  const [showAllA, setShowAllA] = useState(false);
  const [showAllB, setShowAllB] = useState(false);

  const [dayA, setDayA] = useState<DayDetail | null>(null);
  const [dayB, setDayB] = useState<DayDetail | null>(null);
  // What the draft keeps of a chosen day; its detail is fetched from this.
  const [slugA, setSlugA] = useState("");
  const [slugB, setSlugB] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Move
  const [toTripId, setToTripId] = useState("");
  const [toDate, setToDate] = useState("");

  // Split
  const [photoCutIndex, setPhotoCutIndex] = useState(0);
  const [firstContent, setFirstContent] = useState("");
  const [secondContent, setSecondContent] = useState("");
  const [secondTitle, setSecondTitle] = useState("");
  const [secondTime, setSecondTime] = useState("");

  const [sweepRows, setSweepRows] = useState<{ what: string; consequence: string; untouched?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSlug, setResultSlug] = useState<string | null>(null);
  const [resultTripId, setResultTripId] = useState<string | null>(null);

  const { step: urlStep, go: setStep, reset } = useStep(STEPS, {
    flowId: `reshape:${username}`,
    complete: (s) =>
      s === "pickOperation"
        ? !!operation
        : s === "pickDay"
          ? !!slugA
          : s === "pickSecondDay"
            ? operation !== "merge" || !!slugB
            : s === "moveTarget"
              ? operation !== "move" || (!!toTripId && !!toDate)
              : s === "splitCut"
                ? operation !== "split" || !!secondTitle.trim()
                : true,
    draft: {
      get: () => ({ operation, slugA, slugB, toTripId, toDate, photoCutIndex, firstContent, secondContent, secondTitle, secondTime, sweepRows }),
      set: (d) => {
        const str = (v: unknown, set: (s: string) => void) => typeof v === "string" && set(v);
        if (d.operation === "move" || d.operation === "split" || d.operation === "merge") setOperation(d.operation);
        str(d.slugA, setSlugA);
        str(d.slugB, setSlugB);
        str(d.toTripId, setToTripId);
        str(d.toDate, setToDate);
        if (typeof d.photoCutIndex === "number") setPhotoCutIndex(d.photoCutIndex);
        str(d.firstContent, setFirstContent);
        str(d.secondContent, setSecondContent);
        str(d.secondTitle, setSecondTitle);
        str(d.secondTime, setSecondTime);
        if (Array.isArray(d.sweepRows)) setSweepRows(d.sweepRows as typeof sweepRows);
      },
    },
  });

  // B2141: from the hub, the flow opens on its first real step.
  const skipIntro = useSkipIntro();
  const step = urlStep === "what" && skipIntro ? "pickOperation" : urlStep;
  /** "n of 4 · <what this screen is>" — the count from `COUNTED`. */
  const stepLabel = (key: string, current: number) =>
    t(key as never, { current: String(current), total: String(COUNTED.length) });

  // A reload mid-flow: the draft named the days, their detail comes back
  // from the server (read-only, as every step before commit).
  useEffect(() => {
    if (slugA && !dayA) void fetchDay(slugA).then((d) => d && setDayA(d));
    if (slugB && !dayB) void fetchDay(slugB).then((d) => d && setDayB(d));
    // fetchDay is stable in what it does; only the slugs decide a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugA, slugB]);

  async function fetchDay(slug: string): Promise<DayDetail | null> {
    const res = await fetch(`/api/web/${encodeURIComponent(username)}/studio/reshape?slug=${encodeURIComponent(slug)}`).catch(() => null);
    if (!res?.ok) return null;
    return (await res.json()) as DayDetail;
  }

  async function chooseDayA(slug: string) {
    setLoadingDetail(true);
    const detail = await fetchDay(slug);
    setLoadingDetail(false);
    if (!detail) {
      setError(t("studio.day.reshape.notFound"));
      return;
    }
    setDayA(detail);
    setSlugA(slug);
    setError(null);
    if (operation === "move") {
      setToTripId(detail.tripId);
      setToDate(detail.date);
      setStep("moveTarget");
    } else if (operation === "split") {
      setFirstContent(detail.content);
      setSecondContent("");
      setPhotoCutIndex(detail.media.length);
      setStep("splitCut");
    } else {
      setStep("pickSecondDay");
    }
  }

  async function chooseDayB(slug: string) {
    setLoadingDetail(true);
    const detail = await fetchDay(slug);
    setLoadingDetail(false);
    if (!detail || !dayA) {
      setError(t("studio.day.reshape.notFound"));
      return;
    }
    setDayB(detail);
    setSlugB(slug);
    setError(null);
    setStep(detail.tripId !== dayA.tripId ? "mergeCrossTrip" : "preview");
  }

  /** A move reads its sweep before the preview, so the preview can show it. */
  async function toPreview() {
    if (operation === "move" && dayA) {
      setBusy(true);
      setSweepRows(await fetchSweep(dayA.tripId, dayA.slug));
      setBusy(false);
    }
    setStep("preview");
  }

  async function fetchSweep(tripId: string, slug: string) {
    const res = await fetch(
      `/api/web/${encodeURIComponent(username)}/studio/reshape?sweep=1&tripId=${encodeURIComponent(tripId)}&slug=${encodeURIComponent(slug)}`,
    ).catch(() => null);
    if (!res?.ok) return [];
    const json = (await res.json()) as { rows: { what: string; consequence: string; untouched?: boolean }[] };
    return json.rows ?? [];
  }

  const addressChanges = operation === "move" && !!dayA && toTripId !== dayA.tripId && dayA.published;
  const detailStep = operation === "move" ? "moveTarget" : operation === "split" ? "splitCut" : "pickSecondDay";

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      let body: Record<string, unknown>;
      if (operation === "move" && dayA) {
        body = { op: "move", fromTripId: dayA.tripId, slug: dayA.slug, toTripId, date: toDate };
      } else if (operation === "split" && dayA) {
        body = {
          op: "split",
          tripId: dayA.tripId,
          slug: dayA.slug,
          photoCutIndex,
          firstContent,
          secondTitle,
          secondContent,
          ...(secondTime ? { secondTime } : {}),
        };
      } else if (operation === "merge" && dayA && dayB) {
        body = { op: "merge", tripIdA: dayA.tripId, slugA: dayA.slug, tripIdB: dayB.tripId, slugB: dayB.slug };
      } else {
        return;
      }
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/studio/reshape`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { ok?: boolean; slug?: string; error?: string } | null;
      if (!res?.ok || !json?.ok) {
        setError(json?.error ?? t("studio.day.reshape.writeFailed.message"));
        setOutcome("writeFailed");
        return;
      }
      setResultSlug(json.slug ?? dayA?.slug ?? null);
      setResultTripId(operation === "move" ? toTripId : dayA?.tripId ?? null);
      setOutcome("done");
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody step={outcome ?? step}>

      {!outcome && step === "what" && (
        <WhatStep
          inStudioBar
          title={t("studio.day.reshape.title")}
          // B1900 — the flow's own <h1> above already says this.
          hideHeading
          consequence={t("studio.day.reshape.consequence")}
          cta={{ label: t("studio.day.reshape.cta"), onContinue: () => setStep("pickOperation") }}
        />
      )}

      {!outcome && step === "pickOperation" && (
        <div className="mt-4">
          <StepIndicator total={COUNTED.length} current={1} label={stepLabel("studio.day.reshape.which.stepLabel", 1)} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.day.reshape.which.heading")}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {(["move", "split", "merge"] as const).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => {
                  setOperation(op);
                  setStep("pickDay");
                }}
                className="rounded-xl border border-line-strong px-4 py-3 text-left hover:bg-surface-subtle"
              >
                <span className="block text-sm font-semibold text-ink-strong">{t(`studio.day.reshape.op.${op}.title` as never)}</span>
                <span className="mt-0.5 block text-xs text-ink-secondary">{t(`studio.day.reshape.op.${op}.hint` as never)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!outcome && (step === "pickDay" || step === "pickSecondDay") && (
        <div className="mt-4">
          {step === "pickDay" ? (
            <StepIndicator total={COUNTED.length} current={2} label={stepLabel("studio.day.reshape.pickDay.stepLabel", 2)} />
          ) : (
            <StepIndicator total={COUNTED.length} current={3} label={stepLabel("studio.day.reshape.pickSecondDay.stepLabel", 3)} />
          )}
          <h2 className="font-display text-lg font-semibold text-ink-strong">
            {t(step === "pickDay" ? "studio.day.reshape.pickDay.heading" : "studio.day.reshape.pickSecondDay.heading")}
          </h2>
          {loadingDetail && <p className="mt-2 text-sm text-ink-secondary">{t("studio.day.edit.searchLabel")}…</p>}
          {/* B1881 — one row per entry, not per day: the same fix as the
              "Change a day" picker (`EditDayFlow`), which this flow's own
              picker inherited unchanged. Several entries may share a date
              (D3); each is listed by its own title and time, grouped under
              the date, so a second entry is choosable on its own rather
              than only reachable through its day's lead entry. */}
          {(() => {
            const showAll = step === "pickDay" ? showAllA : showAllB;
            const setShowAll = step === "pickDay" ? setShowAllA : setShowAllB;
            const visible = showAll ? picker : cutEditPicker(picker);
            const hasMore = !showAll && editPickerHasMore(picker);
            return (
              <>
                {visible.map(
                  (trip) =>
                    trip.days.length > 0 && (
                      <div key={trip.tripId} className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{trip.tripTitle}</p>
                        {trip.days.map((day) => (
                          <div key={day.date} className="mt-1">
                            {day.entries.length > 1 && <p className="text-xs text-ink-secondary">{formatLongDate(day.date)}</p>}
                            <ul className="mt-1 divide-y divide-line-faint rounded-xl border border-line-strong">
                              {day.entries
                                .filter((e) => step === "pickDay" || `${trip.tripId}/${e.slug}` !== `${dayA?.tripId}/${dayA?.slug}`)
                                .map((entry) => (
                                  <li key={entry.slug}>
                                    <button
                                      type="button"
                                      onClick={() => (step === "pickDay" ? chooseDayA(entry.slug) : chooseDayB(entry.slug))}
                                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-surface-subtle"
                                    >
                                      <span className="text-ink-strong">
                                        {entry.title}
                                        {/* B2080 — a real space, not only a margin: without it the
                                            accessible name read "car park21:40". */}
                                        {entry.time && <>{" "}<span className="ml-1 text-xs text-ink-secondary">{entry.time}</span></>}
                                      </span>
                                      {day.entries.length === 1 && <span className="text-ink-secondary">{formatLongDate(day.date)}</span>}
                                    </button>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ),
                )}
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="mt-3 min-h-11 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-body hover:bg-surface-subtle"
                  >
                    {t("studio.day.picker.showMore")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {!outcome && step === "mergeCrossTrip" && dayA && dayB && (
        <div className="mt-4">
          <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
            <p className="font-semibold text-ink-strong">{t("studio.day.reshape.mergeCrossTrip.banner")}</p>
          </div>
          <div className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong text-sm">
            <div className="px-4 py-3">
              <span className="font-semibold text-ink-strong">{dayA.title}</span>{" "}
              <span className="ml-1 text-ink-secondary">{dayA.tripTitle} · {formatLongDate(dayA.date)}</span>
            </div>
            <div className="px-4 py-3">
              <span className="font-semibold text-ink-strong">{dayB.title}</span>{" "}
              <span className="ml-1 text-ink-secondary">{dayB.tripTitle} · {formatLongDate(dayB.date)}</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-body">{t("studio.day.reshape.mergeCrossTrip.explain")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                // Hands over Move, with the first day and its destination
                // trip already chosen — M6✗'s own "refusal that hands over
                // the flow which would fix it".
                setOperation("move");
                setToTripId(dayB.tripId);
                setToDate(dayA.date);
                setStep("moveTarget");
              }}
              className="min-h-11 rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
            >
              {t("studio.day.reshape.mergeCrossTrip.moveInstead", { title: dayA.title, trip: dayB.tripTitle })}
            </button>
            <button
              type="button"
              onClick={() => setStep("pickSecondDay")}
              className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
            >
              {t("studio.day.reshape.mergeCrossTrip.pickAnother")}
            </button>
          </div>
        </div>
      )}

      {!outcome && step === "moveTarget" && dayA && (
        <div className="mt-4">
          <StepIndicator total={COUNTED.length} current={3} label={stepLabel("studio.day.reshape.moveTarget.stepLabel", 3)} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.day.reshape.moveTarget.heading")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{dayA.title} · {dayA.tripTitle} · {formatLongDate(dayA.date)}</p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.day.reshape.moveTarget.tripLabel")}
            <select
              value={toTripId}
              onChange={(e) => setToTripId(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
            >
              {trips.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.title}
                </option>
              ))}
            </select>
          </label>
          <DateField
            label={t("studio.day.reshape.moveTarget.dateLabel")}
            value={toDate}
            onChange={setToDate}
            {...tripCalendar(picker, trips.find((tr) => tr.id === toTripId))}
          />
          <div className="mt-4">
            <StepPrimary
              disabled={!toTripId || !toDate}
              busy={busy}
              onClick={() => void toPreview()}
              label={t("studio.day.reshape.moveTarget.cta")}
            />
          </div>
        </div>
      )}

      {!outcome && step === "splitCut" && dayA && (
        <div className="mt-4">
          <StepIndicator total={COUNTED.length} current={3} label={stepLabel("studio.day.reshape.splitCut.stepLabel", 3)} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.day.reshape.splitCut.heading")}</h2>
          <p className="mt-1 text-sm text-ink-body">{t("studio.day.reshape.splitCut.explain")}</p>

          {dayA.media.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {dayA.media.map((item, i) => (
                  <span key={item.src} className={`relative ${i < photoCutIndex ? "" : "opacity-40"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.src} alt="" className="h-16 w-16 rounded object-cover" />
                  </span>
                ))}
              </div>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("studio.day.reshape.splitCut.photoCutLabel", { count: String(photoCutIndex), total: String(dayA.media.length) })}
                <input
                  type="range"
                  min={0}
                  max={dayA.media.length}
                  value={photoCutIndex}
                  onChange={(e) => setPhotoCutIndex(Number(e.target.value))}
                  className="mt-1 block w-full"
                />
              </label>
            </>
          )}

          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.day.reshape.splitCut.secondTitleLabel")}
            <input
              type="text"
              value={secondTitle}
              onChange={(e) => setSecondTitle(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.day.reshape.splitCut.secondTimeLabel")}
            <input
              type="time"
              value={secondTime}
              onChange={(e) => setSecondTime(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.day.reshape.splitCut.firstContentLabel")}
            <textarea
              value={firstContent}
              onChange={(e) => setFirstContent(e.target.value)}
              className="mt-1 block min-h-32 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-sm text-ink-body"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.day.reshape.splitCut.secondContentLabel")}
            <textarea
              value={secondContent}
              onChange={(e) => setSecondContent(e.target.value)}
              className="mt-1 block min-h-32 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-sm text-ink-body"
            />
          </label>

          <div className="mt-4">
            <StepPrimary
              disabled={!secondTitle.trim()}
              onClick={() => setStep("preview")}
              label={t("studio.day.reshape.splitCut.cta")}
            />
          </div>
        </div>
      )}

      {!outcome && step === "preview" && dayA && (
        <div className="mt-4">
          <StepIndicator total={COUNTED.length} current={4} label={stepLabel("studio.day.reshape.preview.stepLabel", 4)} />
          <PreviewNotice text={t("studio.skeleton.notWritten")} />

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.day.reshape.preview.now")}</p>
          <div className="mt-1 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 opacity-70">
            <p className="text-sm font-semibold text-ink-strong">{dayA.title}</p>
            <p className="text-xs text-ink-secondary">
              {formatLongDate(dayA.date)} · {dayA.tripTitle} · {tn("studio.day.preview.photoCount", dayA.media.length, { count: String(dayA.media.length) })}
            </p>
          </div>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.day.reshape.preview.after")}</p>
          {operation === "move" && (
            <div className="mt-1 rounded-xl border border-line-strong px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{dayA.title}</p>
              <p className="text-xs text-ink-secondary">
                {toDate && formatLongDate(toDate)} · {trips.find((tr) => tr.id === toTripId)?.title ?? toTripId} ·{" "}
                {tn("studio.day.preview.photoCount", dayA.media.length, { count: String(dayA.media.length) })}
              </p>
            </div>
          )}
          {operation === "split" && (
            <>
              <div className="mt-1 rounded-xl border border-line-strong px-4 py-3">
                <p className="text-sm font-semibold text-ink-strong">{dayA.title}</p>
                <p className="text-xs text-ink-secondary">
                  {formatLongDate(dayA.date)} · {tn("studio.day.preview.photoCount", photoCutIndex, { count: String(photoCutIndex) })}
                </p>
              </div>
              <div className="mt-2 rounded-xl border border-line-strong px-4 py-3">
                <p className="text-sm font-semibold text-ink-strong">{secondTitle}</p>
                <p className="text-xs text-ink-secondary">
                  {formatLongDate(dayA.date)} · {tn("studio.day.preview.photoCount", dayA.media.length - photoCutIndex, { count: String(dayA.media.length - photoCutIndex) })} · {t("studio.day.reshape.preview.newDraft")}
                </p>
              </div>
            </>
          )}
          {operation === "merge" && dayB && (
            <div className="mt-1 rounded-xl border border-line-strong px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{[dayA, dayB].sort((a, b) => a.date.localeCompare(b.date))[0].title}</p>
              <p className="text-xs text-ink-secondary">
                {tn("studio.day.preview.photoCount", dayA.media.length + dayB.media.length, { count: String(dayA.media.length + dayB.media.length) })}
              </p>
            </div>
          )}

          {operation === "move" && sweepRows.length > 0 && (
            <>
              <h2 className="mt-4 font-display text-lg font-semibold text-ink-strong">
                {tn("studio.day.reshape.sweep.heading", sweepRows.length, { count: String(sweepRows.length) })}
              </h2>
              <ul className="mt-2 divide-y divide-line-faint rounded-xl border border-line-strong">
                {sweepRows.map((row, i) => (
                  <li key={i} className="px-4 py-3">
                    <p className="text-sm font-semibold text-ink-strong">{row.what}</p>
                    <p className={`mt-0.5 text-xs ${row.untouched ? "font-semibold text-ink-strong" : "text-ink-secondary"}`}>{row.consequence}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {addressChanges ? (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStep(detailStep)}
                className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
              >
                {t("studio.day.preview.changeSomething")}
              </button>
              <StepPrimary onClick={() => setStep("addressConfirm")} label={t("studio.day.reshape.sweep.cta")} />
            </div>
          ) : (
            operation && (
              <div className="mt-4">
                <ConfirmPanel
                  label={t(`studio.day.reshape.op.${operation}.title` as never)}
                  question={t(`studio.day.reshape.confirm.${operation}.question` as never, {
                    title: dayA.title,
                    secondTitle: operation === "split" ? secondTitle : dayB?.title ?? "",
                  })}
                  confirmLabel={t(`studio.day.reshape.confirm.${operation}.button` as never)}
                  busy={busy}
                  error={error ?? undefined}
                  onConfirm={() => void commit()}
                  onCancel={() => setStep(detailStep)}
                />
              </div>
            )
          )}
        </div>
      )}

      {!outcome && step === "addressConfirm" && dayA && (
        <div className="mt-4">
          <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
            <p className="font-semibold text-ink-strong">{t("studio.day.reshape.addressConfirm.banner")}</p>
          </div>
          <div className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong text-sm">
            <div className="px-4 py-2">
              <span className="font-semibold text-ink-strong">{t("studio.day.reshape.addressConfirm.was")}</span>{" "}
              <code className="text-xs">/{username}/trips/{dayA.tripId}/day/{dayA.slug}</code>
            </div>
            <div className="px-4 py-2">
              <span className="font-semibold text-ink-strong">{t("studio.day.reshape.addressConfirm.becomes")}</span>{" "}
              <code className="text-xs">/{username}/trips/{toTripId}/day/{dayA.slug}</code>
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold text-ink-strong">{t("studio.day.reshape.addressConfirm.noRedirect")}</p>
          <ConfirmPanel
            label={t("studio.day.reshape.addressConfirm.banner")}
            question={t("studio.day.reshape.addressConfirm.question")}
            confirmLabel={t("studio.day.reshape.addressConfirm.confirm")}
            busy={busy}
            error={error ?? undefined}
            onConfirm={() => void commit()}
            onCancel={() => setStep("preview")}
          />
        </div>
      )}

      {outcome === "done" && resultSlug && (
        <DoneScreen
          username={username}
          done={t(`studio.day.reshape.done.${operation}` as never)}
          next={[
            {
              title: t("studio.day.reshape.done.dayTitle"),
              href: `/${encodeURIComponent(username)}/trips/${encodeURIComponent(resultTripId ?? "")}/day/${encodeURIComponent(resultSlug)}`,
              label: t("studio.day.done.openDay"),
            },
            {
              title: t("studio.day.reshape.done.anotherTitle"),
              href: `/${encodeURIComponent(username)}/studio/day/reshape`,
              label: t("studio.day.reshape.done.another"),
            },
          ]}
        />
      )}

      {outcome === "writeFailed" && (
        <div className="mt-4">
          <SubmitError message={error} />
          <StepPrimary onClick={() => setOutcome(null)} label={t("studio.day.writeFailed.backToCheck")} />
        </div>
      )}
    </StepBody>
  );
}
