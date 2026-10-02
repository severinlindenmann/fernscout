"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CloudSun, MapPin } from "lucide-react";
import { PhotoPicker } from "@/components/PhotoPicker";
import RecordButton from "@/components/RecordButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import PolishText from "@/components/studio/day/PolishText";
import { useI18n } from "@/components/LocaleProvider";
import { useOnline } from "@/components/studio/useOnline";
import { hasOutbox, newIntent, openOutboxStore, pendingDayDates } from "@/lib/outbox";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import DoneScreen from "@/components/studio/DoneScreen";
import StepIndicator from "@/components/extract/StepIndicator";
import MonthGrid from "@/components/studio/day/MonthGrid";
import DayStrip from "@/components/studio/day/DayStrip";
import type { ExistingDayOnDate, InboxMediaItem } from "@/components/studio/day/types";
import { ADD_DAY_RESUME_EXPIRY_MS, addDayExpiresOn, addDayFlowId, readAddDaySnapshot } from "@/lib/studio/addDayResume";
import { useStep } from "@/lib/studio/useStep";
import StepBody from "@/components/studio/StepBody";
import DayExtras, { NO_EXTRAS, extrasToWrite, lineProblem, type DayExtrasValue } from "@/components/studio/day/DayExtras";
import SpeakFlow, { RatherTalk, TellByChoice } from "@/components/studio/day/SpeakFlow";
import type { TellBy } from "@/lib/studio/speak";
import type { TranslationKey } from "@/lib/i18n";
import { mostCommon, photoDay, photosInGroup, splitDayPhotos, tripForDate } from "@/lib/studio/dayCards";
import { partTimeOfDay, splitIntoParts, waitingSheetPreselectsAll, type DayPart } from "@/lib/studio/dayParts";
import { partCommitPlan } from "@/lib/studio/dayCollision";
import { missingConsentScopes } from "@/lib/studio/featureConsent";
import { writePreviewUrl } from "@/lib/studio/previewUrl";
import { weatherGroup, type DayWeather } from "@/lib/weather";
import { MIN_QUERY_LEN } from "@/lib/addressLookupTypes";

import { journalPath } from "@/lib/journalPath";
/** First-run mode (B2188, owner decision D1 "C inside A"): the same page,
 *  revealed one part at a time for somebody who has no day yet. The one-page
 *  mode never calls `go`, so these steps only ever mean something there. */
const FIRST_RUN = ["photos", "words", "save"] as const;
/** The trip `<select>`'s own "+ New trip…" row — never a real trip id, so
 *  it can never collide with one. */
const NEW_TRIP_OPTION = "__new__";
type Outcome = "saved" | "writeFailed" | "queued";
type Sheet = "date" | "place" | "weather" | null;
/** `lib/addressLookup.ts`'s own `GeocodeCandidate`, read back by hand: that
 *  module is `server-only`, so a client component declares the wire shape
 *  itself rather than importing it — the same split
 *  `addressLookupTypes.ts` already makes for `AddressSuggestion`. */
type GeocodeCandidate = { displayName: string; country: string; lat: number; lon: number };

/** `Problem` from `lib/validate/media.ts`, read back off the wire — never
 *  imported directly, since that module is server-only. */
type MediaProblem = { field: string; got: string; expected: string; hint?: string };

/** `day/new`'s `invalid_media` detail is `attachStagedFiles`'s own result
 *  (`lib/api/staged.ts`), which carries a `problems` array — anything else
 *  is never shown. B2184: the owner reads a sentence, never the JSON. */
