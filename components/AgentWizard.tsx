"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import {
  drain,
  enqueue,
  outstanding,
  uploadingDaySlug,
  type QueueProgress,
} from "@/components/uploadQueue";
import CurrencyProvider from "@/components/CurrencyProvider";
import { useI18n } from "@/components/LocaleProvider";
import Why from "@/components/Why";
import RecordButton from "@/components/RecordButton";
import { DayCard } from "@/components/StoryPager";
import { creditsForPhotos } from "@/lib/helper/credits";
import {
  backFrom,
  NO_PROSE,
  stepFor,
  WIZARD_STEPS,
  type WizardDraft,
  type WizardStep,
} from "@/lib/helper/draft";
import type { TripGap, WizardTrip } from "@/lib/helper/server";
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
type HelperState = {
  enabled: boolean;
  consented: boolean;
  /** B686 — the transcriber is its own capability and its own consent, so a
   *  journal may have speech with no model or a model with no speech. */
  speech: boolean;
  consentedSpeech: boolean;
  /** Who a recording actually goes to — B744. Read on the server
   *  (`speechProvider()`), since the wizard has no config to read it from. */
  speechProvider: string;
  /** Whether the journal has separately agreed to photographs leaving the
   *  machine — B687. Never inferred from `consented` above. */
  consentedPhotos: boolean;
  credits: number;
};

/** What came back from one write-up, held for review and saved by nobody.
 *  Keeping it beside the fields rather than in them is the point: the person's
 *  own words stay on the screen until they say otherwise. */
type Suggested = { title: string; prose: string; warnings: string[] };

/** One photograph's suggested caption — B687. Keyed by `src` so it lines up
 *  with `EditInput.captions` when a person keeps it. */
type PhotoCaption = { src: string; caption: string };

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

/** Where a way back leads, said as a place rather than as an arrow — B769.
 *  Only the three steps `backFrom` can return. */
