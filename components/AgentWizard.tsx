"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import { drain, enqueue, outstanding, type QueueProgress } from "@/components/uploadQueue";
import CurrencyProvider from "@/components/CurrencyProvider";
import { useI18n } from "@/components/LocaleProvider";
import { DayCard } from "@/components/StoryPager";
import { NO_PROSE, stepFor, WIZARD_STEPS, type WizardDraft, type WizardStep } from "@/lib/helper/draft";
import type { WizardTrip } from "@/lib/helper/server";
import { weekdayNames, type TranslationKey } from "@/lib/i18n";
import { isoDate, isoTime, readExif, wallClockMs } from "@/lib/ingest/exif";
import type { CurrencyOptions } from "@/lib/rates";
import { TRACKS, type Track } from "@/lib/tracks";
import type { Day, DaySummary } from "@/lib/types";

/**
 * Writing a day from a phone, with no agent and no model — B682.
 *
 * `docs/plans/2026-09-07-web-helper-agent.md` §2 is the rule this is built to:
 * **nothing here calls a model, and nothing here invents anything.** Every
 * field that arrives filled in was measured — the date, the time, the
 * coordinates and the count come out of the photographs' own EXIF, the place
 * name comes from the coordinates through a geocoder, and the weather is
 * looked up by this server from a public archive because a day carries
 * `weather: true`. The words are typed by the person whose day it was, and
 * there is no button that offers to write them.
 *
 * ## The draft is the session
 *
 * There is no wizard state on any server. The day is created the moment the
 * trip and the date are known, and from then on the file on disk answers every
 * question about where somebody got to — see `stepFor`. Close the tab on the
 * bus and the only thing lost is which photographs had not been sent yet.
 *
 * ## Photographs go through a queue, not through this component
 *
 * `components/uploadQueue.ts` (B683) holds the files in IndexedDB and sends a
 * 2000px copy of each before any full-size original, so the day is readable
 * within seconds of the first few landing and a killed tab resumes rather than
 * starting again. The one thing this file owes that queue is the check that
 * happens *before* it starts: the journal's remaining room against what is
 * about to be sent, so nobody uploads thirty-nine photographs and then meets a
 * wall. Everything after that is a progress line the person can walk away from.
 *
 * ## What it deliberately does not do
 *
 * There is no model, no consent panel and no price label anywhere, because
 * there is nothing here to consent to and nothing to charge for — this whole
 * flow runs with every optional capability switched off and zero credits
 * spent, which is the ticket's acceptance test.
 */

type Preview = { day: Day; summary: DaySummary; dayIndex: number };

/** What the model layer is, from the browser's side — B684. `enabled: false`
 *  is the whole of "absent rather than broken": no button, no panel, no fetch,
 *  and every other step of this wizard unchanged. */
type HelperState = { enabled: boolean; consented: boolean; credits: number };

/** What came back from one write-up, held for review and saved by nobody.
 *  Keeping it beside the fields rather than in them is the point: the person's
 *  own words stay on the screen until they say otherwise. */
type Suggested = { title: string; prose: string; warnings: string[] };

/** What the picked photographs said about themselves, before anything is sent. */
type ExifFacts = {
  count: number;
  date?: string;
  from?: string;
  to?: string;
  lat?: number;
  lng?: number;
};

/** How much of a file to read looking for EXIF. The metadata sits at the front
 *  of a JPEG, a HEIC and a WebP alike; reading forty whole photographs into a
 *  phone's memory to find forty timestamps is how a browser tab dies. */
const EXIF_HEAD_BYTES = 512 * 1024;

/** The three things a trip can keep track of, said to a person. `lib/tracks.ts`
 *  owns the list; this owns the words. */
const TRACK_LABEL: Record<Track, TranslationKey> = {
  costs: "agent.missingCosts",
  coordinates: "agent.missingCoordinates",
  photos: "agent.missingPhotos",
};

