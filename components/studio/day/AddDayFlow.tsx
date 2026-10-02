"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CloudSun, MapPin } from "lucide-react";
import { PhotoPicker } from "@/components/PhotoPicker";
import RecordButton from "@/components/RecordButton";
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
import { splitIntoParts, type DayPart } from "@/lib/studio/dayParts";
import { partCommitPlan, titleCollidesWithExisting } from "@/lib/studio/dayCollision";
import { writePreviewUrl } from "@/lib/studio/previewUrl";
import { weatherGroup, type DayWeather } from "@/lib/weather";

import { journalPath } from "@/lib/journalPath";
/** First-run mode (B2188, owner decision D1 "C inside A"): the same page,
 *  revealed one part at a time for somebody who has no day yet. The one-page
 *  mode never calls `go`, so these steps only ever mean something there. */
const FIRST_RUN = ["photos", "words", "save"] as const;
/** The trip `<select>`'s own "+ New trip…" row — never a real trip id, so
 *  it can never collide with one. */
const NEW_TRIP_OPTION = "__new__";
type Outcome = "collision" | "saved" | "writeFailed" | "queued";
type Sheet = "date" | "place" | "weather" | null;

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
  const [collision, setCollision] = useState<ExistingDayOnDate | null>(null);
  const [time, setTime] = useState("");
  const [confirmedSecondEntry, setConfirmedSecondEntry] = useState(false);
  // B2676, decision 4 — the date already has a day, asked about inline
  // rather than only discovered by a 409 at write time. `GET day/for-date`
  // is asked once per (trip, date); the server's own check at write time
  // (`collision`/`outcome === "collision"` below) stays the real guard for
  // the race case.
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

  const [inboxItems, setInboxItems] = useState<InboxMediaItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const photosInit = useRef(false);
  // B2232 — brought in for this day: a card's photographs, this visit's uploads.
  const [ownIds, setOwnIds] = useState<string[]>([]);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  // B2676 — the one "＋ Add photos" sheet, opened from the strip's own first
  // tile, the empty-state tile, or a part's own "＋ Add"; `"day"` is the
  // unsplit day, a number is that part's index. Picking from what is
  // waiting goes straight through the existing `toggleSelected`/`tile()`
  // this page already had; a part's own `ids` picks up a newly-chosen
  // photograph through the effect below, keyed off `selectedIds` growing
  // while the sheet is open for it.
  // B2677 — "＋ Add photos" on Preview links back here with `&add=photos` so
  // its own photo sheet opens over Write rather than Write opening blank; a
  // lazy initial value rather than a mount effect, since this never needs to
  // react to the param changing after the page has already opened.
  const [photoSheetTarget, setPhotoSheetTarget] = useState<"day" | number | null>(() => (params.get("add") === "photos" ? "day" : null));
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
      setInboxItems((prev) => mergeById(prev ?? [], items));
      setSelectedIds((prev) => [...new Set([...prev, ...items.map((i) => i.id)])]);
      setOwnIds((prev) => [...prev, ...items.map((i) => i.id)]);
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
      setPendingPhotoUrls((prev) => ({ ...prev, ...urls }));
      setInboxItems((prev) => mergeById(prev ?? [], placeholders));
      setSelectedIds((prev) => [...new Set([...prev, ...placeholders.map((i) => i.id)])]);
      setOwnIds((prev) => [...prev, ...placeholders.map((i) => i.id)]);
    } finally {
      setUploading((u) => u - n);
    }
  }

  function openPhotoSheet(target: "day" | number) {
    selectedIdsAtSheetOpen.current = selectedIds;
    setPhotoSheetTarget(target);
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

  function editPlace(next: { location?: string; country?: string }) {
    if (!placeEdited) {
      setLocation(place.location);
      setCountry(place.country);
      setLat(place.lat);
      setLng(place.lng);
      setPlaceEdited(true);
    }
    if (next.location !== undefined) setLocation(next.location);
    if (next.country !== undefined) setCountry(next.country);
  }
  function removePlace() {
    setPlaceEdited(true);
    setLocation("");
    setCountry("");
    setLat(undefined);
    setLng(undefined);
    setSheet(null);
  }

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
    editPlace({ location: placeSuggestion.name, country: placeSuggestion.country });
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

  async function commit(secondEntryOverride?: boolean) {
    // The collision screen's own "Confirm" calls `setConfirmedSecondEntry(true)`
    // and `commit(true)` in the same handler — a state update is not visible
    // to the closure that scheduled it, so the explicit override is what the
    // very next write actually sees, same as it always had to be here.
    const effectiveSecondEntry = secondEntryOverride ?? confirmedSecondEntry;
    setBusy(true);
    setWriteError(null);
    try {
      if (parts === null) {
        // The plain, unsplit day — unchanged from before this ticket.
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
        if (result.error === "date_has_day" && result.existing) {
          setCollision(result.existing);
          setOutcome("collision");
          return;
        }
        // B2108 — the collision screen already let this through once (a time
        // was named); the address is still date + title, so a second entry
        // with the *same* title as the first collides regardless.
        if (result.error === "day_exists" || result.error === "slug_taken") {
          setOutcome("collision");
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
        const part = parts[step.index];
        const result = await writeOnePart({
          content: partWords[step.index] ?? "",
          photoIds: part.ids,
          time: step.time,
          secondEntry: step.secondEntry,
          withTitleAndExtras: step.index === 0,
        });
        if (!result.ok) {
          if (result.error === "date_has_day" && result.existing) {
            setCollision(result.existing);
            setOutcome("collision");
            return;
          }
          if (result.error === "day_exists" || result.error === "slug_taken") {
            setOutcome("collision");
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
  const attachedIdsRef = useRef<Set<string>>(new Set());
  const autosaveSignature = JSON.stringify({
    tripId, date, content, title, place, weatherOn, extras,
    photoIds: chosenPhotos.map((i) => i.id).sort(),
  });
  const lastAutosaved = useRef<string | null>(null);
  useEffect(() => {
    if (parts !== null) return;
    if (!tripId || !date || !online) return;
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
        // Already created — a later photograph is attached (`day/attach`,
        // never a second `day/new`), and the words go through the same
        // `PATCH /day` a person editing an existing day already uses.
        const newPhotoIds = chosenPhotos.map((i) => i.id).filter((id) => !attachedIdsRef.current.has(id));
        if (newPhotoIds.length > 0) {
          const attached = await fetch(`/api/helper/${encodeURIComponent(username)}/day/attach`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ trip: tripId, slug: createdSlug, files: newPhotoIds }),
          }).catch(() => null);
          if (attached?.ok) newPhotoIds.forEach((id) => attachedIdsRef.current.add(id));
        }
        const patched = await fetch(`/api/helper/${encodeURIComponent(username)}/day`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trip: tripId, slug: createdSlug, title, content }),
        }).catch(() => null);
        if (patched?.ok) {
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

  // The weather chip's own real value (B2676) — once the day exists, the
  // server has already tried the lookup at creation (`day/new`'s own
  // `fillDayWeatherQuietly`); this reads it back rather than guessing.
  useEffect(() => {
    if (!createdSlug || !weatherAvailable || !hasCoords) return;
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/day?trip=${encodeURIComponent(tripId)}&slug=${encodeURIComponent(createdSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok?: boolean; draft?: { weather?: DayWeather } } | null) => {
        if (!cancelled && json?.draft?.weather) setWeatherReading(json.draft.weather);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [createdSlug, weatherAvailable, hasCoords, tripId, username, autosaveState]);

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

  if (outcome === "collision" && collision) {
    // B2108 — the address is date + title only (`createDraft`'s own slug
    // logic, deliberately untouched here). A time never tells two entries
    // apart on disk; only a different title does, so once this one matches
    // the day above, offer the title field right here rather than let the
    // owner answer everything and learn it at the very end.
    const titleClash = titleCollidesWithExisting(title, collision);
    return (
      <div className="studio-step mt-4">
        <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
          <p className="font-semibold text-ink-strong">{t("studio.day.collision.banner", { date: formatLongDate(date) })}</p>
        </div>
        <div className="mt-3 rounded-xl border border-line-strong px-4 py-3">
          <p className="text-sm font-semibold text-ink-strong">{collision.title || t("studio.day.collision.untitled")}</p>
        </div>
        <div className="mt-4 flex flex-col items-start gap-1">
          {/* A draft can take more; a published day is changed, not added to. */}
          <Link href={`${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(collision.slug)}`} className={LINK}>
            {collision.status === "draft" ? t("studio.day.collision.addToDay") : t("studio.day.collision.changeInstead")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOutcome(null);
              setSheet("date");
            }}
            className={LINK}
          >
            {t("studio.day.collision.pickAnother")}
          </button>
        </div>
        <p className="mt-4 text-sm text-ink-secondary">{t("studio.day.collision.secondEntryHint")}</p>
        {titleClash && (
          <p role="alert" className="mt-2 text-sm text-coral-600">{t("studio.day.collision.titleMustDiffer")}</p>
        )}
        {titleClash && (
          <label className={`mt-2 ${LABEL}`}>
            {t("studio.day.whatHappened.titleLabel")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("studio.day.whatHappened.titlePlaceholder")}
              className={FIELD}
            />
          </label>
        )}
        <label className={`mt-2 ${LABEL}`}>
          {t("studio.day.collision.timeLabel")}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={TIME_FIELD} />
        </label>
        <StepPrimary
          busy={busy}
          disabled={!time || titleClash}
          tone="bg-yellow-400 text-yellow-950"
          onClick={() => {
            setConfirmedSecondEntry(true);
            void commit(true);
          }}
          label={t("studio.day.collision.confirmSecond")}
        />
      </div>
    );
  }

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
      {show("save") && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs uppercase tracking-wide text-ink-secondary">{t("studio.day.eyebrow")}</span>
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
          <PhotoPicker id="studio-day-photo-picker" chosen={[]} accept="image/*,video/*" onPick={pickFromDevice} showChosen={false} />
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
              <label className={`mt-3 ${LABEL}`}>
                {t("studio.day.where.placeLabel")}
                <input type="text" name="location" value={place.location} onChange={(e) => editPlace({ location: e.target.value })} className={FIELD} />
              </label>
              <label className={`mt-3 ${LABEL}`}>
                {t("studio.day.where.countryLabel")}
                <input type="text" name="country" value={place.country} onChange={(e) => editPlace({ country: e.target.value })} className={FIELD} />
              </label>
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
                <DayExtras value={extras} onChange={setExtras} currencies={currencies} routeTravel={routeTravel} />
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
          empty tile or a part's own "＋ Add". Picking a waiting photograph
          reuses the same `tile()`/`toggleSelected` the strip already has;
          uploading a new one reuses the same `PhotoPicker`/`pickFromDevice`. */}
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
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.day.photos.add")}</h2>
              <button type="button" onClick={() => setPhotoSheetTarget(null)} className={LINK}>
                {t("studio.day.sheet.close")}
              </button>
            </div>
            {waitingPhotos.length > 0 ? (
              <ul className="mt-3 grid grid-cols-4 gap-1.5">{waitingPhotos.map(tile)}</ul>
            ) : (
              <p className="mt-3 text-sm text-ink-secondary">{t("studio.day.photos.nonePendingYet")}</p>
            )}
            <div className="mt-3">
              <PhotoPicker id="studio-day-photo-sheet-picker" chosen={[]} accept="image/*,video/*" onPick={pickFromDevice} showChosen={false} />
            </div>
            {uploading > 0 && (
              <p className="mt-1 text-sm text-ink-secondary">{tn("studio.day.photos.uploadingCount", uploading, { count: String(uploading) })}</p>
            )}
            <button
              type="button"
              onClick={() => setPhotoSheetTarget(null)}
              className="mt-3 min-h-11 w-full rounded-full bg-action-strong px-4 text-base font-semibold text-on-action"
            >
              {t("studio.day.sheet.done")}
            </button>
          </div>
        </div>
      )}
    </StepBody>
  );
}