const BACK_LABEL: Record<"trip" | "photos" | "words", TranslationKey> = {
  trip: "agent.backToStart",
  photos: "agent.backToPhotos",
  words: "agent.backToWords",
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

/**
 * What the picker will let somebody choose — B791.
 *
 * `image/*,video/*` was the whole of it, and it refused every file B689's
 * inbox screen was built to read: a bank statement, a Google Timeline export,
 * a GPX track. The route behind it has filed those into the inbox since it was
 * written (`kindForExtension`, then `storeInboxFile`) — the server could take
 * them and the picker would not offer them, so a whole shipped feature was
 * reachable only with an API token.
 *
 * The extensions mirror `INBOX_FILE_EXTENSIONS` in `lib/inbox.ts`, which is
 * server-only (it reads the filesystem) and cannot be imported into a client
 * component; `test/agent-picker-accepts.test.ts` is what keeps the two lists
 * from drifting. A wrong guess is not a refusal either way — the route decides
 * — but a missing extension is a file a phone will grey out.
 */
export const PICKER_ACCEPT = "image/*,video/*,.csv,.pdf,.json,.txt,.gpx,.md";

/**
 * A file picker whose words are ours — B768.
 *
 * `<input type="file">` draws its own button and its own "No file chosen" in
 * the *browser's* locale, from strings no CSS and no attribute can reach. So
 * the input is still the control — still focusable, still in the accessibility
 * tree, `sr-only` being the clipped-rect technique rather than `display: none`
 * — and a `<label>` in front of it carries our text. Clicking a label opens
 * the picker because that is what a label does; `peer-focus-visible` puts the
 * focus ring on the label when the input behind it has focus, which is the one
 * thing hiding an input otherwise costs.
 *
 * The count replaces "No file chosen" and is better than it anyway: the
 * browser names one file and says nothing about twelve.
 */
function PhotoPicker({
  id,
  count,
  disabled,
  onPick,
}: {
  id: string;
  /** How many files are chosen right now — 0 says so in words. */
  count: number;
  disabled?: boolean;
  onPick: (files: FileList | null) => void;
}) {
  const { t, tn } = useI18n();
  return (
    <div className="mt-3">
      <input
        id={id}
        type="file"
        multiple
        accept={PICKER_ACCEPT}
        disabled={disabled}
        onChange={(event) => onPick(event.target.files)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        // Quiet on both screens: the bright thing on a step is the one that
        // moves a person on from it, and there is only ever one — B767.
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-navy-300 bg-cream-100 px-5 text-base font-semibold text-navy-800 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 peer-disabled:opacity-50"
      >
        {t("agent.chooseFiles")}
      </label>
      <p className="mt-2 text-sm text-navy-700">
        {count === 0 ? t("agent.noneChosen") : tn("agent.chosenCount", count, { count: String(count) })}
      </p>
      {/* What may be dropped here, since it is no longer only photographs —
          B791. The route sorts them; this stops the screen lying about what
          is welcome. */}
      <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.pickAnyFile")}</p>
    </div>
  );
}

/** What the link that opened the wizard asked for — B818, B816. */
type OpenAt = { date?: string; trip?: string; slug?: string };

/**
 * The day this wizard is most likely about — B818.
 *
 * It was `todayIso()` unconditionally, which is right for somebody writing up
 * the day they are having and wrong for everybody else: a person tidying up
 * three weeks later, arriving from a link that says "Finish Wednesday, 19
 * August", was offered today and filled the form on autopilot. So: the date
 * the link names, then today when today is inside a trip that is running, and
 * otherwise the oldest day of the last trip nobody ever wrote.
 */
function openingDate(open: OpenAt | undefined, trips: WizardTrip[], gaps: TripGap | null): string {
  const today = todayIso();
  if (open?.date) return open.date;
  if (tripOn(trips, today)) return today;
  return gaps?.missing[0] ?? today;
}

export default function AgentWizard({
  username,
  trips,
  drafts,
  currency,
  helper,
  open,
  gaps = null,
}: {
  username: string;
  trips: WizardTrip[];
  /** Every unfinished day in the journal, for the resume list. */
  drafts: WizardDraft[];
  currency: CurrencyOptions;
  helper: HelperState;
  /** What the opening link named, if it named anything — B818. */
  open?: OpenAt;
  /** The days of a finished trip nobody started — B819. Usually `null`. */
  gaps?: TripGap | null;
}) {
  const { t, tn, formatLongDate, locale } = useI18n();

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  /**
   * The ordinary day, unasked — B780.
   *
   * Nine taps was the count on the live site for one ordinary day, and the
   * person this was built for gives up around three. The steps were not wrong;
   * what was wrong is that the common case paid for all of them. Most days
   * are: today, the trip that is already running, and the words — and the
   * first two of those are facts the software already holds. **The express
   * path skips only questions it can already answer**, which is why the test
   * for it is arithmetic: today falls inside exactly one trip, and nothing is
   * half-written and waiting to be resumed. Anything else — two trips
   * overlapping, no trip running, a draft to pick up — and the long path is
   * what opens, unchanged.
   *
   * What it does not skip: the preview, and the confirmation before
   * publishing. Those are not questions the software can answer.
   *
   * Read once, at mount, rather than on every render: `date` below is
   * initialised the same way and for the same reason.
   */
  const [express] = useState(
    () =>
      // A link that named a day or a day's slug has already answered the two
      // questions the express path guesses at — B818. Obeying it beats
      // guessing, so the long path opens and the link's own day is in the box.
      !open?.date &&
      !open?.slug &&
      drafts.length === 0 &&
      trips.filter((t) => todayIso() >= t.start && todayIso() <= t.end).length === 1,
  );
  /** Set the moment somebody takes the long way round from the express screen
   *  — from then on this session is the ordinary six steps. */
  const [long, setLong] = useState(false);
  const quick = express && !long;

  const [step, setStep] = useState<WizardStep>(express ? "words" : "trip");

  const [files, setFiles] = useState<File[]>([]);
  const [facts, setFacts] = useState<ExifFacts | null>(null);
  const [reading, setReading] = useState(false);

  // The day this is most likely about (B818), and the trip it falls inside.
  const [date, setDate] = useState<string>(() => openingDate(open, trips, gaps));
  const [trip, setTrip] = useState<string>(
    () => open?.trip ?? tripOn(trips, openingDate(open, trips, gaps)) ?? trips[0]?.id ?? "",
  );

  /** On the express path the title starts as the weekday — B780. It is the
   *  same string `suggestion` below already offers for a day with no place
   *  known yet, and it is measured rather than invented: it is the day being
   *  written up. Prefilled rather than proposed because an empty required
   *  field between a person and their own words is the tap this ticket is
   *  about; it is an ordinary editable box and anybody may overwrite it. */
  const [title, setTitle] = useState(() =>
    express ? weekdayNames(locale)[new Date(`${todayIso()}T00:00:00Z`).getUTCDay()] : "",
  );
  const [prose, setProse] = useState("");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Track[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<Track, "none" | "unknown">>>({});
  const [asking, setAsking] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  // B816 — taking a published day back off the site, and the line that says it
  // happened. Never a delete: the day stays on disk as a draft.
  const [takingDown, setTakingDown] = useState(false);
  const [tookDown, setTookDown] = useState(false);

  /**
   * Whether the gap line has been waved away — B819.
   *
   * Kept in the browser rather than in the journal: it is a preference about
   * a screen, not a fact about a trip, and a trip that gains a day stops
   * being a gap on its own.
   *
   * Shown first and hidden by the effect, rather than the other way round.
   * There is no `localStorage` on the server, so starting hidden would mean
   * the line arrives one render late for everybody — and the mismatch would
   * be with the person who has *not* dismissed it, which is nearly everybody.
   * This way the only cost is one sentence flickering past somebody who has
   * already said they do not want it.
   */
  const [gapsHidden, setGapsHidden] = useState(false);
  const gapKey = gaps ? `fernscout.gaps.${username}.${gaps.trip}` : null;
  useEffect(() => {
    if (!gapKey) return;
    try {
      // Reading a browser store is the "synchronise with an external system"
      // case the rule exempts in prose but cannot detect — the same disable
      // sits on `Landing`, which reads a flag out of `localStorage` the same
      // way and for the same reason.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(gapKey) === "hidden") setGapsHidden(true);
    } catch {
      // A browser that refuses storage gets the line; it is one sentence.
    }
  }, [gapKey]);

  // B684 — the model layer, and the three states it can be in: never asked,
  // asking, and holding an answer nobody has accepted yet.
  const [consented, setConsented] = useState(helper.consented);
  const [consenting, setConsenting] = useState(false);
  const [suggested, setSuggested] = useState<Suggested | null>(null);

  // B687 — a separate consent and a separate answer, because sending
  // photographs is a bigger promise than sending typed words and one consent
  // must not silently cover the other.
  const [consentedPhotos, setConsentedPhotos] = useState(helper.consentedPhotos);
  const [consentingPhotos, setConsentingPhotos] = useState(false);
  const [captions, setCaptions] = useState<PhotoCaption[] | null>(null);

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

  /**
   * The day on disk, made if it is not there yet.
   *
   * The long path creates it on the trip-and-date screen, which is where the
   * two facts become known. The express path (B780) knows them at mount and
   * asks nothing, so the day is created by the first thing a person actually
   * does — saving words, or picking photographs — rather than by their arrival
   * on the page. That matters: opening `/agent/<user>` and walking away must
   * not leave an empty draft behind.
   *
   * `on` is what the photographs said about themselves, when they said
   * something. It is passed rather than read from state because `chooseDate`
   * has only just been called and this closure still holds the old date.
   */
  const ensureDraft = useCallback(
    async (on?: { date: string; trip: string }): Promise<WizardDraft | null> => {
      if (draft) return draft;
      const onTrip = on?.trip ?? trip;
      const body = await send(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trip: onTrip,
          date: on?.date ?? date,
          time: facts?.from,
          lat: facts?.lat,
          lng: facts?.lng,
          answers,
        }),
      });
      if (!body) return null;
      return await refresh(onTrip, String(body.slug));
    },
    [answers, base, date, draft, facts, refresh, send, trip],
  );

  const create = useCallback(async () => {
    setBusy(true);
    const made = await ensureDraft();
    setBusy(false);
    if (!made) return;
    if (files.length > 0) await startUploads(made.trip, made.slug, files);
    else setStep("photos");
  }, [ensureDraft, files, startUploads]);

  const save = useCallback(async () => {
    setBusy(true);
    // On the express path this is where the day is first written down.
    const day = await ensureDraft();
    if (!day) {
      setBusy(false);
      return;
    }
    const body = await send(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: day.trip, slug: day.slug, title, content: prose }),
    });
    setBusy(false);
    if (!body) return;
    setDraft(body.draft as WizardDraft);
    setPreview((body.preview as Preview | null) ?? null);
    setStep("preview");
  }, [base, ensureDraft, prose, send, title]);

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
    setBusy(true);
    // The express path reaches this button before the day exists (B780), so
    // the day is written down first rather than the tap doing nothing.
    const day = await ensureDraft();
    if (!day) {
      setBusy(false);
      return;
    }
    const body = await send(`${base}/write-day`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip: day.trip,
        date: day.date,
        notes: prose,
        location: preview?.day.lead.location,
        country: preview?.day.lead.country,
        from: facts?.from,
        to: facts?.to,
        photos: day.photos,
        // One key per set of notes, so a tap that times out and is tapped
        // again is answered rather than charged twice.
        idempotency_key: `${day.trip}/${day.slug}/${prose.length}`,
      }),
    });
    setBusy(false);
    if (!body) return;
    setSuggested(body.draft as Suggested);
  }, [base, ensureDraft, facts, preview, prose, send]);

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

  /** Taking it back, one scope at a time — B735. Only the scope asked about
   *  is removed; the other consent, if there is one, stands. */
  const withdraw = useCallback(
    async (scope: "words" | "photos") => {
      setBusy(true);
      const body = await send(`/api/helper/${encodeURIComponent(username)}/consent`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      setBusy(false);
      if (!body) return;
      if (scope === "words") setConsented(false);
      else setConsentedPhotos(false);
    },
    [send, username],
  );

  /**
   * Ask the model to caption the photographs already on this day.
   *
   * Nothing is saved here either: the answer lands in `captions`, one row per
   * photograph, and a person keeps or edits each one through the ordinary
   * caption field — nothing is written to the gallery by this call.
   */
  const describePhotosUp = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const body = await send(`${base}/describe-photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip: draft.trip,
        slug: draft.slug,
        // One key per photo count, so a retried tap is answered rather than
        // charged twice; a photograph added afterwards is a new count and a
        // deliberately new call.
        idempotency_key: `${draft.trip}/${draft.slug}/describe/${draft.photos}`,
      }),
    });
    setBusy(false);
    if (!body) return;
    setCaptions(body.captions as PhotoCaption[]);
  }, [base, draft, send]);

  /** Consent to photographs specifically, separate from the words consent
   *  above — B687. */
  const agreePhotos = useCallback(async () => {
    setBusy(true);
    const body = await send(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "photos" }),
    });
    setBusy(false);
    if (!body) return;
    setConsentedPhotos(true);
    setConsentingPhotos(false);
    await describePhotosUp();
  }, [describePhotosUp, send, username]);

  /** Keep one caption on the photograph it belongs to — the same `PATCH` the
   *  words step uses to save prose, applied here to one gallery item. */
  const keepCaption = useCallback(
    async (row: PhotoCaption) => {
      if (!draft) return;
      setBusy(true);
      const body = await send(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: draft.trip, slug: draft.slug, captions: { [row.src]: row.caption } }),
      });
      setBusy(false);
      if (!body) return;
      setPreview((body.preview as Preview | null) ?? null);
      setCaptions((prior) => prior?.filter((c) => c.src !== row.src) ?? null);
    },
    [base, draft, send],
  );

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

  /**
   * Take the day back off the site — B816.
   *
   * The undo is the publish button, which comes back the moment this returns:
   * the day is a draft again, on disk, with every photograph still attached.
   * Nothing here deletes anything, and nothing here should learn how.
   */
  const takeDown = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    const body = await send(`${base}/unpublish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: draft.trip, slug: draft.slug }),
    });
    setBusy(false);
    if (!body) return;
    setTakingDown(false);
    setTookDown(true);
    setDraft(body.draft as WizardDraft);
    setPreview((body.preview as Preview | null) ?? null);
  }, [base, draft, send]);

  /**
   * The day the opening link named, loaded on arrival — B818, B816.
   *
   * A draft opens where `stepFor` puts it. A day already on the site opens on
   * the words, because somebody who followed "correct this day" came to change
   * something and not to be walked through six steps again.
   */
  const opened = useRef(false);
  useEffect(() => {
    const trip = open?.trip;
    const slug = open?.slug;
    if (opened.current || !trip || !slug) return;
    opened.current = true;
    void (async () => {
      const next = await refresh(trip, slug);
      if (next) setStep(next.published ? "words" : stepFor(next));
    })();
  }, [open, refresh]);

  /** Place and weekday, which is a suggestion and not a claim: it names where
   *  the photographs say the day was and what day of the week it fell on, both
   *  of which are already on the day. The field is editable and starts empty of
   *  anything nobody measured. */
  const suggestion = useMemo(() => {
    const on = draft?.date ?? date;
    if (on === "") return "";
    const place = preview?.day.lead.location ?? "";
    const weekday = weekdayNames(locale)[new Date(`${on}T00:00:00Z`).getUTCDay()];
    return place ? `${place}, ${weekday}` : weekday;
  }, [date, draft, locale, preview]);

  const openDraft = useCallback(
    async (unfinished: WizardDraft) => {
      const next = await refresh(unfinished.trip, unfinished.slug);
      if (next) setStep(stepFor(next));
    },
    [refresh],
  );

  const stepIndex = WIZARD_STEPS.indexOf(step);

  /**
   * Focus follows the step — B795.
   *
   * Every advance here (`create`, `save`, `publish`, and going back) is a
   * `setStep` that swaps the whole `<section>` for another. The button that
   * was pressed stops existing, focus falls to `<body>`, and a screen reader
   * says nothing at all — so the flow reads as a button that did nothing, six
   * times over. Moving focus to the new screen's heading is what makes the
   * transition audible, and it carries the step counter with it rather than
   * needing a second live region competing for the same moment.
   *
   * One ref for all four screens, because exactly one of them is mounted at a
   * time. Not on the first render: arriving at a page should leave focus at
   * the top of the document, where the browser put it.
   */
  const heading = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) heading.current?.focus();
    arrived.current = true;
  }, [step]);

  /**
   * A way back — B769.
   *
   * It costs nothing because there is nothing to unwind: `stepFor` derives the
   * step from the draft on disk, so going back is showing an earlier screen
   * and never an edit. The day stays exactly as it is, and photographs already
   * in the queue keep climbing behind whichever screen is on top — the
   * progress line above follows the person rather than the step.
   *
   * It names where it goes, because somebody who is not sure they pressed the
   * right thing is not helped by an arrow. It is absent rather than disabled
   * on the first screen and on the published day, which is an ending.
   */
  const back =
    draft && !publishedUrl && !asking && !takingDown && !(quick && step === "words")
      ? backFrom(step)
      : null;

  /** Back to the trip and the date is the one that lets go of the draft. The
   *  day already created stays on disk — it is in the unfinished list above
   *  and can be picked up or left; nothing here deletes anybody's day. */
  function goBack(to: WizardStep) {
    if (to === "trip") {
      setDraft(null);
      setPreview(null);
      // From here on this session is the long path: somebody who has asked to
      // choose the trip is not helped by the screen deciding again for them.
      setLong(true);
    }
    setStep(to);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-[clamp(1.375rem,5vw,2rem)] font-semibold leading-tight text-navy-900">
        {t("agent.wizardTitle")}
      </h1>

      {/* Where you are, in one line. Six named steps at 390px is a wrapping
          row of chips nobody reads; the name of the step you are on and its
          number is the whole of what a person needs.

          Absent on the express path — B780. "Step 4 of 6" on a flow that is
          three is not orientation, it is a person wondering what they missed;
          the line below, which says which trip and which day this is going to,
          is the honest answer to the same question. It comes back the moment
          somebody takes the long way round. */}
      {!quick && (
        <p className="mt-2 text-sm text-navy-600">
          {t("agent.stepOf", { n: String(stepIndex + 1) })} · {t(STEP_LABEL[step])}
        </p>
      )}

      {/* B796 — `role="alert"`, the same one `SignupWizard` has always had. A
          bad trip, a full disk, a dead network: every one of them was silent
          here. */}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-coral-600 bg-cream-100 p-4 text-sm leading-6 text-navy-800"
        >
          {error}
        </p>
      )}

      {/* The queue, wherever in the wizard somebody has got to. Web copies
          first, then the originals — and the second line is the one that says
          you may walk away, because you may. A queue row is keyed to the day
          it was picked for, so once somebody has walked on to a different
          draft the line has to say whose originals are still climbing
          (B721). */}
      {progress && (progress.webDone < progress.webTotal || progress.originalDone < progress.originalTotal) && (
        <p
          aria-live="polite"
          className="mt-4 rounded-2xl border border-navy-200 bg-cream-100 p-4 text-sm leading-6 text-navy-800"
        >
          {(() => {
            const namedDay = uploadingDaySlug(progress, draft?.slug);
            return namedDay && `${t("agent.uploadingFor", { date: namedDay })} `;
          })()}
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
          <h2 className="text-sm font-semibold leading-6 text-navy-800">{t("agent.missingTitle")}</h2>
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
      {!draft && step === "trip" && (
        <>
          {/* B819 — the days of a finished trip nobody ever started. Said
              once, quietly, and dismissed for good: a trip where somebody
              deliberately wrote three days of fourteen is not a to-do list
              with eleven failures on it. Each date fills the form below in
              one tap rather than being a second screen. */}
          {gaps && !gapsHidden && (
            <section className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-4 sm:p-5">
              <p className="text-sm leading-6 text-navy-800">
                {tn("agent.gapsBody", gaps.missing.length, {
                  trip: gaps.title,
                  total: String(gaps.total),
                  count: String(gaps.missing.length),
                })}
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {gaps.missing.slice(0, 6).map((day) => (
                  <li key={day}>
                    <button
                      type="button"
                      onClick={() => {
                        chooseDate(day);
                        setTrip(gaps.trip);
                      }}
                      className="min-h-11 rounded-full border border-navy-300 bg-white px-4 text-sm font-semibold text-navy-800"
                    >
                      {formatLongDate(day)}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setGapsHidden(true);
                  try {
                    if (gapKey) window.localStorage.setItem(gapKey, "hidden");
                  } catch {
                    // Nothing to do: it is hidden for this visit either way.
                  }
                }}
                className="mt-3 min-h-11 text-sm font-semibold text-navy-600 underline"
              >
                {t("agent.gapsDismiss")}
              </button>
            </section>
          )}

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
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="font-display text-lg font-semibold text-navy-900 focus:outline-none"
                >
                  {t("agent.pickPhotos")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.pickPhotosHint")}</p>
                {/* B781 — the rest of what this paragraph promised, behind
                    "why?" rather than in front of the picker. */}
                <Why>{t("agent.pickPhotosWhy")}</Why>
                <PhotoPicker
                  id="wizard-pick"
                  count={files.length}
                  onPick={(list) => void pick(list)}
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
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-display text-lg font-semibold text-navy-900 focus:outline-none"
          >
            {t("agent.uploadTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-700">
            {draft.photos > 0
              ? tn("agent.onTheDay", draft.photos, { count: String(draft.photos) })
              : t("agent.noPhotosYet")}
          </p>
          <PhotoPicker
            id="wizard-add"
            count={files.length}
            disabled={busy}
            onPick={async (list) => {
              const chosen = Array.from(list ?? []);
              await pick(list);
              await startUploads(draft.trip, draft.slug, chosen);
            }}
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
      {(draft || quick) && step === "words" && (
        <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-display text-lg font-semibold text-navy-900 focus:outline-none"
          >
            {t("agent.wordsTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.wordsHint")}</p>

          {/* B816 — said before the button, not after it. Correcting a day
              that is already on the site is not publishing and cannot become
              publishing (`PATCH` has no `status`), but it does change what
              people can already read, and a person is owed that sentence
              while they still have the option of not pressing save. */}
          {draft?.published && (
            <p
              role="note"
              className="mt-3 rounded-xl border border-coral-600 bg-cream-100 px-4 py-3 text-sm leading-6 text-navy-900"
            >
              {t("agent.editingLive")}
            </p>
          )}

          {/* B780 — the two questions the express path did not ask, answered
              out loud, with the way to change either of them. Quiet, because
              it is almost always right; present, because "almost" is not
              "always" and a day written into the wrong trip is a person's
              afternoon. */}
          {quick && (
            <p className="mt-3 text-sm leading-6 text-navy-700">
              {t("agent.goingTo", {
                trip: trips.find((option) => option.id === (draft?.trip ?? trip))?.title ?? "",
                date: formatLongDate(draft?.date ?? date),
              })}{" "}
              <button
                type="button"
                onClick={() => goBack("trip")}
                className="min-h-11 font-semibold text-navy-800 underline underline-offset-4"
              >
                {t("agent.change")}
              </button>
            </p>
          )}

          {/* Photographs, on the express path, are something you may add
              rather than a step you must pass — B780. The same picker and the
              same queue; it simply does not stand between anybody and the
              words. */}
          {quick && (
            <PhotoPicker
              id="wizard-quick-pick"
              count={files.length}
              disabled={busy}
              onPick={async (list) => {
                const chosen = Array.from(list ?? []);
                const read = await pick(list);
                const day = await ensureDraft(
                  read?.date ? { date: read.date, trip: tripOn(trips, read.date) ?? trip } : undefined,
                );
                if (day) await startUploads(day.trip, day.slug, chosen);
              }}
            />
          )}

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

          {/* B686 — talking instead of typing, and it lands in the same box
              the typing does. Its own capability: speech works with the model
              switched off, and the model works with no microphone. */}
          {helper.speech && (
            <RecordButton
              username={username}
              consented={helper.consentedSpeech}
              provider={helper.speechProvider}
              disabled={busy}
              onText={(said) =>
                // Appended, never replacing: somebody who has already written
                // half a day and then says the rest keeps both halves.
                setProse((was) => (was.trim() === "" || was.trim() === NO_PROSE ? said : `${was}\n\n${said}`))
              }
            />
          )}

          {/* B684 — the model, and the only place in this wizard where one is
              spoken to. Absent when the capability is off, which is the whole
              of the ticket's "absent rather than broken": everything above
              this block still writes a day with no credits spent. */}
          {/* B796 — a polite live region, and it is the container rather than
              the answer, because a region that mounts together with its own
              content is not announced at all. Present from the first render,
              so what the model sends back is spoken when it arrives — the
              moment it matters most, the person having waited and paid a
              credit for it. The captions block below is the same. */}
          {helper.enabled && (
            <div
              aria-live="polite"
              className="mt-4 rounded-2xl border border-navy-200 bg-cream-50 p-4"
            >
              {consenting ? (
                <ConfirmPanel
                  label={t("agent.helperConsentLabel")}
                  question={t("agent.helperConsentShort")}
                  details={t("agent.helperConsent")}
                  confirmLabel={t("agent.helperConsentConfirm")}
                  busy={busy}
                  onConfirm={() => void agree()}
                  onCancel={() => setConsenting(false)}
                />
              ) : suggested ? (
                <>
                  <h3 className="text-sm font-semibold text-navy-900">
                    {t("agent.helperSuggestionTitle")}
                  </h3>
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
                      onClick={() => void withdraw("words")}
                      className="mt-2 min-h-11 text-sm font-semibold text-navy-600 underline disabled:opacity-50"
                    >
                      {t("agent.helperWithdraw")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* B687 — vision, on demand, never on upload. Absent with no
              photographs on the day, and with the capability off. */}
          {helper.enabled && draft && draft.photos > 0 && (
            <div
              aria-live="polite"
              className="mt-4 rounded-2xl border border-navy-200 bg-cream-50 p-4"
            >
              {consentingPhotos ? (
                <ConfirmPanel
                  label={t("agent.photoConsentLabel")}
                  question={t("agent.photoConsentShort")}
                  details={t("agent.photoConsent")}
                  confirmLabel={t("agent.photoConsentConfirm")}
                  busy={busy}
                  onConfirm={() => void agreePhotos()}
                  onCancel={() => setConsentingPhotos(false)}
                />
              ) : captions && captions.length > 0 ? (
                <>
                  <h3 className="text-sm font-semibold text-navy-900">{t("agent.captionsTitle")}</h3>
                  <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.captionsHint")}</p>
                  <ul className="mt-3 space-y-3">
                    {captions.map((row) => (
                      <li key={row.src} className="rounded-xl border border-navy-200 bg-white p-3">
                        <p className="text-sm leading-6 text-navy-800">
                          {row.caption === "" ? t("agent.captionEmpty") : row.caption}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void keepCaption(row)}
                            className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 disabled:opacity-50"
                          >
                            {t("agent.helperUse")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setCaptions((prior) => prior?.filter((c) => c.src !== row.src) ?? null)}
                            className="min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 disabled:opacity-50"
                          >
                            {t("agent.helperDiscard")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-navy-700">{t("agent.describePhotosHint")}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (consentedPhotos ? void describePhotosUp() : setConsentingPhotos(true))}
                    className="mt-3 min-h-11 w-full rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800 disabled:opacity-50"
                  >
                    {/* The price is on the button, before the tap — computed
                        from the photographs actually on the day. */}
                    {busy
                      ? t("agent.helperWorking")
                      : t("agent.describePhotos", { credits: String(creditsForPhotos(draft.photos)) })}
                  </button>
                  {consentedPhotos && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withdraw("photos")}
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
            {busy ? t("agent.saving") : t(draft?.published ? "agent.saveChange" : "agent.save")}
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {draft && (step === "preview" || step === "publish") && (
        <section className="mt-6">
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-display text-lg font-semibold text-navy-900 focus:outline-none"
          >
            {t("agent.previewTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-navy-600">
            {t(draft.published ? "agent.previewHintLive" : "agent.previewHint")}
          </p>

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
          ) : takingDown ? (
            <div className="mt-5">
              {/* B816, and the same rule as publishing: the question has to be
                  able to say that this is reversible and that nothing is
                  deleted, which one OS dialog string cannot. */}
              <ConfirmPanel
                label={t("agent.takeDown")}
                question={t("agent.takeDownQuestion")}
                confirmLabel={t("agent.takeDownConfirm")}
                busyLabel={t("agent.takingDown")}
                busy={busy}
                onConfirm={() => void takeDown()}
                onCancel={() => setTakingDown(false)}
              />
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
            <>
              {/* What just happened, once — B816. The publish button below is
                  the undo, and it is the ordinary one with its ordinary
                  confirmation. */}
              {tookDown && !draft.published && (
                <p
                  role="status"
                  className="mt-5 rounded-2xl border border-navy-200 bg-cream-100 px-4 py-3 text-sm leading-6 text-navy-800"
                >
                  {t("agent.tookDown")}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {draft.published ? (
                  <>
                    <Link
                      href={`/${encodeURIComponent(username)}/trips/${encodeURIComponent(draft.trip)}/day/${draft.slug}`}
                      className="min-h-11 rounded-full border border-navy-300 px-5 py-2.5 text-base font-semibold text-navy-800"
                    >
                      {t("agent.viewDay")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setTakingDown(true)}
                      className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800"
                    >
                      {t("agent.takeDown")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!draft.written}
                    onClick={() => setAsking(true)}
                    className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
                  >
                    {t("agent.publish")}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {back && (
        <button
          type="button"
          onClick={() => goBack(back)}
          className="mt-6 min-h-11 text-base text-navy-700 underline underline-offset-4 transition-colors hover:text-navy-900"
        >
          {t(BACK_LABEL[back])}
        </button>
      )}
    </main>
  );
}