const STEP_LABEL: Record<WizardStep, TranslationKey> = {
  trip: "agent.stepTrip",
  date: "agent.stepDate",
  photos: "agent.stepPhotos",
  words: "agent.stepWords",
  preview: "agent.stepPreview",
  publish: "agent.stepPublish",
};

/**
 * Read what the camera recorded off the chosen files.
 *
 * Never throws and never blocks on a file it cannot read: `readExif` returns
 * partial data for a screenshot, a forward or a scan, and a photograph with no
 * metadata simply contributes nothing. The date is the earliest frame's, which
 * is the day somebody would call it.
 */
async function factsOf(files: File[]): Promise<ExifFacts> {
  const times: { ms: number; date: string; time: string }[] = [];
  let lat: number | undefined;
  let lng: number | undefined;

  for (const file of files) {
    let data;
    try {
      const head = new Uint8Array(await file.slice(0, EXIF_HEAD_BYTES).arrayBuffer());
      data = readExif(head);
    } catch {
      continue;
    }
    if (data.takenAt) {
      times.push({
        ms: wallClockMs(data.takenAt),
        date: isoDate(data.takenAt),
        time: isoTime(data.takenAt).slice(0, 5),
      });
    }
    if (lat === undefined && data.lat !== undefined && data.lng !== undefined) {
      lat = data.lat;
      lng = data.lng;
    }
  }

  times.sort((a, b) => a.ms - b.ms);
  return {
    count: files.length,
    date: times[0]?.date,
    from: times[0]?.time,
    to: times.length > 1 ? times[times.length - 1].time : undefined,
    lat,
    lng,
  };
}

/** The trip whose dates contain this date — the wizard's only opinion about
 *  which trip a day belongs to, and it is arithmetic rather than a guess. */