function mediaProblemsFrom(error: string | undefined, detail: unknown): MediaProblem[] | undefined {
  if (error !== "invalid_media" || !detail || typeof detail !== "object") return undefined;
  const problems = (detail as { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return undefined;
  const parsed = problems.filter(
    (p): p is MediaProblem =>
      !!p &&
      typeof p === "object" &&
      typeof (p as MediaProblem).field === "string" &&
      typeof (p as MediaProblem).got === "string" &&
      typeof (p as MediaProblem).expected === "string",
  );
  return parsed.length > 0 ? parsed : undefined;
}

/** "IMG_6178.jpeg is too large (8064px). The limit is …" — names the file
 *  from the field, never invents a number the server did not send. */
function mediaProblemSentence(p: MediaProblem, t: (key: TranslationKey, vars?: Record<string, string>) => string): string {
  const dot = p.field.lastIndexOf(".");
  const file = dot > 0 ? p.field.slice(0, dot) : p.field;
  if (p.hint) return `${file} — ${p.hint}`;
  const kind = dot > 0 ? p.field.slice(dot + 1) : "";
  const key: TranslationKey =
    kind === "duration"
      ? "studio.day.writeFailed.media.tooLong"
      : kind === "format"
        ? "studio.day.writeFailed.media.format"
        : "studio.day.writeFailed.media.tooLarge";
  return t(key, { file, got: p.got, expected: p.expected });
}

/** Inbox order newest first → the order the photographs were brought in. */
function oldestFirst(items: InboxMediaItem[]): InboxMediaItem[] {
  return [...items].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.filename.localeCompare(b.filename));
}
/** A file already in the inbox comes back from an upload with the same id. */
function mergeById(list: InboxMediaItem[], more: InboxMediaItem[]): InboxMediaItem[] {
  const seen = new Set(list.map((i) => i.id));
  return [...list, ...more.filter((i) => !seen.has(i.id) && seen.add(i.id))];
}

/** The date most of these photographs were taken on, and how many say so —
 *  "from 52 of 80 photos" is only ever a count of real EXIF dates. Ties go
 *  to the earlier date. */
function dateFromPhotos(photos: InboxMediaItem[]): { date: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const p of photos) {
    const d = photoDay(p.takenAt);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: { date: string; count: number } | null = null;
  for (const [date, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || count > best.count) best = { date, count };
  }
  return best;
}

const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-raised px-3 text-left text-sm text-ink-strong hover:bg-surface-subtle";
// 16px on phones: iOS zooms the page into any field set smaller (B2647).
const FIELD = "mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface-base px-3 text-base text-ink-body sm:text-sm";
// B2647 — iOS draws a time input at its own width and height, past its box;
// drop the native look so it sizes like every other field.
// The value is centred by hand: without the native look iOS sets it at the top.
const TIME_FIELD = `${FIELD} appearance-none py-2.5 leading-6 [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.5em]`;
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-ink-secondary";
const LINK = "min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2";
// B2627 — the inline split offer's own two buttons: normal buttons, never
// the bar (the bar belongs to `StepPrimary`, one registrant at a time).
const SPLIT_PRIMARY = "min-h-11 flex-1 rounded-full bg-action-strong px-4 text-base font-semibold text-on-action";
const SPLIT_SECONDARY = "min-h-11 rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong hover:bg-surface-subtle";

/**
 * "Add a day" — one page since B2188 (it was six screens and an eleven-row
 * "still open" wall, B1830/B2078). Photographs, the facts they carry as
 * chips that name their source, one box for the words, and "Save privately".
 * A declinable left blank is not asked about here: sharing names it (B2192,
 * conformance D1 as amended by B2191).
 *
 * Nothing is written until Save (C1). Every typed answer rides in the
 * session draft (`studio:addDay:<user>`), which the hub's "Half done" strip
 * also reads (`readAddDaySnapshot`).
 */
export default function AddDayFlow({
  username,
  trips,
  writtenDatesByTrip,
  proposal,
  polishAiAvailable = null,
  routeRecordingAvailable = false,
  weatherAvailable = false,
  addressLookupAvailable = false,
  helperOn = false,
  consents = { words: false, photos: false, speech: false },
  providers = { words: "", speech: null },
  speech: speechProp = null,
  readersByTrip = {},
  initialTripId,
  tellBy = null,
  initialPhotos,
  currencies = [],
}: {
  username: string;
  trips: { id: string; title: string; start: string; end: string }[];
  /** ISO dates already written, per trip id (B1989's `DayStrip`). */
  writtenDatesByTrip: Record<string, string[]>;
  proposal: { trip: { id: string; title: string; status: string }; reasonKey: string; today: string } | null;
  /** "Polish my text" (B2190/B2591): whether the plan still has an AI day or
   *  turn to spend on it, or `null` when it may not be offered at all —
   *  helper off, or no consent to send words — read on the server.
   *  `PolishText` renders nothing on null. */
  polishAiAvailable?: boolean | null;
  /** B2200, D1 — whether the page may ask `day/place` for a suggestion at
   *  all. Off means the route is never called. */
  routeRecordingAvailable?: boolean;
  /** The weather capability. Off: no weather chip, and `weather` is never sent. */
  weatherAvailable?: boolean;
  /** B2676 — the place panel's own search (`plan/search`, `geocodePlace`).
   *  Off: the place panel is free text, coordinates never set from it. */
  addressLookupAvailable?: boolean;
  /** B2676 — whether the receipt feature may run at all (the `helper`
   *  capability). Off: "📷 From a receipt" is absent, never disabled. */
  helperOn?: boolean;
  /** The three `/api/helper/{user}/consent` scopes already agreed to — the
   *  receipt sheet's own "suggest" gate (`lib/studio/featureConsent.ts`)
   *  reads `words`/`photos` from here. */
  consents?: { words: boolean; photos: boolean; speech: boolean };
  /** Who the receipt's "suggest" consent sheet names. */
  providers?: { words: string; speech: string | null };
  /** The transcription capability's own facts, `null` when it is off — the
   *  microphone is then absent, not broken. */
  speech?: { consented: boolean; provider: string; aiAvailable: boolean | null } | null;
  /** Who besides the owner can see a draft on each trip (`draftsVisibleTo`:
   *  the people on the trip), by name, for the saved sentence. */
  readersByTrip?: Record<string, string[]>;
  /** `?trip=<id>` — trip/new's done screen links here with the trip it made. */
  initialTripId?: string;
  /** B2194 — the owner's "How do you like to tell it?", `null` when never
   *  asked. Only read with `speech` on: without transcription neither the
   *  question nor the spoken questions exist. */
  tellBy?: TellBy | null;
  /** `?photos=<date>|undated` — a hub day card (B2193): exactly that day's
   *  waiting photographs are chosen, whatever a stored draft had chosen. */
  initialPhotos?: string;
  /** B2233 — `journalCurrencies`, base first, for a cost line. */
  currencies?: string[];
}) {
  const { t, tn, formatLongDate } = useI18n();
  /** `17°, sunny` — the weather chip's own real value, B2676. Metric only:
   *  a chip is not the place to re-fight `DayWeather.tsx`'s unit handling. */
  function weatherChipLabel(reading: DayWeather): string {
    const temp = reading.tempMax ?? reading.tempMin;
    const tempText = temp !== undefined ? `${Math.round(temp)}°` : "";
    const group = weatherGroup(reading.code);
    const groupText = group ? t(`weather.${group}` as TranslationKey).toLowerCase() : "";
    return [tempText, groupText].filter(Boolean).join(", ") || t("studio.day.chip.weather");
  }
  const router = useRouter();
  const params = useSearchParams();
  const todayIso = proposal?.today ?? new Date().toISOString().slice(0, 10);
  const firstRun = Object.values(writtenDatesByTrip).every((dates) => dates.length === 0);
  // B2676 — the microphone follows the `transcription` capability alone
  // (`speechProp`, read server-side); there is no assistant switch in front
  // of it any more, and `RecordButton` asks its own per-use consent.
  const speech = speechProp;
  const proposedToday = proposal?.trip.status === "current" ? proposal.today : "";

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tripOverride, setTripOverride] = useState("");
  const [dateOverride, setDateOverride] = useState("");
  const [time, setTime] = useState("");
  const [confirmedSecondEntry, setConfirmedSecondEntry] = useState(false);
  // B2676, decision 4 — the date already has a day, asked about inline
  // rather than only discovered by a 409 at write time. `GET day/for-date`
  // is asked once per (trip, date); the server's own check at write time
  // (a 409 `date_has_day`, folded back into this same state — B2677, bug 3)
  // stays the real guard for the race case.
  const [existingOnDate, setExistingOnDate] = useState<ExistingDayOnDate | null>(null);
  const existingAskedFor = useRef<string | null>(null);
  // B2676, decision 7 — parts stacked on one page rather than stepped
  // through. `null` is "not split"; split, each part keeps its own words
  // (`partWords`, index-aligned with `parts`) and its own slice of the
  // chosen photographs (`part.ids`).
  const [parts, setParts] = useState<DayPart[] | null>(null);
  const [partWords, setPartWords] = useState<string[]>([]);
  // B2676, decision 2 — the status line, and the slug(s) a background save
  // has already created. `createdSlug` is the base day (part 0, or the
  // whole day when unsplit); `partSlugs[i]` (i > 0) is each later part's
  // own entry, filled in only by an explicit Save/Preview — see the Build
  // notes on why autosave itself stops at the base day.
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [, setPartSlugs] = useState<Record<number, string>>({});
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [weatherReading, setWeatherReading] = useState<DayWeather | null>(null);
  // B2676 — the receipt feature. `galleryItems` is the day's own on-disk
  // gallery (filled once `createdSlug` exists); the rest is the sheet's own
  // state, reset to idle on close.
  const [galleryItems, setGalleryItems] = useState<{ src: string; type: "image" | "video" }[]>([]);
  const [receiptPicking, setReceiptPicking] = useState(false);
  const [receiptConsentAsking, setReceiptConsentAsking] = useState(false);
  const [receiptConsentBusy, setReceiptConsentBusy] = useState(false);
  const [receiptBusyFor, setReceiptBusyFor] = useState<string | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [receiptReading, setReceiptReading] = useState<{ src: string; amount: number; currency: string; label: string | null } | null>(null);
  const [receiptAdded, setReceiptAdded] = useState(false);
  const pendingReceiptSrc = useRef<string | null>(null);
  // B2676 (P8) — a "yes" given this visit refreshes locally rather than
  // waiting for a reload; merged over the server-read `consents` prop so a
  // page that already had consent, or gets it mid-visit, both read true.
  const [consentOverride, setConsentOverride] = useState<{ words?: boolean; photos?: boolean }>({});
  const effectiveConsents = { ...consents, ...consentOverride };

  const [inboxItems, setInboxItems] = useState<InboxMediaItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const photosInit = useRef(false);
  // B2232 — brought in for this day: a card's photographs, this visit's uploads.
  const [ownIds, setOwnIds] = useState<string[]>([]);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  // B2676 — the one "＋ Add photos" sheet, opened from the strip's own first
  // tile, the empty tile, or a part's own "＋ Add"; `"day"` is the unsplit
  // day, a number is that part's index. Three tabs: Waiting (this page's own
  // inbox, grouped by day — a deferred multi-select, confirmed by "Add N
  // photos"), This phone (`PhotoPicker`) and Camera (its own file input).
  // The latter two upload and select immediately (`pickFromDevice`), which
  // picks up `photoSheetTarget` itself to route a part-targeted upload —
  // `selectedIdsAtSheetOpen` is only there so that effect, and the Waiting
  // tab's own direct update, can never double-add the same ids.
  const [photoSheetTarget, setPhotoSheetTarget] = useState<"day" | number | null>(() => (params.get("add") === "photos" ? "day" : null));
  // B2677 — "＋ Add photos" on Preview links back here with `&add=photos`, so the sheet opens over Write (a lazy initial value, not a mount effect).
  const [photoSheetTab, setPhotoSheetTab] = useState<"waiting" | "device" | "camera">("waiting");
  const [sheetPicked, setSheetPicked] = useState<Set<string>>(new Set());
  const selectedIdsAtSheetOpen = useRef<string[]>([]);
  useEffect(() => {
    if (typeof photoSheetTarget !== "number") return;
    const added = selectedIds.filter((id) => !selectedIdsAtSheetOpen.current.includes(id));
    if (added.length === 0) return;
    const i = photoSheetTarget;
    setParts((prev) => (prev ? prev.map((p, idx) => (idx === i ? { ...p, ids: [...new Set([...p.ids, ...added])] } : p)) : prev));
    selectedIdsAtSheetOpen.current = selectedIds;
  }, [selectedIds, photoSheetTarget]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // B2330 — a photo picked with no server reachable: queued in the outbox as
  // its own `media.upload` intent (the original file, kept as a `Blob`,
  // never re-encoded), shown here with a local object URL rather than the
  // server's own thumbnail route (which does not know this id yet).
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<Record<string, string>>({});
  const [pendingDates, setPendingDates] = useState<Set<string>>(new Set());
  const online = useOnline();

  // The "waiting" marker on the day strip (B2330) — every pending `day.new`
  // write for this owner, re-read whenever the outbox might have changed
  // (mount, and right after this page queues its own).
  useEffect(() => {
    if (!hasOutbox()) return;
    let cancelled = false;
    pendingDayDates(openOutboxStore(), username).then((dates) => {
      if (!cancelled) setPendingDates(dates);
    });
    return () => {
      cancelled = true;
    };
  }, [username, outcome]);
  const [mismatchKept, setMismatchKept] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // B2627 — "Keep it one day" dismisses the inline split offer for exactly
  // this set of chosen photographs; picking a different photo brings it back.
  const [splitDismissedFor, setSplitDismissedFor] = useState<string | null>(null);

  // The place, once the owner has said anything about it (changed, removed,
  // taken the route's suggestion). Until then it is read off the photographs.
  const [placeEdited, setPlaceEdited] = useState(false);
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  // B2676 — the place panel's own search, when `addressLookup` is on: a
  // place name in, real candidates (with coordinates) back. Separate from
  // `location`/`country` above, which only a pick (or, with the capability
  // off, free text) ever writes.
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<GeocodeCandidate[]>([]);
  const [placeSearchFailed, setPlaceSearchFailed] = useState(false);
  const placeSearchId = useRef(0);
  // D6 — on by default, removable.
  const [weatherOn, setWeatherOn] = useState(true);

  // B2200, D1 — `undefined` is "not asked yet", `null` is "asked, nothing to
  // offer"; a value is only ever offered, never written until "Use it".
  const [placeSuggestion, setPlaceSuggestion] = useState<{ name: string; country: string } | null | undefined>(undefined);
  const [placeSuggestionDismissed, setPlaceSuggestionDismissed] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);
  // B2645 — what the last tap on the bottom button was stopped by.
  const [blockedBy, setBlockedBy] = useState<"trip" | "date" | "cost" | null>(null);
  const [extras, setExtras] = useState<DayExtrasValue>(NO_EXTRAS);
  const [busy, setBusy] = useState(false);
  const [saveQueued, setSaveQueued] = useState(false);
  const [writeError, setWriteError] = useState<{ message: string; mediaProblems?: MediaProblem[] } | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  // B2194 — asked once, then `?mode=speak` or the remembered "speak" opens the
  // spoken questions; `?mode=type` is the composer, whatever was chosen.
  const [tellByNow, setTellByNow] = useState(tellBy);
  const [spoken, setSpoken] = useState(false);
  const mode = params.get("mode");
  const askTellBy = !!speech && tellByNow === null && mode === null;
  const speaking = !!speech && (mode === "speak" || (mode !== "type" && tellByNow === "speak"));

  const dirty = content.trim() !== "" || title.trim() !== "" || dateOverride !== "" || tripOverride !== "";
  // B2676 — one flowId per day, never suffixed per part: the bug this
  // fixes (`addDayResume.ts`'s own doc comment) was exactly a suffixed key
  // here disagreeing with `readAddDaySnapshot`'s plain one, so "Continue"
  // on the hub never found what this page had just saved.
  const { step, index, total, go, reset } = useStep(FIRST_RUN, {
    flowId: addDayFlowId(username),
    draft: {
      // `step` is what the hub's strip reads: a page nobody has typed on is
      // not "half done".
      get: (): Record<string, unknown> => ({
        step: dirty ? (firstRun ? step : "page") : "",
        savedAt: new Date().toISOString(),
        tripId: tripOverride,
        date: dateOverride,
        tripOverride, dateOverride, time, confirmedSecondEntry, selectedIds, photosInit: photosInit.current,
        mismatchKept, title, content, placeEdited, location, country, lat, lng, weatherOn, extras,
        parts, partWords, createdSlug,
      }),
      set: (d) => {
        if (typeof d.savedAt === "string" && Date.now() - Date.parse(d.savedAt) > ADD_DAY_RESUME_EXPIRY_MS) return;
        const str = (v: unknown, set: (s: string) => void) => typeof v === "string" && set(v);
        const bool = (v: unknown, set: (b: boolean) => void) => typeof v === "boolean" && set(v);
        const num = (v: unknown, set: (n: number) => void) => typeof v === "number" && set(v);
        if (typeof d.tripOverride === "string" && trips.some((tr) => tr.id === d.tripOverride)) setTripOverride(d.tripOverride);
        str(d.dateOverride, setDateOverride);
        str(d.time, setTime);
        bool(d.confirmedSecondEntry, setConfirmedSecondEntry);
        if (Array.isArray(d.selectedIds)) setSelectedIds(d.selectedIds.filter((x): x is string => typeof x === "string"));
        if (d.photosInit === true) photosInit.current = true;
        bool(d.mismatchKept, setMismatchKept);
        str(d.title, setTitle);
        str(d.content, setContent);
        bool(d.placeEdited, setPlaceEdited);
        str(d.location, setLocation);
        str(d.country, setCountry);
        num(d.lat, setLat);
        num(d.lng, setLng);
        bool(d.weatherOn, setWeatherOn);
        if (d.extras && typeof d.extras === "object") setExtras({ ...NO_EXTRAS, ...(d.extras as Partial<DayExtrasValue>) });
        if (Array.isArray(d.parts)) setParts(d.parts as DayPart[]);
        if (Array.isArray(d.partWords)) setPartWords(d.partWords.filter((x): x is string => typeof x === "string"));
        str(d.createdSlug, setCreatedSlug);
      },
    },
  });

  // A draft left behind says so once, with when it goes and a way out.
  // After mount: sessionStorage does not exist on the server.
  useEffect(() => {
    const snapshot = readAddDaySnapshot(username);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of sessionStorage, see above.
    if (snapshot) setRestoredFrom(snapshot.savedAt);
    try {
      if (window.localStorage.getItem(`studio:addDay:details:${username}`) === "open") setDetailsOpen(true);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDetails(open: boolean) {
    setDetailsOpen(open);
    try {
      window.localStorage.setItem(`studio:addDay:details:${username}`, open ? "open" : "closed");
    } catch {}
  }

  function startOver() {
    setTripOverride("");
    setDateOverride("");
    setTime("");
    setConfirmedSecondEntry(false);
    setSelectedIds((inboxItems ?? []).filter((i) => proposedToday && photoDay(i.takenAt) === proposedToday).map((i) => i.id));
    setMismatchKept(false);
    setTitle("");
    setContent("");
    setPlaceEdited(false);
    setLocation("");
    setCountry("");
    setLat(undefined);
    setLng(undefined);
    setWeatherOn(true);
    setExtras(NO_EXTRAS);
    // Not `reset()`: that stops the draft being kept at all, and the page
    // carries on. The emptied fields are written over the old draft instead.
    setRestoredFrom(null);
  }

  // ── photographs ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/helper/${encodeURIComponent(username)}/inbox`)
      .then((r) => r.json())
      .then((json: { media?: InboxMediaItem[] }) => {
        const items = oldestFirst(json.media ?? []);
        setInboxItems((prev) => mergeById(items, prev ?? []));
        if (initialPhotos) {
          photosInit.current = true;
          const card = photosInGroup(items, initialPhotos).map((i) => i.id);
          setSelectedIds(card);
          setOwnIds(card);
          setDateOverride("");
        } else if (!photosInit.current) {
          // B2232 — only the photographs taken on the day this page proposes
          // (today, inside a current trip); undated ones never join by themselves.
          photosInit.current = true;
          const today = items.filter((i) => proposedToday && photoDay(i.takenAt) === proposedToday).map((i) => i.id);
          setSelectedIds((prev) => [...new Set([...prev, ...today])]);
        }
      })
      .catch(() => setInboxItems((prev) => prev ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** B2677, bug 6 — This phone/Camera "upload and select immediately"; the
   *  sheet (the only caller left, since bug 5) closes itself rather than
   *  leaving the owner to dismiss it by hand. A part target gets its ids
   *  attached here, synchronously with the close, rather than through the
   *  growth-tracking effect above — that effect reads `photoSheetTarget`
   *  after this same render, by which point the close below has already
   *  cleared it, so it would never see which part these ids belong to. */
  function closePhotoSheetAfterPick(newIds: string[]) {
    if (typeof photoSheetTarget === "number") {
      const i = photoSheetTarget;
      setParts((prev) => (prev ? prev.map((p, idx) => (idx === i ? { ...p, ids: [...new Set([...p.ids, ...newIds])] } : p)) : prev));
      selectedIdsAtSheetOpen.current = [...selectedIdsAtSheetOpen.current, ...newIds];
    }
    setPhotoSheetTarget(null);
  }

  /** Uploads in the background: the page stays usable, and a Save pressed
   *  meanwhile waits for them (`saveQueued`) rather than leaving them out. */
  async function pickFromDevice(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const n = list.length;
    setUploading((u) => u + n);
    setUploadError(null);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f));
      // no-refresh: stages the photo in the inbox for this draft to pick up;
      // nothing is on the day itself until `day/new` commits below, which
      // does refresh.
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; items?: InboxMediaItem[] } | null;
      if (!res.ok || !json?.ok) {
        setUploadError(t("studio.day.photos.uploadError"));
        return;
      }
      const items = json.items ?? [];
      const newIds = items.map((i) => i.id);
      setInboxItems((prev) => mergeById(prev ?? [], items));
      setSelectedIds((prev) => [...new Set([...prev, ...newIds])]);
      setOwnIds((prev) => [...prev, ...newIds]);
      closePhotoSheetAfterPick(newIds);
    } catch {
      // A network error (offline, or the server unreachable) rather than a
      // rejection the server actually sent — B2330 queues the original file
      // instead of losing it, kept as its own `media.upload` intent so it
      // replays and becomes a real inbox item once there is a connection.
      if (!hasOutbox()) {
        setUploadError(t("studio.day.photos.uploadError"));
        return;
      }
      const store = openOutboxStore();
      const placeholders: InboxMediaItem[] = [];
      const urls: Record<string, string> = {};
      for (const f of list) {
        const id = `pending-${crypto.randomUUID()}`;
        await store.add(
          newIntent({
            user: username,
            kind: "media.upload",
            method: "POST",
            url: `/api/helper/${encodeURIComponent(username)}/inbox`,
            body: { placeholderId: id, filename: f.name },
            blob: f,
          }),
        );
        placeholders.push({ id, filename: f.name, bytes: f.size, uploadedAt: new Date().toISOString() });
        urls[id] = URL.createObjectURL(f);
      }
      const newIds = placeholders.map((i) => i.id);
      setPendingPhotoUrls((prev) => ({ ...prev, ...urls }));
      setInboxItems((prev) => mergeById(prev ?? [], placeholders));
      setSelectedIds((prev) => [...new Set([...prev, ...newIds])]);
      setOwnIds((prev) => [...prev, ...newIds]);
      closePhotoSheetAfterPick(newIds);
    } finally {
      setUploading((u) => u - n);
    }
  }

  /** The Waiting tab's own grouping — every inbox item not already chosen
   *  anywhere on this page, by its own day, this day first (B2676). */
  function waitingGroups(): { date: string | null; items: InboxMediaItem[] }[] {
    const chosen = new Set([...selectedIds, ...ownIds]);
    const candidates = (inboxItems ?? []).filter((i) => !chosen.has(i.id));
    const byDate = new Map<string | null, InboxMediaItem[]>();
    for (const item of candidates) {
      const d = photoDay(item.takenAt) || null;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(item);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => {
        if (a === date) return -1;
        if (b === date) return 1;
        if (a === null) return 1;
        if (b === null) return -1;
        return b.localeCompare(a);
      })
      .map(([groupDate, items]) => ({ date: groupDate, items }));
  }

  function openPhotoSheet(target: "day" | number) {
    selectedIdsAtSheetOpen.current = selectedIds;
    setPhotoSheetTarget(target);
    setPhotoSheetTab("waiting");
    const thisDay = waitingGroups().find((g) => g.date === date);
    setSheetPicked(new Set(thisDay && waitingSheetPreselectsAll(thisDay.items.length) ? thisDay.items.map((i) => i.id) : []));
  }

  // B2677, bug 6 — Escape closes the photo sheet the same way the backdrop
  // tap already does; without this, This phone and Camera (no Cancel of
  // their own before this ticket) had no keyboard way out at all.
  useEffect(() => {
    if (photoSheetTarget === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhotoSheetTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [photoSheetTarget]);

  function toggleSheetPicked(id: string) {
    setSheetPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmPhotoSheetPicks() {
    const ids = [...sheetPicked];
    if (ids.length > 0) {
      if (typeof photoSheetTarget === "number") {
        const i = photoSheetTarget;
        setParts((prev) => (prev ? prev.map((p, idx) => (idx === i ? { ...p, ids: [...new Set([...p.ids, ...ids])] } : p)) : prev));
      }
      setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
      setOwnIds((prev) => [...new Set([...prev, ...ids])]);
      // Pre-empts the growth-tracking effect above: these ids are already
      // placed, so it must not place them again when `selectedIds` changes.
      selectedIdsAtSheetOpen.current = [...selectedIdsAtSheetOpen.current, ...ids];
    }
    setPhotoSheetTarget(null);
    setSheetPicked(new Set());
    setPhotoSheetTab("waiting");
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** What will be written: the list's own order, deduplicated by id. */
  const chosenPhotos = (inboxItems ?? []).filter((i) => selectedIds.includes(i.id));

  // B2627/B2676 — the composer's own chosen photographs, offered as parts.
  // Never while already split (`parts` set — "Keep as one" clears it before
  // this can offer again), and never while any chosen photograph is still
  // an offline-queued placeholder with no real `takenAt` to split on yet.
  const pendingChosen = chosenPhotos.some((i) => i.id in pendingPhotoUrls);
  const splitCandidate =
    parts === null && !pendingChosen
      ? splitIntoParts(chosenPhotos.map((i) => ({ id: i.id, takenAt: i.takenAt, lat: i.lat, lon: i.lon }))).parts
      : [];
  const chosenSignature = selectedIds.slice().sort().join(",");
  const offerSplitHere = splitCandidate.length >= 2 && splitDismissedFor !== chosenSignature;

  // ── the facts, each with where it came from ─────────────────────────
  const fromPhotos = dateFromPhotos(chosenPhotos);
  // No date from the photographs and none chosen: ask, never quietly today —
  // unless there are no photographs at all and today is inside a trip.
  const date = dateOverride || fromPhotos?.date || (chosenPhotos.length === 0 ? proposedToday : "");
  const dateSource = dateOverride
    ? t("studio.day.source.chosen")
    : fromPhotos
      ? fromPhotos.count === chosenPhotos.length
        ? tn("studio.day.source.photosAll", fromPhotos.count, { count: String(fromPhotos.count) })
        : t("studio.day.source.photosSome", { count: String(fromPhotos.count), total: String(chosenPhotos.length) })
      : date
        ? t("studio.day.source.today")
        : "";

  const validInitial = initialTripId && trips.some((tr) => tr.id === initialTripId) ? initialTripId : undefined;
  const containing = date ? tripForDate(date, trips)?.id : undefined;
  const tripId = tripOverride || validInitial || containing || proposal?.trip.id || trips[0]?.id || "";
  const trip = trips.find((tr) => tr.id === tripId);
  const dayNumber =
    trip && date && trip.start <= date && date <= trip.end
      ? Math.round((Date.parse(date) - Date.parse(trip.start)) / 86_400_000) + 1
      : null;

  // B2227 — the chip names this day's place, not any chosen photo's: the
  // same "most common place" rule the hub's day cards use, over only the
  // photographs whose own day matches the one being written.
  const chosenToday = date ? chosenPhotos.filter((i) => photoDay(i.takenAt) === date) : [];
  const todaysPlaceName = mostCommon(chosenToday.map((i) => i.location || i.country || "").filter(Boolean));
  const photoPlace = todaysPlaceName ? chosenToday.find((i) => (i.location || i.country) === todaysPlaceName) : undefined;
  const photoCoords = chosenToday.find((i) => i.lat !== undefined && i.lon !== undefined);
  const place = placeEdited
    ? { location, country, lat, lng }
    : { location: photoPlace?.location ?? "", country: photoPlace?.country ?? "", lat: photoCoords?.lat, lng: photoCoords?.lon };
  const hasCoords = place.lat !== undefined && place.lng !== undefined;
  const placeLabel = [place.location, place.country].filter(Boolean).join(", ");
  const weather = weatherAvailable && hasCoords && !!date && weatherOn;

  const mismatched = date ? chosenPhotos.filter((i) => i.takenAt && i.takenAt.slice(0, 10) !== date) : [];
  // B2193 — photographs from several days are split on the hub, one card each.
  const photoDays = new Set(chosenPhotos.map((i) => photoDay(i.takenAt)).filter(Boolean)).size;

  // ── "Add this to it?" (B2676, decision 4) ───────────────────────────
  // Asked inline the moment a date is chosen, not only discovered at save
  // time — `day/for-date` exists for exactly this (its own doc comment).
  useEffect(() => {
    const key = `${tripId}\u0000${date}`;
    if (!online || !tripId || !date || existingAskedFor.current === key) return;
    existingAskedFor.current = key;
    setExistingOnDate(null);
    setConfirmedSecondEntry(false);
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/day/for-date?trip=${encodeURIComponent(tripId)}&date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok?: boolean; existing?: ExistingDayOnDate | null } | null) => {
        if (!cancelled) setExistingOnDate(json?.ok ? (json.existing ?? null) : null);
      })
      .catch(() => {
        existingAskedFor.current = null;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, tripId, date]);

  /** Free text — only ever reached with `addressLookupAvailable` off. A
   *  manual edit always clears the coordinates: whatever pin was there (a
   *  photo's, or an earlier pick's) named a place that is not necessarily
   *  this one any more, and a stale pin must never survive an edit that no
   *  longer names the place it pointed at (B2676, decision 6 / old P13). */
  function editPlaceText(next: { location?: string; country?: string }) {
    if (!placeEdited) {
      setLocation(place.location);
      setCountry(place.country);
      setPlaceEdited(true);
    }
    if (next.location !== undefined) setLocation(next.location);
    if (next.country !== undefined) setCountry(next.country);
    setLat(undefined);
    setLng(undefined);
  }
  /** A real geocode pick (`addressLookupAvailable` on) — the only way
   *  coordinates are ever set from the place panel. Replaces whatever pin
   *  was there before outright. */
  function pickPlace(candidate: GeocodeCandidate) {
    setPlaceEdited(true);
    setLocation(candidate.displayName);
    setCountry(candidate.country);
    setLat(candidate.lat);
    setLng(candidate.lon);
    setPlaceQuery(candidate.displayName);
    setPlaceResults([]);
    setSheet(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-chip="place"]')?.focus());
  }
  function removePlace() {
    setPlaceEdited(true);
    setLocation("");
    setCountry("");
    setPlaceQuery("");
    setPlaceResults([]);
    setLat(undefined);
    setLng(undefined);
    setSheet(null);
  }

  // B2676 — the place panel's own search, debounced the same way
  // `AddressLookupField.tsx` already debounces its own (300ms): a
  // keystroke is not a search. `plan/search` (→ `geocodePlace`) rather than
  // `AddressLookupField`'s own `address-lookup` route — that one filters to
  // street-level house numbers only (its own doc comment: "a 'city' hit is
  // a place, not an address"), which would never find "Budapest" at all.
  useEffect(() => {
    if (!addressLookupAvailable || sheet !== "place") return;
    const trimmed = placeQuery.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      // A query shrunk below the floor (backspaced, or the sheet just
      // opened on a short name): nothing to ask, and the stale list from a
      // longer query must not linger either.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears a stale list the moment the query itself falls below the floor, not on a timer.
      setPlaceResults([]);
      setPlaceSearchFailed(false);
      return;
    }
    const id = ++placeSearchId.current;
    const timer = setTimeout(() => {
      fetch(`/api/helper/${encodeURIComponent(username)}/plan/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { results?: GeocodeCandidate[] } | null) => {
          if (placeSearchId.current !== id) return;
          if (!json) {
            setPlaceSearchFailed(true);
            setPlaceResults([]);
            return;
          }
          setPlaceSearchFailed(false);
          setPlaceResults(json.results ?? []);
        })
        .catch(() => {
          if (placeSearchId.current === id) {
            setPlaceSearchFailed(true);
            setPlaceResults([]);
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [addressLookupAvailable, sheet, placeQuery, username]);

  // The search box shows the current place when the sheet opens, not
  // whatever was last typed in a previous visit to it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe seed of the search box from the sheet actually opening, the same pattern the resume banner's own mount effect uses.
    if (sheet === "place") setPlaceQuery(place.location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // ── the route's place suggestion (B2200) ────────────────────────────
  // Asked once per (trip, date), only with the capability on and nothing
  // said about the place yet — the same gates the old "where" step had.
  const placeAskedFor = useRef<string | null>(null);
  const placeEmpty = placeLabel === "";
  useEffect(() => {
    const key = `${tripId}\u0000${date}`;
    // B2331 — `online` (the shared, server-reachability signal, not just
    // the network interface) gates this too: without it, a lookup tried
    // while this server could not be reached fell into the `.catch()`
    // below, was marked "asked, nothing to offer" for `key`, and never ran
    // again for the rest of this mount — the owner's actual location that
    // day, filled in the moment the server is reachable everywhere else
    // (weather already works this way, server-side, at day creation), was
    // silently skipped for a place suggestion that only ever asked once.
    if (!online || !routeRecordingAvailable || !tripId || !date || !placeEmpty || placeSuggestionDismissed || placeAskedFor.current === key) return;
    placeAskedFor.current = key;
    // B2646 — a suggestion for the previous trip or date never lingers.
    setPlaceSuggestion(null);
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/day/place?trip=${encodeURIComponent(tripId)}&date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok?: boolean; place?: { name: string; country: string } | null } | null) => {
        if (!cancelled) setPlaceSuggestion(json?.ok ? (json.place ?? null) : null);
      })
      .catch(() => {
        // A network failure (offline, or this server unreachable), not "no
        // fixes that day" — retried once `online` flips back rather than
        // left answered-with-nothing for good.
        placeAskedFor.current = null;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRecordingAvailable, tripId, date, placeEmpty, online]);

  // ── B2648 — how the day (or this part of it) travelled, from the
  // owner's own recorded route. Asked when "More details" opens; offered as
  // chips, never filled in by itself.
  const [routeTravel, setRouteTravel] = useState<{ mode: string; km: number }[] | null>(null);
  useEffect(() => {
    if (!detailsOpen || !online || !routeRecordingAvailable || !tripId || !date) return;
    let cancelled = false;
    // B2676 — travel is a day-level fact (the chips sit above every part,
    // shared), never one part's own stretch any more.
    fetch(`/api/helper/${encodeURIComponent(username)}/day/travel?trip=${encodeURIComponent(tripId)}&date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { travel?: { modes?: { mode: string; km: number }[] } | null } | null) => {
        if (!cancelled) setRouteTravel(json?.travel?.modes ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsOpen, online, routeRecordingAvailable, tripId, date]);

  function acceptPlaceSuggestion() {
    if (!placeSuggestion) return;
    editPlaceText({ location: placeSuggestion.name, country: placeSuggestion.country });
    setPlaceSuggestionDismissed(true);
    // B2646 — "Use it" is the whole answer: the panel closes and focus
    // returns to the place chip, which now names the place.
    setSheet(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-chip="place"]')?.focus());
  }

  // ── the write ───────────────────────────────────────────────────────

  type PartWriteResult =
    | { ok: true; slug: string }
    | { ok: false; error: string; detail?: unknown; existing?: ExistingDayOnDate; network?: true };

  /** One day document — the base/unsplit day, or one part of a split one.
   *  Never shows an outcome screen itself; the caller (`commit` below)
   *  decides what a result means for the whole save. */
  async function writeOnePart(opts: {
    content: string;
    photoIds: string[];
    time: string;
    secondEntry: boolean;
    withTitleAndExtras: boolean;
  }): Promise<PartWriteResult> {
    const payload = {
      trip: tripId,
      date,
      time: opts.time || undefined,
      // Never generated: a blank title stays blank. Only the base day of a
      // split carries one — B2676 drops title off every part but the
      // first (title/tags move to Preview, B2677, which is not this).
      title: opts.withTitleAndExtras ? title : "",
      content: opts.content,
      location: place.location || undefined,
      country: place.country || undefined,
      lat: place.lat,
      lng: place.lng,
      weather,
      mediaInboxIds: opts.photoIds,
      ...(opts.withTitleAndExtras ? extrasToWrite(extras) : {}),
      declined: {},
      confirmSecondEntry: opts.secondEntry,
    };
    try {
      // no-refresh: a quiet autosave while the owner is typing — a refresh here would re-render the page under them; Preview and the hub read fresh on navigation.
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/day/new`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; slug: string }
        | { error: string; detail?: unknown; existing?: ExistingDayOnDate }
        | null;
      if (json && "ok" in json && json.ok) {
        // B2058 — the route answers with the v2 day id (`<date>-<slug>`).
        const created = json.slug.startsWith(`${date}-`) ? json.slug.slice(date.length + 1) : json.slug;
        return { ok: true, slug: created };
      }
      const error = json && "error" in json ? json.error : "unknown";
      const detail = json && "detail" in json ? json.detail : undefined;
      const existing = json && "existing" in json ? json.existing : undefined;
      return { ok: false, error, detail, existing };
    } catch {
      return { ok: false, error: "network", network: true };
    }
  }

  /** Queues the base/unsplit write in the offline outbox — B2330. Never
   *  used for a split part: a day queued offline has no server slug yet, so
   *  a second part with nothing to attach to cannot queue the same way. */
  async function queueOffline(opts: { content: string; photoIds: string[]; time: string; secondEntry: boolean }) {
    const store = openOutboxStore();
    await store.add(
      newIntent({
        user: username,
        kind: "day.new",
        method: "POST",
        url: `/api/helper/${encodeURIComponent(username)}/day/new`,
        body: {
          trip: tripId,
          date,
          time: opts.time || undefined,
          title,
          content: opts.content,
          location: place.location || undefined,
          country: place.country || undefined,
          lat: place.lat,
          lng: place.lng,
          weather,
          mediaInboxIds: opts.photoIds,
          ...extrasToWrite(extras),
          declined: {},
          confirmSecondEntry: opts.secondEntry,
        },
      }),
    );
    setOutcome("queued");
  }

  // B2676 — which chosen photographs autosave (or a later patch) has
  // already attached to `createdSlug`, so a repeat never resends one.
  const attachedIdsRef = useRef<Set<string>>(new Set());

  /** Saves the words/title and any newly chosen photographs onto a day that
   *  already exists (autosave created it) — `day/attach` + the same `PATCH
   *  /day` an edit already uses, never a second `day/new` (B2677, bug 2:
   *  "Preview →" must not collide with the day autosave just saved). */
  async function patchExisting(slug: string): Promise<boolean> {
    const newPhotoIds = chosenPhotos.map((i) => i.id).filter((id) => !attachedIdsRef.current.has(id));
    if (newPhotoIds.length > 0) {
      const attached = await fetch(`/api/helper/${encodeURIComponent(username)}/day/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, slug, files: newPhotoIds }),
      }).catch(() => null);
      if (attached?.ok) newPhotoIds.forEach((id) => attachedIdsRef.current.add(id));
    }
    const patched = await fetch(`/api/helper/${encodeURIComponent(username)}/day`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripId, slug, title, content }),
    }).catch(() => null);
    return !!patched?.ok;
  }

  async function commit(secondEntryOverride?: boolean) {
    // The inline "Add this to it?" card's own "Yes" calls
    // `setConfirmedSecondEntry(true)` and `commit(true)` in the same
    // handler — a state update is not visible to the closure that scheduled
    // it, so the explicit override is what the very next write actually
    // sees.
    const effectiveSecondEntry = secondEntryOverride ?? confirmedSecondEntry;
    setBusy(true);
    setWriteError(null);
    try {
      if (parts === null) {
        // B2677, bug 2 — autosave may already have created this day; "Save"
        // and "Preview →" both land here, and neither may ever POST
        // `day/new` a second time onto its own draft (that is exactly the
        // 409 this used to cause). Once `createdSlug` exists, the same
        // attach+PATCH autosave itself uses finishes the save instead.
        if (createdSlug) {
          const ok = await patchExisting(createdSlug);
          if (!ok) {
            setWriteError({ message: t("studio.day.writeFailed.message") });
            setOutcome("writeFailed");
            return;
          }
          reset();
          router.refresh();
          router.push(writePreviewUrl(username, createdSlug, tripId, date));
          return;
        }
        const result = await writeOnePart({
          content,
          photoIds: chosenPhotos.map((i) => i.id),
          time,
          secondEntry: effectiveSecondEntry,
          withTitleAndExtras: true,
        });
        if (result.ok) {
          setCreatedSlug(result.slug);
          reset();
          // B2549 — the studio's own lists and the trip page have one more day.
          router.refresh();
          // B2677 — "Preview →" now exists; the unsplit day goes straight
          // there instead of the old inline done screen (which only ever
          // stood in for it — see B2676's Build notes, "out of scope here").
          router.push(writePreviewUrl(username, result.slug, tripId, date));
          return;
        }
        if (result.network) {
          // A network error (not a rejection the server actually sent) —
          // B2330 queues the write itself, in order after any of its own
          // photographs still queued as `media.upload` (both created
          // through the same outbox, so replay always sends the photos
          // first). Not `reset()`: see `queueOffline`'s own callers below —
          // the draft is harmless left behind.
          if (hasOutbox()) {
            await queueOffline({ content, photoIds: chosenPhotos.map((i) => i.id), time, secondEntry: effectiveSecondEntry });
            return;
          }
          setWriteError({ message: t("studio.day.writeFailed.message") });
          setOutcome("writeFailed");
          return;
        }
        // B2677, bug 3 — the old full-screen collision takeover is gone; a
        // 409 date_has_day surfaces only as the inline "Add this to it?"
        // card (the same one `day/for-date` already asks ahead of time),
        // never a separate screen.
        if (result.error === "date_has_day" && result.existing) {
          existingAskedFor.current = `${tripId}\u0000${date}`;
          setExistingOnDate(result.existing);
          setConfirmedSecondEntry(false);
          return;
        }
        setWriteError({ message: t("studio.day.writeFailed.message"), mediaProblems: mediaProblemsFrom(result.error, result.detail) });
        setOutcome("writeFailed");
        return;
      }

      // B2676, decision 7 — split: one write per part, in the order the
      // plan gives (the first a second entry only when "Add this to it?"
      // was accepted; every part after it always is, onto the day the
      // first part just created).
      const plan = partCommitPlan(parts, effectiveSecondEntry);
      const slugs: string[] = [];
      for (const step of plan) {
        // B2677, bug 2 — part 0 may already be the day autosave created
        // before the split was accepted (`setParts` never clears
        // `createdSlug`); that part is patched, same as the unsplit path
        // above, never POSTed onto itself a second time.
        if (step.index === 0 && createdSlug) {
          const ok = await patchExisting(createdSlug);
          if (!ok) {
            setWriteError({ message: t("studio.day.writeFailed.message") });
            setOutcome("writeFailed");
            return;
          }
          slugs.push(createdSlug);
          setPartSlugs((prev) => ({ ...prev, 0: createdSlug }));
          continue;
        }
        const part = parts[step.index];
        const result = await writeOnePart({
          content: partWords[step.index] ?? "",
          photoIds: part.ids,
          time: step.time,
          secondEntry: step.secondEntry,
          withTitleAndExtras: step.index === 0,
        });
        if (!result.ok) {
          // B2677, bug 3 — the old full-screen collision takeover is gone;
          // a 409 date_has_day on a later part surfaces as the inline "Add
          // this to it?" card, the same as the unsplit path above.
          if (result.error === "date_has_day" && result.existing) {
            existingAskedFor.current = `${tripId}\u0000${date}`;
            setExistingOnDate(result.existing);
            setConfirmedSecondEntry(false);
            return;
          }
          setWriteError({ message: t("studio.day.writeFailed.message"), mediaProblems: mediaProblemsFrom(result.error, result.detail) });
          setOutcome("writeFailed");
          return;
        }
        slugs.push(result.slug);
        setPartSlugs((prev) => ({ ...prev, [step.index]: result.slug }));
        if (step.index === 0) setCreatedSlug(result.slug);
      }
      reset();
      router.refresh();
      router.push(writePreviewUrl(username, slugs[0], tripId, date));
    } finally {
      setBusy(false);
    }
  }

  // A Save pressed while photographs upload waits for them, then goes.
  useEffect(() => {
    if (!saveQueued || uploading > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the queued save fires once the uploads it waited for are in.
    setSaveQueued(false);
    // B2645 — the photos that just came in can change the day; check again.
    const blocker = !tripId ? "trip" : !date ? "date" : extras.costs.some(lineProblem) ? "cost" : null;
    if (blocker) return setBlockedBy(blocker);
    void commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveQueued, uploading]);

  function save() {
    if (uploading > 0) setSaveQueued(true);
    else void commit();
  }

  // ── background autosave (B2676, decision 2) ──────────────────────────
  // "Check the day silently writes the draft" was the old bug; this is the
  // opposite shape on purpose — the status line always says what actually
  // happened, and this effect is the only thing that makes "Saved" true
  // before anybody presses the button. Debounced ~1.5s, and only once there
  // is a trip and a date to write against. Scoped to the base/unsplit day:
  // split parts 2+ are created together at Save/Preview (Build notes).
  const autosaveSignature = JSON.stringify({
    tripId, date, content, title, place, weatherOn, extras,
    photoIds: chosenPhotos.map((i) => i.id).sort(),
  });
  const lastAutosaved = useRef<string | null>(null);
  useEffect(() => {
    if (parts !== null) return;
    if (!tripId || !date || !online) return;
    // B2677, bug 1 — opening the page is not writing to it: nothing is
    // saved until there are words or a photograph, so a draft nobody typed
    // into is never created just by visiting `/studio/day/new`.
    if (!createdSlug && content.trim() === "" && chosenPhotos.length === 0) return;
    // Waits for the inline "Add this to it?" to be answered — autosaving
    // into a day that already exists, before the owner said yes, would be
    // exactly the collision this ask exists to avoid.
    if (existingOnDate && !confirmedSecondEntry) return;
    if (outcome) return;
    if (lastAutosaved.current === autosaveSignature) return;
    const timer = setTimeout(() => {
      void (async () => {
        setAutosaveState("saving");
        if (!createdSlug) {
          const result = await writeOnePart({
            content,
            photoIds: chosenPhotos.map((i) => i.id),
            time,
            secondEntry: confirmedSecondEntry,
            withTitleAndExtras: true,
          });
          if (!result.ok) {
            setAutosaveState("failed");
            return;
          }
          attachedIdsRef.current = new Set(chosenPhotos.map((i) => i.id));
          setCreatedSlug(result.slug);
          lastAutosaved.current = autosaveSignature;
          setAutosaveState("saved");
          return;
        }
        // Already created — the same attach+PATCH "Save"/"Preview →" use
        // once a draft exists (`patchExisting`), never a second `day/new`.
        const ok = await patchExisting(createdSlug);
        if (ok) {
          lastAutosaved.current = autosaveSignature;
          setAutosaveState("saved");
        } else {
          setAutosaveState("failed");
        }
      })();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveSignature, parts, tripId, date, online, createdSlug, existingOnDate, confirmedSecondEntry, outcome]);

  // The weather chip's own real value, and the day's gallery (B2676) — once
  // the day exists, the server has already tried the weather lookup at
  // creation (`day/new`'s own `fillDayWeatherQuietly`); this reads both back
  // rather than guessing. The gallery is what the receipt sheet needs: a
  // staged photograph's inbox id is not its address once attached, and
  // `src` is the only thing `read-receipt` can be asked about.
  useEffect(() => {
    if (!createdSlug) return;
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/day?trip=${encodeURIComponent(tripId)}&slug=${encodeURIComponent(createdSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok?: boolean; draft?: { weather?: DayWeather; gallery?: { src: string; type: "image" | "video" }[] } } | null) => {
        if (cancelled) return;
        if (json?.draft?.weather) setWeatherReading(json.draft.weather);
        if (json?.draft?.gallery) setGalleryItems(json.draft.gallery);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [createdSlug, weatherAvailable, hasCoords, tripId, username, autosaveState]);

  // ── receipt (B2676) ───────────────────────────────────────────────────
  // Enabled only once the draft is saved and has photos: `read-receipt`
  // needs the photograph already attached to an on-disk entry
  // (`entry.gallery.find(src)`), which is exactly what `createdSlug` plus a
  // non-empty `galleryItems` means.
  const receiptEnabled = !!createdSlug && galleryItems.some((g) => g.type === "image");

  function openReceiptPicker() {
    setReceiptPicking(true);
    setReceiptReading(null);
    setReceiptFailed(false);
    setReceiptAdded(false);
  }

  async function readReceiptFor(src: string) {
    if (!createdSlug) return;
    setReceiptBusyFor(src);
    setReceiptFailed(false);
    setReceiptAdded(false);
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/day/read-receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripId, slug: createdSlug, src }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as
      | { ok?: boolean; receipt?: { amount: number; currency: string; label: string | null } | null }
      | null;
    setReceiptBusyFor(null);
    if (!res?.ok || !json?.receipt) {
      setReceiptFailed(true);
      return;
    }
    setReceiptReading({ src, amount: json.receipt.amount, currency: json.receipt.currency, label: json.receipt.label });
  }

  /** The "suggest" scope (words+photos) gates the read itself, not just the
   *  picker — asked once, the first time this (or any other suggest-backed
   *  feature) is actually used. */
  function pickReceiptPhoto(src: string) {
    setReceiptPicking(false);
    if (missingConsentScopes("suggest", effectiveConsents).length > 0) {
      pendingReceiptSrc.current = src;
      setReceiptConsentAsking(true);
      return;
    }
    void readReceiptFor(src);
  }

  async function agreeReceiptConsent() {
    setReceiptConsentBusy(true);
    const missing = missingConsentScopes("suggest", effectiveConsents);
    for (const scope of missing) {
      // no-refresh: consent is read again by every route that needs it.
      await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      }).catch(() => null);
    }
    setConsentOverride((prev) => ({ ...prev, words: true, photos: true }));
    setReceiptConsentBusy(false);
    setReceiptConsentAsking(false);
    const src = pendingReceiptSrc.current;
    pendingReceiptSrc.current = null;
    if (src) void readReceiptFor(src);
  }

  /** Only this writes — the read above is shown, never kept, until here
   *  (decision 8). Through the same `day/costs` route a person's own
   *  typed-in cost line already uses, and the same "hide this photo from
   *  readers" `PATCH` DayCheck's own receipt flow already made. */
  async function confirmReceiptCost() {
    if (!receiptReading || !createdSlug) return;
    const { src, amount, currency, label } = receiptReading;
    const costLabel = label || t("studio.day.receipt.defaultLabel");
    await fetch(`/api/helper/${encodeURIComponent(username)}/day/costs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripId, slug: createdSlug, label: costLabel, amount, currency }),
    }).catch(() => null);
    await fetch(`/api/helper/${encodeURIComponent(username)}/day`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripId, slug: createdSlug, photoVisibility: { [src]: "private" } }),
    }).catch(() => null);
    setReceiptReading(null);
    setReceiptAdded(true);
  }

  // ── day by voice (B2194) ────────────────────────────────────────────
  function chooseTellBy(choice: TellBy) {
    setTellByNow(choice);
    // Remembered for next time; if this fails the question simply comes back.
    void fetch(`/api/web/${encodeURIComponent(username)}/studio/tell-by`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tellBy: choice }),
    }).catch(() => {});
  }
  /** Leaves the spoken questions for the composer, with what was said (added
   *  after anything already typed, never over it). */
  function toComposer(said?: string) {
    if (said) setContent((prev) => (prev.trim() ? `${prev}\n\n${said}` : said));
    if (said !== undefined) setSpoken(true);
    const q = new URLSearchParams(params.toString());
    q.delete("q");
    q.set("mode", "type");
    router.replace(`${journalPath(username)}/studio/day/new?${q.toString()}`);
  }

  // ── rendering ───────────────────────────────────────────────────────
  // B2330 — offline, "Done" is a hard navigation rather than a soft one: the
  // worker never serves an RSC fetch from its kept cache (`sw.js`'s own
  // `_rsc`/`RSC` early-return, so it never risks answering a soft navigation
  // with a stale build's payload), so a soft `router.push` to a kept page
  // would simply fail with no connection. A full navigation still opens it,
  // from the same kept personal cache the initial visit warmed.
  const toStudio = () => (online ? router.push(`${journalPath(username)}/studio`) : (window.location.href = `${journalPath(username)}/studio`));

  if (outcome === "queued") {
    return (
      <div className="studio-step">
        <DoneScreen username={username} done={t("studio.day.queued.done")} />
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.day.queued.detail")}</p>
        <StepPrimary onClick={toStudio} label={t("studio.day.saved.done")} />
      </div>
    );
  }

  if (outcome === "saved" && createdSlug) {
    const readers = readersByTrip[tripId] ?? [];
    return (
      <div className="studio-step">
        <DoneScreen
          username={username}
          done={
            readers.length > 0
              ? t("studio.day.saved.youAnd", { people: readers.join(", ") })
              : t("studio.day.saved.onlyYou")
          }
        />
        {content.trim() && <p className="mt-4 line-clamp-3 text-sm text-ink-body">{content}</p>}
        <Link
          href={`${journalPath(username)}/studio/day/publish?day=${encodeURIComponent(createdSlug)}&trip=${encodeURIComponent(tripId)}`}
          className={`mt-4 inline-flex items-center ${LINK}`}
        >
          {t("studio.day.saved.share")}
        </Link>
        <StepPrimary onClick={toStudio} label={t("studio.day.saved.done")} />
      </div>
    );
  }

  // B2677, bug 3 — the old full-screen collision takeover ("Two days on
  // one date is almost never what somebody means…") is gone. A 409
  // date_has_day now only ever surfaces as the inline "Add this to it?"
  // card below, the same one `day/for-date` already asks ahead of time.

  if (outcome === "writeFailed") {
    return (
      <div className="studio-step mt-4">
        <SubmitError message={`${t("studio.day.writeFailed.banner")} ${writeError?.message ?? ""}`} />
        {/* B2184 — plain sentences, one per file; never the problem object itself. */}
        {writeError?.mediaProblems && writeError.mediaProblems.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-coral-600">
            {writeError.mediaProblems.map((p) => (
              <li key={p.field}>{mediaProblemSentence(p, t)}</li>
            ))}
          </ul>
        )}
        <StepPrimary onClick={() => setOutcome(null)} label={t("studio.day.writeFailed.back")} />
      </div>
    );
  }

  if (askTellBy) return <TellByChoice onChoose={chooseTellBy} />;
  if (speaking && speech) {
    const fact = chosenPhotos.find((i) => i.location)?.location;
    return (
      <SpeakFlow
        username={username}
        date={date}
        speech={speech}
        photoFact={fact ? { count: chosenPhotos.filter((i) => i.location === fact).length, place: fact } : null}
        onDone={toComposer}
        onType={() => toComposer()}
      />
    );
  }

  // First run shows one part at a time; everyone else sees the whole page —
  // and so does somebody who has just told the day by voice.
  const part = firstRun && !spoken ? step : null;
  const show = (p: (typeof FIRST_RUN)[number]) => part === null || part === p || part === "save";

  const written = writtenDatesByTrip[tripId] ?? [];
  const pickDate = (d: string) => {
    setConfirmedSecondEntry(false);
    setMismatchKept(false);
    setDateOverride(d);
  };
  const split = splitDayPhotos(inboxItems ?? [], date, new Set([...selectedIds, ...ownIds]));
  const dayPhotos = split.own;
  const waitingPhotos = split.others;
  // B2646 — the route's place suggestion, shown once: inside the place
  // panel while it is open, as its own card otherwise.
  const suggestionCard = placeSuggestion && !placeSuggestionDismissed && placeEmpty ? (
            <div className="mt-3 rounded-xl border border-action-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm text-ink-body">
                {t("studio.day.where.suggestion.body", { name: placeSuggestion.name, country: placeSuggestion.country })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={acceptPlaceSuggestion} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-raised">
                  {t("studio.day.where.suggestion.use")}
                </button>
                <button type="button" onClick={() => setPlaceSuggestionDismissed(true)} className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink-secondary">
                  {t("studio.day.where.suggestion.dismiss")}
                </button>
              </div>
            </div>
  ) : null;
  const shownPhotos = showAllPhotos ? dayPhotos : dayPhotos.slice(0, 8);
  const tile = (item: InboxMediaItem) => {
    const on = selectedIds.includes(item.id);
    // B2330 — a photo picked while offline has no server thumbnail yet; its
    // own local object URL (the exact file it will upload) stands in.
    const pendingUrl = pendingPhotoUrls[item.id];
    return (
      <li key={item.id}>
        <button
          type="button"
          data-photo={item.filename}
          aria-pressed={on}
          aria-label={pendingUrl ? `${item.filename} — ${t("studio.day.photos.pendingUpload")}` : item.filename}
          onClick={() => toggleSelected(item.id)}
          className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-surface-subtle ${on ? "border-action-strong" : "border-transparent opacity-50"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- an owner-only route, not an optimisable asset */}
          <img
            src={pendingUrl ?? `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(item.id)}/thumbnail?w=200`}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          {pendingUrl && (
            <span className="absolute inset-x-0 bottom-0 truncate bg-surface-raised/90 px-1 py-0.5 text-[10px] font-semibold text-ink-body">
              {t("studio.day.photos.pendingUpload")}
            </span>
          )}
        </button>
      </li>
    );
  };

  // B2676, decision 2 — the status line says the truth, never "writes
  // silently" (P-whatever the collision screen's old wording was): what has
  // actually happened on the server, not what the button is about to do.
  const saveStateKey = !online
    ? "studio.day.status.offline"
    : uploading > 0
      ? "studio.day.status.uploading"
      : autosaveState === "saving"
        ? "studio.day.status.saving"
        : createdSlug
          ? "studio.day.status.saved"
          : "studio.day.status.notSaved";
  const saveStateText =
    saveStateKey === "studio.day.status.uploading" ? tn(saveStateKey, uploading, { count: String(uploading) }) : t(saveStateKey);

  return (
    <StepBody step={part ?? "page"}>
      {/* B2677, bug 4 — `GroupMark` on `StudioPage` already names this group
          ("Write"); the status row says only what has actually happened. */}
      {show("save") && (
        <div className="flex items-center justify-end">
          <span data-save-state className="font-mono text-xs text-ink-secondary">
            {saveStateText}
          </span>
        </div>
      )}
      {restoredFrom && dirty && (
        <p className="mt-2 rounded-xl bg-surface-subtle px-4 py-2 text-sm text-ink-body">
          {t("studio.day.resume.title")}. {t("studio.day.resume.expiresAt", { date: formatLongDate(addDayExpiresOn(restoredFrom)) })}{" "}
          <button type="button" onClick={startOver} className="font-semibold underline underline-offset-2">
            {t("studio.day.resume.startNew")}
          </button>
        </p>
      )}

      {part && (
        <div className="mt-4">
          <StepIndicator total={total} current={index + 1} label={t("studio.day.firstRun.stepLabel", { current: String(index + 1), total: String(total) })} />
        </div>
      )}

      {show("save") && (
        <>
          {/* The day itself: trip, day number, date and where the date came from. */}
          <button
            type="button"
            data-chip="date"
            aria-expanded={sheet === "date"}
            onClick={() => setSheet(sheet === "date" ? null : "date")}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface-raised px-4 py-3 text-left hover:bg-surface-subtle"
          >
            <CalendarDays aria-hidden className="h-5 w-5 flex-none text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-strong">
                {dayNumber ? t("studio.day.chip.dayOf", { trip: trip?.title ?? "", n: String(dayNumber) }) : (trip?.title ?? "")}
              </span>
              <span className={`block text-xs ${date ? "text-ink-secondary" : "font-semibold text-ink-strong"}`}>
                {date
                  ? `${formatLongDate(date, { year: true })} · ${dateSource}`
                  : chosenPhotos.length > 0 && !chosenPhotos.some((i) => i.id in pendingPhotoUrls)
                    ? tn("studio.day.date.noDateInPhoto", chosenPhotos.length)
                    : t("studio.day.date.ask")}
              </span>
            </span>
          </button>
          {/* B2676, decision 4 — "Add this to it?" inline, the moment the
              date is known to already carry a day — never the full-screen
              takeover the server's own 409 (below) still falls back to. */}
          {existingOnDate && !confirmedSecondEntry && (
            <div data-existing-on-date className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm text-ink-body">
                {t("studio.day.existing.banner", { date: formatLongDate(date), title: existingOnDate.title || t("studio.day.collision.untitled") })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmedSecondEntry(true)}
                  className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action"
                >
                  {t("studio.day.existing.yes")}
                </button>
                <button type="button" onClick={() => setSheet("date")} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong">
                  {t("studio.day.existing.no")}
                </button>
              </div>
            </div>
          )}
          {/* B2645 — a photo with no date in it: ask, with today one tap away
              when today is inside the trip. Nothing is filled in by itself. */}
          {!date && (
            <div data-date-ask className="mt-2 flex flex-wrap gap-2">
              {proposedToday && (
                <button
                  type="button"
                  onClick={() => {
                    pickDate(proposedToday);
                    setSheet(null);
                  }}
                  className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action">
                  {t("studio.day.date.useToday", { date: formatLongDate(proposedToday) })}
                </button>
              )}
              {sheet !== "date" && (
                <button type="button" onClick={() => setSheet("date")} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong">
                  {t("studio.day.date.pick")}
                </button>
              )}
            </div>
          )}
          {sheet === "date" && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{t("studio.day.sheet.notRight")}</p>
              {/* B2676 — the trip select is always here, even with one trip
                  (it used to hide then): "+ New trip…" has nowhere else to
                  be reached from this sheet otherwise. The draft (words
                  included) is kept in sessionStorage regardless, so a trip
                  made and returned from picks up exactly where this was
                  left — nothing here needs to pass it along by hand. */}
              <label className={`mt-3 ${LABEL}`}>
                {t("studio.day.decide.row.trip")}
                <select
                  value={tripId}
                  onChange={(e) => {
                    if (e.target.value === NEW_TRIP_OPTION) {
                      router.push(`${journalPath(username)}/studio/trip/new`);
                      return;
                    }
                    setTripOverride(e.target.value);
                  }}
                  className={`${FIELD} rounded-full`}
                >
                  {trips.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.title}
                    </option>
                  ))}
                  <option value={NEW_TRIP_OPTION}>{t("studio.day.decide.newTrip")}</option>
                </select>
              </label>
              <span className={`mt-3 ${LABEL}`}>{t("studio.day.which.dateLabel")}</span>
              <DayStrip value={date} onChange={pickDate} start={trip?.start ?? todayIso} end={todayIso} writtenDates={written} pendingDates={pendingDates} />
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink-body underline underline-offset-2">
                  {t("studio.day.which.anotherDate")}
                </summary>
                <MonthGrid value={date} onChange={pickDate} min={trip?.start ?? ""} max={todayIso} band={trip} writtenDates={written} />
              </details>
              <button type="button" onClick={() => setSheet(null)} className={`mt-2 ${LINK}`}>
                {t("studio.day.sheet.close")}
              </button>
            </div>
          )}
        </>
      )}

      {show("photos") && (
        <div className="mt-4">
          {part === "photos" && <p className="mb-2 text-base text-ink-body">{t("studio.day.firstRun.photos")}</p>}
          {inboxItems === null && <p className="text-sm text-ink-secondary">{t("studio.day.photos.loading")}</p>}
          {/* B2676 — the big empty-state tile, the Write page's own first
              photo-adding door (acceptance: "the empty tile"). */}
          {inboxItems !== null && dayPhotos.length === 0 && (
            <button
              type="button"
              onClick={() => openPhotoSheet("day")}
              className="flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-ink-strong"
            >
              <span aria-hidden className="text-2xl leading-none">＋</span>
              <span className="font-semibold">{t("studio.day.photos.add")}</span>
            </button>
          )}
          {inboxItems !== null && inboxItems.length > 0 && (
            <>
              <p className="mb-2 text-sm text-ink-secondary">
                {t("studio.day.photos.chosen", { count: String(chosenPhotos.length) })}
              </p>
              <ul className="grid grid-cols-4 gap-1.5">
                {dayPhotos.length > 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => openPhotoSheet("day")}
                      aria-label={t("studio.day.photos.add")}
                      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong text-xs font-semibold text-ink-strong"
                    >
                      <span aria-hidden className="text-lg leading-none">＋</span>
                      {t("studio.day.photos.add")}
                    </button>
                  </li>
                )}
                {shownPhotos.map(tile)}
                {!showAllPhotos && dayPhotos.length > 8 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setShowAllPhotos(true)}
                      className="flex aspect-square w-full items-center justify-center rounded-lg border border-line-strong text-sm font-semibold text-ink-strong"
                    >
                      +{dayPhotos.length - 8}
                    </button>
                  </li>
                )}
              </ul>
              {waitingPhotos.length > 0 && (
                <details data-waiting-photos className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-ink-body underline underline-offset-2">
                    {t("studio.day.photos.moreWaiting", { count: String(waitingPhotos.length) })}
                  </summary>
                  <ul className="mt-2 grid grid-cols-4 gap-1.5">{waitingPhotos.map(tile)}</ul>
                </details>
              )}
            </>
          )}
          {/* B2677, bug 5 — the redundant "Choose files" button is gone;
              the "＋ Add photos" tile above opens the sheet, whose own
              This phone tab (`PhotoPicker`) covers it. */}
          {uploading > 0 && (
            <p className="mt-1 text-sm text-ink-secondary">{tn("studio.day.photos.uploadingCount", uploading, { count: String(uploading) })}</p>
          )}
          {uploadError && (
            <p role="alert" className="mt-1 text-sm text-coral-600">
              {uploadError}
            </p>
          )}

          {mismatched.length > 0 && !mismatchKept && (
            <div className="mt-3 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-body">
              <p>{tn("studio.day.mismatch.banner", mismatched.length, { count: String(mismatched.length), date: formatLongDate(date) })}</p>
              <div className="mt-2 flex flex-col items-start">
                <button type="button" onClick={() => setMismatchKept(true)} className={LINK}>
                  {t("studio.day.mismatch.keepAll", { date: formatLongDate(date) })}
                </button>
                <button type="button" onClick={() => pickDate(mismatched[0].takenAt!.slice(0, 10))} className={LINK}>
                  {t("studio.day.mismatch.moveDay")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds((prev) => prev.filter((id) => !mismatched.some((m) => m.id === id)))}
                  className={LINK}
                >
                  {t("studio.day.mismatch.leaveOut")}
                </button>
                {photoDays > 1 && (
                  <Link href={`${journalPath(username)}/studio#waiting`} className={`inline-flex items-center ${LINK}`}>
                    {tn("studio.day.mismatch.split", photoDays, { count: String(photoDays) })}
                  </Link>
                )}
              </div>
            </div>
          )}
          {part === "photos" && (
            <StepPrimary onClick={() => go("words")} label={t("studio.day.firstRun.toWords")} />
          )}
        </div>
      )}

      {show("save") && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {placeLabel || hasCoords ? (
              <button type="button" data-chip="place" aria-expanded={sheet === "place"} onClick={() => setSheet(sheet === "place" ? null : "place")} className={CHIP}>
                <MapPin aria-hidden className="h-4 w-4 flex-none text-ink-secondary" />
                <span>{placeLabel || t("studio.day.chip.position", { lat: place.lat!.toFixed(3), lng: place.lng!.toFixed(3) })}</span>
                <small className="text-xs text-ink-secondary">
                  {placeEdited ? t("studio.day.source.chosen") : t("studio.day.source.photos")}
                </small>
              </button>
            ) : (
              <button type="button" data-chip="place" aria-expanded={sheet === "place"} onClick={() => setSheet(sheet === "place" ? null : "place")} className={CHIP}>
                <MapPin aria-hidden className="h-4 w-4 flex-none text-ink-secondary" />
                <span>{t("studio.day.chip.addPlace")}</span>
              </button>
            )}
            {weatherAvailable && hasCoords && date && (
              <button type="button" data-chip="weather" aria-expanded={sheet === "weather"} onClick={() => setSheet(sheet === "weather" ? null : "weather")} className={CHIP}>
                <CloudSun aria-hidden className="h-4 w-4 flex-none text-ink-secondary" />
                {/* B2676 — the real looked-up value once there is one, never
                    the generic "Weather" label. */}
                <span>{weatherReading ? weatherChipLabel(weatherReading) : t("studio.day.chip.weather")}</span>
                <small className="text-xs text-ink-secondary">
                  {weatherOn ? t("studio.day.source.weather") : t("studio.day.source.weatherOff")}
                </small>
              </button>
            )}
          </div>

          {sheet !== "place" && suggestionCard}

          {sheet === "place" && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              {suggestionCard}
              <p className="mt-2 text-sm font-semibold text-ink-strong">{t("studio.day.sheet.notRight")}</p>
              {addressLookupAvailable ? (
                <div className="relative mt-3">
                  <label className={LABEL} htmlFor="studio-day-place-search">
                    {t("studio.day.where.placeLabel")}
                  </label>
                  <input
                    id="studio-day-place-search"
                    type="text"
                    role="combobox"
                    aria-expanded={placeResults.length > 0}
                    aria-controls="studio-day-place-results"
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    className={FIELD}
                  />
                  {placeResults.length > 0 && (
                    <ul id="studio-day-place-results" role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line-quiet bg-surface-raised shadow-lg">
                      {placeResults.map((candidate, i) => (
                        <li key={`${candidate.displayName}-${i}`} role="option" aria-selected={false}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickPlace(candidate)}
                            className="block w-full px-4 py-2 text-left text-base hover:bg-surface-subtle"
                          >
                            {candidate.displayName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {placeSearchFailed && <p className="mt-1 text-xs text-ink-secondary">{t("studio.day.where.searchUnavailable")}</p>}
                </div>
              ) : (
                <>
                  <label className={`mt-3 ${LABEL}`}>
                    {t("studio.day.where.placeLabel")}
                    <input type="text" name="location" value={place.location} onChange={(e) => editPlaceText({ location: e.target.value })} className={FIELD} />
                  </label>
                  <label className={`mt-3 ${LABEL}`}>
                    {t("studio.day.where.countryLabel")}
                    <input type="text" name="country" value={place.country} onChange={(e) => editPlaceText({ country: e.target.value })} className={FIELD} />
                  </label>
                </>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4">
                <button type="button" onClick={() => setSheet(null)} className={LINK}>
                  {t("studio.day.sheet.close")}
                </button>
                {(placeLabel || hasCoords) && (
                  <button type="button" onClick={removePlace} className={LINK}>
                    {t("studio.day.sheet.leaveOut")}
                  </button>
                )}
              </div>
            </div>
          )}

          {sheet === "weather" && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm text-ink-body">{t("studio.day.sheet.weatherBody")}</p>
              <div className="mt-2 flex flex-wrap gap-x-4">
                <button type="button" onClick={() => setSheet(null)} className={LINK}>
                  {t("studio.day.sheet.close")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWeatherOn(!weatherOn);
                    setSheet(null);
                  }}
                  className={LINK}
                >
                  {weatherOn ? t("studio.day.sheet.leaveOut") : t("studio.day.sheet.lookItUp")}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {show("words") && (
        <div className="mt-4">
          {offerSplitHere && (
            <div className="mb-4 rounded-2xl border border-line-strong bg-surface-raised p-4">
              <h2 className="font-display text-lg font-semibold text-ink-strong">
                {tn("studio.flow.splitTitle", splitCandidate.length, { count: String(splitCandidate.length) })}
              </h2>
              <ol className="mt-2 space-y-1 text-sm text-ink-body">
                {splitCandidate.map((p, i) => (
                  <li key={i}>
                    {tn("studio.flow.partLine", p.ids.length, {
                      index: String(i + 1),
                      range: [p.from, p.to].filter(Boolean).join("–") || "—",
                      count: String(p.ids.length),
                    })}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-ink-secondary">{t("studio.flow.splitWhy")}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={SPLIT_SECONDARY} onClick={() => setSplitDismissedFor(chosenSignature)}>
                  {t("studio.flow.splitNo")}
                </button>
                <button type="button" className={SPLIT_PRIMARY} onClick={() => {
                    // B2676 — split in place: no second mounted composer,
                    // no parent to hand the choice to. Words already typed
                    // ride into part 1, visibly (decision 7).
                    setParts(splitCandidate);
                    setPartWords(splitCandidate.map((_, i) => (i === 0 ? content : "")));
                    setContent("");
                    setSplitDismissedFor(null);
                  }}>
                  {tn("studio.flow.splitYes", splitCandidate.length, { count: String(splitCandidate.length) })}
                </button>
              </div>
            </div>
          )}
          {parts === null ? (
            <>
              <label htmlFor="studio-day-words" className={part === "words" ? "block font-display text-lg font-semibold text-ink-strong" : LABEL}>
                {t("studio.day.whatHappened.heading")}
              </label>
              <div className="relative mt-1">
                <textarea
                  id="studio-day-words"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("studio.day.text.placeholder")}
                  className={`block min-h-32 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-base text-ink-body ${speech ? "pr-14" : ""}`}
                />
                {speech && (
                  <RecordButton
                    username={username}
                    consented={speech.consented}
                    provider={speech.provider}
                    compact
                    hold={false}
                    onText={(said) => setContent((prev) => (prev ? `${prev} ${said}` : said))}
                  />
                )}
              </div>
              <p className="mt-1 text-xs text-ink-secondary">{t("studio.day.whatHappened.nothingInvented")}</p>
              <RatherTalk username={username} speech={speech} tellBy={tellByNow} />
              {/* B2190 — "Polish my text", directly under the box it rewrites. */}
              <PolishText
                username={username}
                trip={tripId}
                text={content}
                onUse={setContent}
                aiAvailable={polishAiAvailable}
              />
            </>
          ) : (
            // B2676, decision 7 — every part stacked on this same page, each
            // with its own photos, words and mic. "Keep as one" reverses it,
            // folding whatever part 1 holds back into the single box.
            <div data-day-parts className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-strong">
                  {tn("studio.day.parts.count", parts.length, { count: String(parts.length) })}
                </span>
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setContent(partWords[0] ?? "");
                    setParts(null);
                    setPartWords([]);
                  }}
                >
                  {t("studio.day.parts.keepAsOne")}
                </button>
              </div>
              {parts.map((p, i) => {
                const partPhotos = chosenPhotos.filter((item) => p.ids.includes(item.id));
                const range = [p.from, p.to].filter(Boolean).join("–");
                return (
                  <div key={i} className="rounded-2xl border border-line-strong bg-surface-raised p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink-strong">
                        {t("studio.flow.partHeading", { index: String(i + 1), total: String(parts.length) })}
                      </span>
                      {range && <span className="text-xs text-ink-secondary">{range}</span>}
                    </div>
                    <ul className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                      {partPhotos.map(tile)}
                      <li>
                        <button
                          type="button"
                          onClick={() => openPhotoSheet(i)}
                          className="flex aspect-square w-16 flex-none flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong text-xs font-semibold text-ink-strong"
                        >
                          <span aria-hidden className="text-lg leading-none">＋</span>
                          {t("studio.day.photos.add")}
                        </button>
                      </li>
                    </ul>
                    <div className="relative mt-2">
                      <textarea
                        value={partWords[i] ?? ""}
                        onChange={(e) => setPartWords((prev) => prev.map((w, idx) => (idx === i ? e.target.value : w)))}
                        placeholder={t("studio.day.text.placeholder")}
                        className={`block min-h-24 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-base text-ink-body ${speech ? "pr-14" : ""}`}
                      />
                      {speech && (
                        <RecordButton
                          username={username}
                          consented={speech.consented}
                          provider={speech.provider}
                          compact
                          hold={false}
                          onText={(said) =>
                            setPartWords((prev) => prev.map((w, idx) => (idx === i ? (w ? `${w} ${said}` : said) : w)))
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-ink-secondary">{t("studio.day.whatHappened.nothingInvented")}</p>
            </div>
          )}
          {part === "words" && <StepPrimary onClick={() => go("save")} label={t("studio.day.firstRun.toSave")} />}
        </div>
      )}

      {show("save") && (
        <>
          <details
            className="mt-4 rounded-xl border border-line-strong px-4 py-2"
            open={detailsOpen}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              if (open !== detailsOpen) toggleDetails(open);
            }}
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink-strong">{t("studio.day.details.summary")}</span>
              <span className="text-xs text-ink-secondary">{t("studio.day.details.hint")}</span>
            </summary>
            {/* B2647 — title and time on one row, the time a fixed narrow column. */}
            <div className="mt-2 mb-2 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
              <label className={`min-w-0 ${LABEL}`}>
                {t("studio.day.whatHappened.titleLabel")}
                <input
                  type="text"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("studio.day.whatHappened.titlePlaceholder")}
                  className={FIELD}
                />
              </label>
              <label className={`min-w-0 ${LABEL}`}>
                {t("studio.day.field.time")}
                <input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className={TIME_FIELD} />
              </label>
            </div>
            {/* B2233 — costs, how you travelled, tags; blank stays blank.
                Mounted only while open: the collapsed page has no dropdown. */}
            {detailsOpen && (
              <div className="mb-3">
                {/* B2677, bug 7 — tags moved to Preview; Write keeps only
                    title, time, costs and travel. */}
                <DayExtras value={extras} onChange={setExtras} currencies={currencies} routeTravel={routeTravel} showTags={false} />
                {/* B2676 — "📷 From a receipt", in the Costs section: absent
                    with `helper` off (AGENTS.md: absent, not broken), and
                    enabled only once the draft is saved and has photos
                    (`read-receipt` needs the photograph already on an
                    on-disk entry). */}
                {helperOn && (
                <div className="mt-2">
                  {receiptEnabled ? (
                    <button type="button" onClick={openReceiptPicker} className={LINK}>
                      {t("studio.day.receipt.cta")}
                    </button>
                  ) : (
                    <p className="text-xs text-ink-secondary">{t("studio.day.receipt.needsSave")}</p>
                  )}
                  {receiptPicking && (
                    <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle p-3">
                      <p className="text-sm font-semibold text-ink-strong">{t("studio.day.receipt.pick")}</p>
                      <ul className="mt-2 grid grid-cols-4 gap-1.5">
                        {galleryItems
                          .filter((g) => g.type === "image")
                          .map((g) => (
                            <li key={g.src}>
                              <button
                                type="button"
                                onClick={() => pickReceiptPhoto(g.src)}
                                className="block aspect-square w-full overflow-hidden rounded-lg border border-line-strong"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- an owner-only route, not an optimisable asset */}
                                <img src={`${g.src}?w=160`} alt="" className="h-full w-full object-cover" />
                              </button>
                            </li>
                          ))}
                      </ul>
                      <button type="button" onClick={() => setReceiptPicking(false)} className={`mt-2 ${LINK}`}>
                        {t("studio.day.sheet.close")}
                      </button>
                    </div>
                  )}
                  {receiptConsentAsking && (
                    <div className="mt-2">
                      <ConfirmPanel
                        label={t("studio.day.receipt.consentTitle")}
                        question={t("studio.day.receipt.consentBody", { words: providers.words })}
                        confirmLabel={t("studio.day.receipt.consentAgree")}
                        busy={receiptConsentBusy}
                        onConfirm={() => void agreeReceiptConsent()}
                        onCancel={() => {
                          setReceiptConsentAsking(false);
                          pendingReceiptSrc.current = null;
                        }}
                      />
                    </div>
                  )}
                  {receiptBusyFor && <p className="mt-2 text-sm text-ink-secondary">{t("studio.day.receipt.reading")}</p>}
                  {receiptFailed && <p role="alert" className="mt-2 text-sm text-coral-600">{t("studio.day.receipt.failed")}</p>}
                  {receiptReading && (
                    <div className="mt-2 rounded-xl border border-dashed border-line-strong bg-surface-subtle p-3">
                      <p className="text-sm text-ink-body">
                        {t("studio.day.receipt.read", {
                          label: receiptReading.label || t("studio.day.receipt.defaultLabel"),
                          amount: String(receiptReading.amount),
                          currency: receiptReading.currency,
                        })}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void confirmReceiptCost()} className={SPLIT_PRIMARY}>
                          {t("studio.day.receipt.addCost")}
                        </button>
                        <button type="button" onClick={() => setReceiptReading(null)} className={SPLIT_SECONDARY}>
                          {t("studio.day.receipt.wrong")}
                        </button>
                      </div>
                    </div>
                  )}
                  {receiptAdded && <p className="mt-2 text-sm text-ink-body">{t("studio.day.receipt.added")}</p>}
                </div>
                )}
              </div>
            )}
          </details>
          {blockedBy && blockedBy === (!tripId ? "trip" : !date ? "date" : extras.costs.some(lineProblem) ? "cost" : null) && (
            <p role="alert" className="mt-3 text-sm font-semibold text-coral-600">
              {t(blockedBy === "trip" ? "studio.day.blocked.trip" : blockedBy === "date" ? "studio.day.date.ask" : "studio.day.extras.costIncomplete")}
            </p>
          )}
          <StepPrimary
            busy={busy || saveQueued}
            busyLabel={saveQueued ? tn("studio.day.saveWaiting", uploading, { count: String(uploading) }) : t("studio.day.saveBusy")}
            tone="bg-yellow-400 text-yellow-950"
            // B2645 — never a dead tap: what is still missing is opened,
            // scrolled to and named instead.
            onClick={() => {
              const blocker = !tripId ? "trip" : !date ? "date" : extras.costs.some(lineProblem) ? "cost" : null;
              setBlockedBy(blocker);
              if (!blocker) return save();
              if (blocker === "cost") setDetailsOpen(true);
              else setSheet("date");
              requestAnimationFrame(() => {
                const target = document.querySelector<HTMLElement>(blocker === "cost" ? "[data-cost-line]" : '[data-chip="date"]');
                target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
                if (blocker !== "cost") target?.focus();
              });
            }}
            label={t("studio.day.previewCta")}
          />
        </>
      )}

      {/* B2676 — the one "＋ Add photos" sheet, opened from the strip, the
          empty tile or a part's own "＋ Add". Three tabs: Waiting (this
          page's own inbox grouped by day, a deferred multi-select), This
          phone (`PhotoPicker`) and Camera (its own capture input) — the
          latter two upload and select immediately. */}
      {photoSheetTarget !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("studio.day.photos.add")}
          className="fixed inset-0 z-30 flex items-end bg-ink-strong/40"
          onClick={() => setPhotoSheetTarget(null)}
        >
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-surface-raised p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.day.photos.add")}</h2>
              <span className="text-sm text-ink-secondary">
                {typeof photoSheetTarget === "number" && parts
                  ? t("studio.day.photos.addToPart", {
                      part: (() => {
                        const tod = partTimeOfDay(parts[photoSheetTarget]?.from ?? null);
                        return tod ? t(`studio.day.timeOfDay.${tod}`) : t("studio.day.timeOfDay.generic");
                      })(),
                    })
                  : t("studio.day.photos.addToDay")}
              </span>
            </div>

            <div role="tablist" className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-surface-subtle p-1">
              {(["waiting", "device", "camera"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={photoSheetTab === tab}
                  onClick={() => setPhotoSheetTab(tab)}
                  className={`min-h-10 rounded-lg text-sm font-semibold ${photoSheetTab === tab ? "bg-surface-raised text-ink-strong shadow-sm" : "text-ink-secondary"}`}
                >
                  {t(`studio.day.photos.tab.${tab}`)}
                </button>
              ))}
            </div>

            {photoSheetTab === "waiting" && (
              <div className="mt-3">
                {(() => {
                  const groups = waitingGroups();
                  if (groups.length === 0) return <p className="text-sm text-ink-secondary">{t("studio.day.photos.nonePendingYet")}</p>;
                  return groups.map((group) => (
                    <div key={group.date ?? "undated"} className="mt-3 first:mt-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                        {group.date === date
                          ? t("studio.day.photos.groupThisDay")
                          : group.date
                            ? formatLongDate(group.date)
                            : t("studio.day.photos.groupUndated")}
                      </p>
                      <ul className="mt-1.5 grid grid-cols-4 gap-1.5">
                        {group.items.map((item) => {
                          const on = sheetPicked.has(item.id);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                data-photo={item.filename}
                                aria-pressed={on}
                                aria-label={item.filename}
                                onClick={() => toggleSheetPicked(item.id)}
                                className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-surface-subtle ${on ? "border-action-strong" : "border-transparent opacity-60"}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- an owner-only route, not an optimisable asset */}
                                <img
                                  src={`/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(item.id)}/thumbnail?w=200`}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-cover"
                                />
                                {on && (
                                  <span aria-hidden className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-action-strong text-xs text-on-action">
                                    ✓
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ));
                })()}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={sheetPicked.size === 0}
                    onClick={confirmPhotoSheetPicks}
                    className="min-h-11 flex-1 rounded-full bg-action-strong px-4 text-base font-semibold text-on-action disabled:opacity-50"
                  >
                    {sheetPicked.size > 0
                      ? tn("studio.day.photos.addN", sheetPicked.size, { count: String(sheetPicked.size) })
                      : t("studio.day.photos.choose")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoSheetTarget(null)}
                    className="min-h-11 rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong"
                  >
                    {t("studio.day.sheet.cancel")}
                  </button>
                </div>
              </div>
            )}

            {photoSheetTab === "device" && (
              <div className="mt-3">
                <PhotoPicker id="studio-day-photo-sheet-device" chosen={[]} accept="image/*,video/*" onPick={pickFromDevice} showChosen={false} />
                {uploading > 0 && (
                  <p className="mt-1 text-sm text-ink-secondary">{tn("studio.day.photos.uploadingCount", uploading, { count: String(uploading) })}</p>
                )}
                {/* B2677, bug 6 — every tab needs its own way out, not only
                    a tap on the backdrop. */}
                <button
                  type="button"
                  onClick={() => setPhotoSheetTarget(null)}
                  className="mt-3 min-h-11 rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong"
                >
                  {t("studio.day.sheet.cancel")}
                </button>
              </div>
            )}

            {photoSheetTab === "camera" && (
              <div className="mt-3">
                <label className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full bg-action-strong px-4 text-base font-semibold text-on-action">
                  {t("studio.day.photos.openCamera")}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      void pickFromDevice(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploading > 0 && (
                  <p className="mt-1 text-sm text-ink-secondary">{tn("studio.day.photos.uploadingCount", uploading, { count: String(uploading) })}</p>
                )}
                <button
                  type="button"
                  onClick={() => setPhotoSheetTarget(null)}
                  className="mt-3 min-h-11 w-full rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong"
                >
                  {t("studio.day.sheet.cancel")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </StepBody>
  );
}
