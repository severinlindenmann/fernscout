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
import { MINUTES_PER_CREDIT } from "@/lib/helper/speech";
import type { TranslationKey } from "@/lib/i18n";
import { mostCommon, photoDay, photosInGroup, splitDayPhotos, tripForDate } from "@/lib/studio/dayCards";

/** First-run mode (B2188, owner decision D1 "C inside A"): the same page,
 *  revealed one part at a time for somebody who has no day yet. The one-page
 *  mode never calls `go`, so these steps only ever mean something there. */
const FIRST_RUN = ["photos", "words", "save"] as const;
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
const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-ink-secondary";
const LINK = "min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2";

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
  polishCredits = null,
  polishPriceChf = null,
  routeRecordingAvailable = false,
  weatherAvailable = false,
  speech = null,
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
  /** "Polish my text" (B2190): the owner's credit balance, or `null` when it
   *  may not be offered at all — helper off, no consent to send words, or
   *  credits off — read on the server. `PolishText` renders nothing on null. */
  polishCredits?: number | null;
  /** "about CHF x.xx" for the same tap (B2254) — computed server-side, since
   *  pricing is paid-only code after the open-core split. `null` on a
   *  public build or whenever `polishCredits` is: `PolishText` then shows
   *  the credit price alone. */
  polishPriceChf?: string | null;
  /** B2200, D1 — whether the page may ask `day/place` for a suggestion at
   *  all. Off means the route is never called. */
  routeRecordingAvailable?: boolean;
  /** The weather capability. Off: no weather chip, and `weather` is never sent. */
  weatherAvailable?: boolean;
  /** The transcription capability's own facts, `null` when it is off — the
   *  microphone is then absent, not broken. */
  speech?: { consented: boolean; provider: string; credits: number | null; priceChf: string | null } | null;
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
  const router = useRouter();
  const params = useSearchParams();
  const todayIso = proposal?.today ?? new Date().toISOString().slice(0, 10);
  const firstRun = Object.values(writtenDatesByTrip).every((dates) => dates.length === 0);
  const proposedToday = proposal?.trip.status === "current" ? proposal.today : "";

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tripOverride, setTripOverride] = useState("");
  const [dateOverride, setDateOverride] = useState("");
  const [collision, setCollision] = useState<ExistingDayOnDate | null>(null);
  const [time, setTime] = useState("");
  const [confirmedSecondEntry, setConfirmedSecondEntry] = useState(false);

  const [inboxItems, setInboxItems] = useState<InboxMediaItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const photosInit = useRef(false);
  // B2232 — brought in for this day: a card's photographs, this visit's uploads.
  const [ownIds, setOwnIds] = useState<string[]>([]);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
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
  const [extras, setExtras] = useState<DayExtrasValue>(NO_EXTRAS);
  const [busy, setBusy] = useState(false);
  const [saveQueued, setSaveQueued] = useState(false);
  const [writeError, setWriteError] = useState<{ message: string; mediaProblems?: MediaProblem[] } | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  // B2194 — asked once, then `?mode=speak` or the remembered "speak" opens the
  // spoken questions; `?mode=type` is the composer, whatever was chosen.
  const [tellByNow, setTellByNow] = useState(tellBy);
  const [spoken, setSpoken] = useState(false);
  const mode = params.get("mode");
  const askTellBy = !!speech && tellByNow === null && mode === null;
  const speaking = !!speech && (mode === "speak" || (mode !== "type" && tellByNow === "speak"));

  const dirty = content.trim() !== "" || title.trim() !== "" || dateOverride !== "" || tripOverride !== "";
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

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** What will be written: the list's own order, deduplicated by id. */
  const chosenPhotos = (inboxItems ?? []).filter((i) => selectedIds.includes(i.id));

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

  function acceptPlaceSuggestion() {
    if (!placeSuggestion) return;
    editPlace({ location: placeSuggestion.name, country: placeSuggestion.country });
    setPlaceSuggestionDismissed(true);
  }

  // ── the write ───────────────────────────────────────────────────────
  async function commit(secondEntry = confirmedSecondEntry) {
    setBusy(true);
    setWriteError(null);
    const payload = {
      trip: tripId,
      date,
      time: time || undefined,
      // Never generated: a blank title stays blank.
      title,
      content,
      location: place.location || undefined,
      country: place.country || undefined,
      lat: place.lat,
      lng: place.lng,
      weather,
      mediaInboxIds: chosenPhotos.map((i) => i.id),
      ...extrasToWrite(extras),
      declined: {},
      confirmSecondEntry: secondEntry,
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
      if (json && "error" in json && json.error === "date_has_day" && json.existing) {
        setCollision(json.existing);
        setOutcome("collision");
        return;
      }
      if (!res.ok || !json || !("ok" in json)) {
        const error = json && "error" in json ? json.error : undefined;
        const detail = json && "detail" in json ? json.detail : undefined;
        setWriteError({ message: t("studio.day.writeFailed.message"), mediaProblems: mediaProblemsFrom(error, detail) });
        setOutcome("writeFailed");
        return;
      }
      // B2058 — the route answers with the v2 day id (`<date>-<slug>`).
      setCreatedSlug(json.slug.startsWith(`${date}-`) ? json.slug.slice(date.length + 1) : json.slug);
      setOutcome("saved");
      reset();
    } catch {
      // A network error (not a rejection the server actually sent) — B2330
      // queues the write itself, in order after any of its own photographs
      // still queued as `media.upload` (both created through the same
      // outbox, so replay always sends the photos first). A day queued
      // offline has no server slug yet, so "saved" (which needs one, for the
      // publish link) is never shown for it — "queued" instead.
      if (hasOutbox()) {
        const store = openOutboxStore();
        await store.add(
          newIntent({
            user: username,
            kind: "day.new",
            method: "POST",
            url: `/api/helper/${encodeURIComponent(username)}/day/new`,
            body: payload,
          }),
        );
        setOutcome("queued");
        // Not `reset()` here (unlike the "saved" branch above): it clears the
        // draft with its own `router.replace`, a soft navigation — offline,
        // that fetch fails, and this page is itself on the SW's kept
        // allowlist so the browser can fall back to reloading *this* page
        // from the personal cache, wiping the "queued" screen the owner was
        // just shown for one they never asked to leave. The draft is harmless
        // left behind: this outcome screen replaces the whole form either way,
        // and `toStudio` below is the only navigation this outcome offers.
        return;
      }
      setWriteError({ message: t("studio.day.writeFailed.message") });
      setOutcome("writeFailed");
    } finally {
      setBusy(false);
    }
  }

  // A Save pressed while photographs upload waits for them, then goes.
  useEffect(() => {
    if (!saveQueued || uploading > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the queued save fires once the uploads it waited for are in.
    setSaveQueued(false);
    void commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveQueued, uploading]);

  function save() {
    if (uploading > 0) setSaveQueued(true);
    else void commit();
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
    router.replace(`/${username}/studio/day/new?${q.toString()}`);
  }

  // ── rendering ───────────────────────────────────────────────────────
  // B2330 — offline, "Done" is a hard navigation rather than a soft one: the
  // worker never serves an RSC fetch from its kept cache (`sw.js`'s own
  // `_rsc`/`RSC` early-return, so it never risks answering a soft navigation
  // with a stale build's payload), so a soft `router.push` to a kept page
  // would simply fail with no connection. A full navigation still opens it,
  // from the same kept personal cache the initial visit warmed.
  const toStudio = () => (online ? router.push(`/${username}/studio`) : (window.location.href = `/${username}/studio`));

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
          href={`/${username}/studio/day/publish?day=${encodeURIComponent(createdSlug)}&trip=${encodeURIComponent(tripId)}`}
          className={`mt-4 inline-flex items-center ${LINK}`}
        >
          {t("studio.day.saved.share")}
        </Link>
        <StepPrimary onClick={toStudio} label={t("studio.day.saved.done")} />
      </div>
    );
  }

  if (outcome === "collision" && collision) {
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
          <a href={`/${username}/studio/day/edit?slug=${encodeURIComponent(collision.slug)}`} className={LINK}>
            {collision.status === "draft" ? t("studio.day.collision.addToDay") : t("studio.day.collision.changeInstead")}
          </a>
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
        <label className={`mt-2 ${LABEL}`}>
          {t("studio.day.collision.timeLabel")}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
        </label>
        <StepPrimary
          busy={busy}
          disabled={!time}
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
  const { own: dayPhotos, others: waitingPhotos } = splitDayPhotos(inboxItems ?? [], date, new Set([...selectedIds, ...ownIds]));
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

  return (
    <StepBody step={part ?? "page"}>
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
              <span className="block text-xs text-ink-secondary">
                {date ? `${formatLongDate(date, { year: true })} · ${dateSource}` : t("studio.day.date.ask")}
              </span>
            </span>
          </button>
          {sheet === "date" && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{t("studio.day.sheet.notRight")}</p>
              {trips.length > 1 && (
                <label className={`mt-3 ${LABEL}`}>
                  {t("studio.day.decide.row.trip")}
                  <select value={tripId} onChange={(e) => setTripOverride(e.target.value)} className={`${FIELD} rounded-full`}>
                    {trips.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
          {inboxItems !== null && inboxItems.length > 0 && (
            <>
              <p className="mb-2 text-sm text-ink-secondary">
                {t("studio.day.photos.chosen", { count: String(chosenPhotos.length) })}
              </p>
              <ul className="grid grid-cols-4 gap-1.5">
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
                  <Link href={`/${username}/studio#waiting`} className={`inline-flex items-center ${LINK}`}>
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
                <span>{t("studio.day.chip.weather")}</span>
                <small className="text-xs text-ink-secondary">
                  {weatherOn ? t("studio.day.source.weather") : t("studio.day.source.weatherOff")}
                </small>
              </button>
            )}
          </div>

          {placeSuggestion && !placeSuggestionDismissed && placeEmpty && (
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
          )}

          {sheet === "place" && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3">
              <p className="text-sm font-semibold text-ink-strong">{t("studio.day.sheet.notRight")}</p>
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
          <p className="mt-1 text-xs text-ink-secondary">
            {t("studio.day.whatHappened.nothingInvented")}
            {speech && ` ${t("studio.day.mic.price", { minutes: String(MINUTES_PER_CREDIT) })}`}
          </p>
          {/* B2236 — the quiet way back to Speak once it isn't the answer. */}
          <RatherTalk username={username} speech={speech} tellBy={tellByNow} />
          {/* B2190 — "Polish my text", directly under the box it rewrites. */}
          <PolishText
            username={username}
            trip={tripId}
            text={content}
            onUse={setContent}
            credits={polishCredits}
            priceChf={polishPriceChf}
          />
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
            <label className={`mt-2 ${LABEL}`}>
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
            <label className={`mt-3 mb-2 ${LABEL}`}>
              {t("studio.day.field.time")}
              <input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
            </label>
            {/* B2233 — costs, how you travelled, tags; blank stays blank.
                Mounted only while open: the collapsed page has no dropdown. */}
            {detailsOpen && (
              <div className="mb-3">
                <DayExtras value={extras} onChange={setExtras} currencies={currencies} />
              </div>
            )}
          </details>
          {!date && <p className="mt-3 text-sm text-ink-secondary">{t("studio.day.date.ask")}</p>}
          <StepPrimary
            busy={busy || saveQueued}
            busyLabel={saveQueued ? tn("studio.day.saveWaiting", uploading, { count: String(uploading) }) : t("studio.day.saveBusy")}
            disabled={!tripId || !date || extras.costs.some(lineProblem)}
            tone="bg-yellow-400 text-yellow-950"
            onClick={save}
            label={t("studio.day.save")}
          />
        </>
      )}
    </StepBody>
  );
}