function tripOn(trips: WizardTrip[], date: string): string | undefined {
  return trips.find((t) => date >= t.start && date <= t.end)?.id;
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function AgentWizard({
  username,
  trips,
  drafts,
  currency,
  helper,
}: {
  username: string;
  trips: WizardTrip[];
  /** Every unfinished day in the journal, for the resume list. */
  drafts: WizardDraft[];
  currency: CurrencyOptions;
  helper: HelperState;
}) {
  const { t, tn, formatLongDate, locale } = useI18n();

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState<WizardStep>("trip");

  const [files, setFiles] = useState<File[]>([]);
  const [facts, setFacts] = useState<ExifFacts | null>(null);
  const [reading, setReading] = useState(false);

  // Today, and the trip today falls inside — the commonest case is somebody
  // writing up the day they are having, and it should already be chosen.
  const [date, setDate] = useState<string>(todayIso());
  const [trip, setTrip] = useState<string>(tripOn(trips, todayIso()) ?? trips[0]?.id ?? "");

  const [title, setTitle] = useState("");
  const [prose, setProse] = useState("");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Track[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<Track, "none" | "unknown">>>({});
  const [asking, setAsking] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  // B684 — the model layer, and the three states it can be in: never asked,
  // asking, and holding an answer nobody has accepted yet.
  const [consented, setConsented] = useState(helper.consented);
  const [consenting, setConsenting] = useState(false);
  const [suggested, setSuggested] = useState<Suggested | null>(null);

  const base = `/api/helper/${encodeURIComponent(username)}/day`;

  /** One place where a refusal becomes something on the screen — including the
   *  422 that is not a refusal at all but the trip asking a question. */
  const send = useCallback(
    async (url: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
      setError(null);
      const response = await fetch(url, init).catch(() => null);
      if (!response) {
        setError(t("agent.failed", { error: "network" }));
        return null;
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 422 && Array.isArray(body.missing)) {
        setMissing(body.missing as Track[]);
        return null;
      }
      if (!response.ok) {
        setError(t("agent.failed", { error: String(body.error ?? response.status) }));
        return null;
      }
      setMissing([]);
      return body;
    },
    [t],
  );

  /**
   * Re-read the day from disk and adopt it.
   *
   * Every write ends here rather than patching local state from what was sent:
   * the file is what the next visit and the next device will see, so anything
   * the screen shows that the file does not is a lie waiting to be found. It
   * is also how the words come back when somebody resumes a day they had
   * already written.
   */
  const refresh = useCallback(
    async (tripId: string, slug: string) => {
      const body = await send(
        `${base}?trip=${encodeURIComponent(tripId)}&slug=${encodeURIComponent(slug)}`,
        { method: "GET" },
      );
      if (!body) return null;
      const next = body.draft as WizardDraft;
      const shown = (body.preview as Preview | null) ?? null;
      setDraft(next);
      setPreview(shown);
      if (next.written) {
        setTitle(next.title);
        setProse(shown?.day.entries.find((e) => e.slug === next.slug)?.content ?? "");
      }
      return next;
    },
    [base, send],
  );

  /** The date, and the trip that date falls inside — always together, so the
   *  select and the button can never disagree about which trip was chosen. */
  const chooseDate = useCallback(
    (chosen: string) => {
      setDate(chosen);
      const inside = tripOn(trips, chosen);
      if (inside) setTrip(inside);
    },
    [trips],
  );

  const pick = useCallback(
    async (list: FileList | null) => {
      const chosen = Array.from(list ?? []);
      if (chosen.length === 0) return;
      setReading(true);
      const read = await factsOf(chosen);
      setFiles(chosen);
      setFacts(read);
      setReading(false);
      if (read.date) chooseDate(read.date);
      return read;
    },
    [chooseDate],
  );

  /**
   * Empty the queue, refreshing the day the moment its web copies have landed.
   *
   * That refresh is what makes the two phases visible: the count on the day
   * goes right while the originals are still climbing, so a person on a bad
   * connection sees a finished day rather than a spinner. The originals carry
   * on behind whatever step they have walked on to.
   */
  const runQueue = useCallback(
    async (tripId: string, slug: string) => {
      let readable = false;
      await drain(username, (state) => {
        setProgress(state);
        if (!readable && state.webTotal > 0 && state.webDone === state.webTotal) {
          readable = true;
          void refresh(tripId, slug);
        }
      });
      await refresh(tripId, slug);
      setProgress((state) => (state && state.error ? state : null));
    },
    [refresh, username],
  );

  /**
   * The one storage check, before any of it starts — B683.
   *
   * Per file it would be thirty-nine successful uploads and a wall; asked once
   * against the whole pick it is a sentence somebody can act on while they
   * still have every photograph in front of them. `storeUploads` still refuses
   * on its own if the sums change underneath, and that is the guard; this is
   * the courtesy.
   */
  const startUploads = useCallback(
    async (tripId: string, slug: string, list: File[]) => {
      if (list.length === 0) return;
      setBusy(true);
      const room = await send(`${base}/media`, { method: "GET" });
      if (!room) {
        setBusy(false);
        return;
      }
      const needed = list.reduce((n, file) => n + file.size, 0);
      const left = room.remainingBytes as number | null;
      if (left !== null && needed > left) {
        const mb = (n: number) => String(Math.max(1, Math.round(n / (1024 * 1024))));
        setError(t("agent.noRoom", { needed: mb(needed), left: mb(left) }));
        setBusy(false);
        return;
      }

      await enqueue(username, tripId, slug, list);
      setFiles([]);
      setBusy(false);
      // Straight on to the words. The queue is on disk and does not need this
      // component to stay on the photographs step to keep going.
      setStep("words");
      void runQueue(tripId, slug);
    },
    [base, runQueue, send, t, username],
  );

  /** An upload that did not finish before the tab died, picked up on arrival.
   *  The rows carry their own trip and day, so nothing here has to know which
   *  one they belong to. */
  useEffect(() => {
    void (async () => {
      const owed = await outstanding(username).catch(() => []);
      if (owed.length === 0) return;
      await drain(username, setProgress);
    })();
  }, [username]);

  const create = useCallback(async () => {
    setBusy(true);
    const body = await send(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip,
        date,
        time: facts?.from,
        lat: facts?.lat,
        lng: facts?.lng,
        answers,
      }),
    });
    if (!body) {
      setBusy(false);
      return;
    }
    const slug = String(body.slug);
    const made = await refresh(trip, slug);
    setBusy(false);
    if (!made) return;
    if (files.length > 0) await startUploads(trip, slug, files);
    else setStep("photos");
  }, [answers, base, date, facts, files, refresh, send, startUploads, trip]);

  const save = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const body = await send(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: draft.trip, slug: draft.slug, title, content: prose }),
    });
    setBusy(false);
    if (!body) return;
    setDraft(body.draft as WizardDraft);
    setPreview((body.preview as Preview | null) ?? null);
    setStep("preview");
  }, [base, draft, prose, send, title]);

  const answer = useCallback(
    async (field: Track, said: "none" | "unknown") => {
      const next = { ...answers, [field]: said };
      setAnswers(next);
      if (!draft) return;
      setBusy(true);
      const body = await send(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: draft.trip, slug: draft.slug, answers: { [field]: said } }),
      });
      setBusy(false);
      if (!body) return;
      setDraft(body.draft as WizardDraft);
      setPreview((body.preview as Preview | null) ?? null);
    },
    [answers, base, draft, send],
  );

  /**
   * Ask the model to write the notes up, and show what it said.
   *
   * Nothing is saved here and nothing is overwritten: the answer lands in
   * `suggested`, beside the textarea rather than in it, and the person either
   * takes it or keeps what they wrote. That is the plan's rule that returned
   * prose is always read before it lands.
   */
  const writeUp = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const body = await send(`${base}/write-day`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip: draft.trip,
        date: draft.date,
        notes: prose,
        location: preview?.day.lead.location,
        country: preview?.day.lead.country,
        from: facts?.from,
        to: facts?.to,
        photos: draft.photos,
        // One key per set of notes, so a tap that times out and is tapped
        // again is answered rather than charged twice.
        idempotency_key: `${draft.trip}/${draft.slug}/${prose.length}`,
      }),
    });
    setBusy(false);
    if (!body) return;
    setSuggested(body.draft as Suggested);
  }, [base, draft, facts, preview, prose, send]);

  /** Consent, once per journal, before the first model call ever made for it. */
  const agree = useCallback(async () => {
    setBusy(true);
    const body = await send(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "POST",
    });
    setBusy(false);
    if (!body) return;
    setConsented(true);
    setConsenting(false);
    await writeUp();
  }, [send, username, writeUp]);

  /** Taking it back, from the same panel that asked. Deletes the record on the
   *  journal; the next write-up asks again. */
  const withdraw = useCallback(async () => {
    setBusy(true);
    const body = await send(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "DELETE",
    });
    setBusy(false);
    if (body) setConsented(false);
  }, [send, username]);

  const publish = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const body = await send(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: draft.trip, slug: draft.slug }),
    });
    setBusy(false);
    if (!body) return;
    setAsking(false);
    setPublishedUrl(String(body.url));
  }, [base, draft, send]);

  /** Place and weekday, which is a suggestion and not a claim: it names where
   *  the photographs say the day was and what day of the week it fell on, both
   *  of which are already on the day. The field is editable and starts empty of
   *  anything nobody measured. */
  const suggestion = useMemo(() => {
    if (!draft) return "";
    const place = preview?.day.lead.location ?? "";
    const weekday = weekdayNames(locale)[new Date(`${draft.date}T00:00:00Z`).getUTCDay()];
    return place ? `${place}, ${weekday}` : weekday;
  }, [draft, locale, preview]);

  const openDraft = useCallback(
    async (unfinished: WizardDraft) => {
      const next = await refresh(unfinished.trip, unfinished.slug);
      if (next) setStep(stepFor(next));
    },
    [refresh],
  );

  const stepIndex = WIZARD_STEPS.indexOf(step);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-[clamp(1.375rem,5vw,2rem)] font-semibold leading-tight text-navy-900">
        {t("agent.wizardTitle")}
      </h1>

      {/* Where you are, in one line. Six named steps at 390px is a wrapping
          row of chips nobody reads; the name of the step you are on and its
          number is the whole of what a person needs. */}
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-navy-600">
        {t("agent.stepOf", { n: String(stepIndex + 1) })} · {t(STEP_LABEL[step])}
      </p>

      {error && (
        <p className="mt-4 rounded-2xl border border-coral-600 bg-cream-100 p-4 text-sm leading-6 text-navy-800">
          {error}
        </p>
      )}

      {/* The queue, wherever in the wizard somebody has got to. Web copies
          first, then the originals — and the second line is the one that says
          you may walk away, because you may. */}
      {progress && (progress.webDone < progress.webTotal || progress.originalDone < progress.originalTotal) && (
        <p
          aria-live="polite"
          className="mt-4 rounded-2xl border border-navy-200 bg-cream-100 p-4 text-sm leading-6 text-navy-800"
        >
          {progress.webDone < progress.webTotal
            ? t("agent.uploading", {
                done: String(progress.webDone),
                total: String(progress.webTotal),
              })
            : t("agent.uploadingOriginals", {
                done: String(progress.originalDone),
                total: String(progress.originalTotal),
              })}
          {progress.error && ` — ${t("agent.failed", { error: progress.error })}`}
        </p>
      )}

      {missing.length > 0 && (
        <section className="mt-4 rounded-2xl border border-navy-200 bg-cream-100 p-4">
          <p className="text-sm leading-6 text-navy-800">{t("agent.missingTitle")}</p>
          <ul className="mt-3 space-y-3">
            {TRACKS.filter((field) => missing.includes(field)).map((field) => (
              <li key={field}>
                <p className="text-sm font-semibold text-navy-900">{t(TRACK_LABEL[field])}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void answer(field, "none")}
                    className="min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 disabled:opacity-50"
                  >
                    {t("agent.answerNone")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void answer(field, "unknown")}
                    className="min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 disabled:opacity-50"
                  >
                    {t("agent.answerUnknown")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {!draft && (
        <>
          {drafts.length > 0 && (
            <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
              <h2 className="font-display text-lg font-semibold text-navy-900">
                {t("agent.resumeHeading")}
              </h2>
              <ul className="mt-3 space-y-2">
                {drafts.map((unfinished) => (
                  <li key={`${unfinished.trip}/${unfinished.slug}`}>
                    <button
                      type="button"
                      onClick={() => void openDraft(unfinished)}
                      className="min-h-11 w-full rounded-xl border border-navy-200 px-4 py-2 text-left text-base text-navy-800 hover:bg-cream-100"
                    >
                      <span className="font-semibold">{formatLongDate(unfinished.date)}</span>
                      <span className="block text-sm text-navy-600">
                        {unfinished.photos > 0
                          ? tn("agent.photoCount", unfinished.photos, {
                              count: String(unfinished.photos),
                            })
                          : t("agent.noPhotosYet")}
                        {!unfinished.written && ` · ${t("agent.noWordsYet")}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
            {trips.length === 0 ? (
              <p className="text-base leading-7 text-navy-800">{t("agent.noTrips")}</p>
            ) : (
              <>
                <h2 className="font-display text-lg font-semibold text-navy-900">
                  {t("agent.pickPhotos")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.pickPhotosHint")}</p>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(event) => void pick(event.target.files)}
                  className="mt-3 block w-full text-sm text-navy-700 file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-yellow-400 file:px-5 file:text-base file:font-semibold file:text-yellow-950"
                />
                {reading && <p className="mt-2 text-sm text-navy-600">{t("agent.readingPhotos")}</p>}
                {facts && (
                  <p className="mt-2 text-sm text-navy-700">
                    {facts.from
                      ? t("agent.photosSaid", {
                          count: String(facts.count),
                          from: facts.from,
                          to: facts.to ?? facts.from,
                        })
                      : t("agent.noExif")}
                  </p>
                )}

                <h2 className="mt-6 font-display text-lg font-semibold text-navy-900">
                  {t("agent.chooseTrip")}
                </h2>
                <label className="mt-2 block text-sm font-semibold text-navy-800" htmlFor="wizard-trip">
                  {t("agent.stepTrip")}
                </label>
                <select
                  id="wizard-trip"
                  value={trip}
                  onChange={(event) => setTrip(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                >
                  {trips.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>

                <label className="mt-4 block text-sm font-semibold text-navy-800" htmlFor="wizard-date">
                  {t("agent.dateLabel")}
                </label>
                <input
                  id="wizard-date"
                  type="date"
                  value={date}
                  onChange={(event) => chooseDate(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                />

                <button
                  type="button"
                  disabled={busy || reading || date === ""}
                  onClick={() => void create()}
                  className="mt-5 min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
                >
                  {busy ? t("agent.creating") : t("agent.startDay")}
                </button>
              </>
            )}
          </section>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {draft && step === "photos" && (
        <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("agent.uploadTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-700">
            {draft.photos > 0
              ? tn("agent.onTheDay", draft.photos, { count: String(draft.photos) })
              : t("agent.noPhotosYet")}
          </p>
          <input
            type="file"
            multiple
            accept="image/*,video/*"
            disabled={busy}
            onChange={async (event) => {
              const chosen = Array.from(event.target.files ?? []);
              await pick(event.target.files);
              await startUploads(draft.trip, draft.slug, chosen);
            }}
            className="mt-3 block w-full text-sm text-navy-700 file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-cream-100 file:px-5 file:text-base file:font-semibold file:text-navy-800"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep("words")}
            className="mt-5 min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
          >
            {draft.photos > 0 ? t("agent.stepWords") : t("agent.skipPhotos")}
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {draft && step === "words" && (
        <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("agent.wordsTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.wordsHint")}</p>

          <label className="mt-4 block text-sm font-semibold text-navy-800" htmlFor="wizard-title">
            {t("agent.titleLabel")}
          </label>
          <input
            id="wizard-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
          />
          {suggestion !== "" && suggestion !== title && (
            <button
              type="button"
              onClick={() => setTitle(suggestion)}
              className="mt-2 min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800"
            >
              {t("agent.useSuggestion", { title: suggestion })}
            </button>
          )}

          <label className="mt-4 block text-sm font-semibold text-navy-800" htmlFor="wizard-prose">
            {t("agent.proseLabel")}
          </label>
          <textarea
            id="wizard-prose"
            rows={10}
            value={prose}
            onChange={(event) => setProse(event.target.value)}
            className="mt-1 w-full rounded-xl border border-navy-300 bg-white p-3 text-base leading-7 text-navy-900"
          />

          {/* B684 — the model, and the only place in this wizard where one is
              spoken to. Absent when the capability is off, which is the whole
              of the ticket's "absent rather than broken": everything above
              this block still writes a day with no credits spent. */}
          {helper.enabled && (
            <div className="mt-4 rounded-2xl border border-navy-200 bg-cream-50 p-4">
              {consenting ? (
                <ConfirmPanel
                  label={t("agent.helperConsentLabel")}
                  question={t("agent.helperConsent")}
                  confirmLabel={t("agent.helperConsentConfirm")}
                  busy={busy}
                  onConfirm={() => void agree()}
                  onCancel={() => setConsenting(false)}
                />
              ) : suggested ? (
                <>
                  <p className="text-sm font-semibold text-navy-900">
                    {t("agent.helperSuggestionTitle")}
                  </p>
                  {suggested.title !== "" && (
                    <p className="mt-2 text-base font-semibold text-navy-900">{suggested.title}</p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-navy-800">
                    {suggested.prose}
                  </p>
                  {suggested.warnings.length > 0 && (
                    <div className="mt-3 rounded-xl border border-navy-200 bg-white p-3">
                      <p className="text-sm font-semibold text-navy-900">
                        {t("agent.helperWarnings")}
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-navy-700">
                        {suggested.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (suggested.title !== "") setTitle(suggested.title);
                        setProse(suggested.prose);
                        setSuggested(null);
                      }}
                      className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950"
                    >
                      {t("agent.helperUse")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggested(null)}
                      className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800"
                    >
                      {t("agent.helperDiscard")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-navy-700">{t("agent.helperHint")}</p>
                  <button
                    type="button"
                    disabled={busy || prose.trim() === "" || prose.trim() === NO_PROSE}
                    onClick={() => (consented ? void writeUp() : setConsenting(true))}
                    className="mt-3 min-h-11 w-full rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800 disabled:opacity-50"
                  >
                    {/* The price is on the button, before the tap. */}
                    {busy
                      ? t("agent.helperWorking")
                      : t("agent.helperWrite", { credits: String(helper.credits) })}
                  </button>
                  {consented && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withdraw()}
                      className="mt-2 min-h-11 text-sm font-semibold text-navy-600 underline disabled:opacity-50"
                    >
                      {t("agent.helperWithdraw")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={busy || title.trim() === "" || prose.trim() === "" || prose.trim() === NO_PROSE}
            onClick={() => void save()}
            className="mt-5 min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
          >
            {busy ? t("agent.saving") : t("agent.save")}
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {draft && (step === "preview" || step === "publish") && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("agent.previewTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.previewHint")}</p>

          {/* Not once `publishedUrl` is set — B711. `preview.day` is read once,
              before publishing, and carries `draft: true` on every entry; the
              card below it would keep showing `DraftNotice` even though the
              outcome panel already says the day is on the site. Re-fetching
              the day just to redraw a card the outcome panel is about to
              replace is work for a picture that is off the screen in a
              moment; dropping it is the whole fix. */}
          {preview && !publishedUrl && (
            <div className="mt-4">
              {/* The real card, with the real props — not a lookalike. What is
                  wrong here is wrong on the site. */}
              <CurrencyProvider options={currency}>
                <DayCard day={preview.day} summary={preview.summary} dayIndex={preview.dayIndex} />
              </CurrencyProvider>
            </div>
          )}

          {publishedUrl ? (
            <div className="mt-5 rounded-2xl border border-navy-200 bg-white p-4">
              <p className="text-base text-navy-800">{t("agent.published")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={publishedUrl}
                  className="min-h-11 rounded-full bg-yellow-400 px-5 py-2.5 text-base font-semibold text-yellow-950"
                >
                  {t("agent.viewDay")}
                </Link>
                <Link
                  href={`/agent/${encodeURIComponent(username)}`}
                  className="min-h-11 rounded-full border border-navy-300 px-5 py-2.5 text-base font-semibold text-navy-800"
                >
                  {t("agent.writeAnother")}
                </Link>
              </div>
            </div>
          ) : asking ? (
            <div className="mt-5">
              {/* Never `window.confirm` — B633, B668. The question has to be
                  able to say what publishing actually does, and one OS string
                  cannot. */}
              <ConfirmPanel
                label={t("agent.publish")}
                question={t("agent.publishQuestion")}
                confirmLabel={t("agent.publishConfirm")}
                busyLabel={t("agent.publishing")}
                busy={busy}
                onConfirm={() => void publish()}
                onCancel={() => setAsking(false)}
              />
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStep("words")}
                className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800"
              >
                {t("agent.backToWords")}
              </button>
              <button
                type="button"
                disabled={!draft.written}
                onClick={() => setAsking(true)}
                className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
              >
                {t("agent.publish")}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
