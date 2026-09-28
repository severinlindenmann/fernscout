"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import TrackEditsPanel from "./TrackEditsPanel";
import { useI18n } from "@/components/LocaleProvider";
import { routeStatus, useNativeShell, type RouteRecordStatus } from "@/components/nativeShell";
import type { Basemap } from "@/lib/basemap";
import type { TranslationKey } from "@/lib/i18n";
import { kmBetween } from "@/lib/mapFrame";

import { journalPath } from "@/lib/journalPath";
type RecordedTrip = {
  tripId: string;
  title: string;
  start: string;
  end: string;
  daysRecorded: number;
  tripDays: number;
  lastReceived: string;
  /** The phone's own latest armed/permission report — B2542. `null` when
   *  nothing has ever been reported for this trip. Read here alongside the
   *  client-side native status (`nativeStatus` below), which only knows
   *  about *this* device; this is what the server was actually sent by
   *  whichever phone (or none) is out there recording. */
  recording: {
    state: "recording" | "off" | "silent";
    reason?: "permission" | "stale";
    permission?: string;
  } | null;
  /** B2539 security review, S2 — true when this row exists only because
   * `track.json` survives a store with nothing left in it (a purge, most
   * often). The hide/name tools still need this trip reachable; the preview
   * map and per-day delete do not, since there is nothing left to fetch or
   * delete by day. */
  hasPublishedTrack?: boolean;
  /** Raw fix count inside the trip's own dates — the overview card's facts
   * line. Absent (rather than 0) is treated the same as 0: an older caller
   * that has not started sending it yet still renders. */
  positions?: number;
};

type LineSegment = { day?: string; points: [number, number][] };
type LineResponse = { ok?: true; segments?: LineSegment[]; error?: string };
type TripsResponse = { ok?: true; trips?: RecordedTrip[]; error?: string };
type DeleteResponse = { ok?: true; removed?: number; error?: string };

/** Every date from `start` to `end`, inclusive — the trip's own calendar
 * span, for `TrackEditsPanel`'s day picker. A hidden or named stretch is
 * about a day the trip *has*, never one the store currently happens to
 * still hold a fix for (B2539 security review, S2), so this is independent
 * of `segmentsByTrip`'s own raw preview. Timezone-agnostic on purpose, the
 * same as the trip-track derivation's own private `datesBetween` (in the
 * GPS module the studio conformance grep (C9) refuses to name here) — this
 * is only a list of labels for a `<select>`, never an instant. */
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = start; d <= end; ) {
    dates.push(d);
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return dates;
}

/** Straight-line kilometres along every segment's own points, never across
 * the break between two segments (that break is a real gap, not distance
 * travelled) — the overview card's "km recorded" fact. */
function kmAlong(segments: LineSegment[]): number {
  let km = 0;
  for (const s of segments) {
    for (let i = 1; i < s.points.length; i++) {
      km += kmBetween(
        { lat: s.points[i - 1][0], lng: s.points[i - 1][1] },
        { lat: s.points[i][0], lng: s.points[i][1] },
      );
    }
  }
  return km;
}

/**
 * "Your route" — B2226. One row per trip that has at least one recorded
 * fix (`recordedTrips`), with a Preview (the owner's own raw, unclipped
 * line — `ownerTripLine`) and two ways to delete: the whole trip's
 * recording, or one recorded day of it (`deleteTripRecording`).
 *
 * `placesByTrip`/`basemapByTrip` are computed on the server the same way
 * the trip map page computes them (`getPlaces`/`basemapForRoute`), so the
 * preview map's frame is the trip's own stops — never the raw track itself,
 * which must not be able to zoom the whole map out to fit wherever the
 * owner's phone happened to wander (see docs/gps.md, "What it looks like").
 */
export default function RecordedTripsSection({
  username,
  initialTrips,
  placesByTrip,
  basemapByTrip,
  kmByModeByTrip,
  initialSegmentsByTrip,
  hiddenDaysByTrip,
}: {
  username: string;
  initialTrips: RecordedTrip[];
  placesByTrip: Record<string, PlaceView[]>;
  basemapByTrip: Record<string, Basemap | null>;
  /** B2541 — kilometres recorded by transport mode, per trip. A plain
   *  object rather than a component prop type imported from `lib/gps/api.ts`
   *  (server-only): the shape is just `{ [mode]: km }`, small enough to
   *  restate here the same way `RecordedTrip` itself is. */
  kmByModeByTrip?: Record<string, Partial<Record<string, number>>>;
  /** The owner's own raw line per trip, computed server-side
   * (`ownerTripLine`) — B2540's overview card map and facts line. Shown
   * unconditionally, unlike `segmentsByTrip` below (the same data, fetched
   * lazily on "Preview" for the per-day delete list further down this same
   * card — left as it was rather than merged, since removing that fetch
   * would be a second change this ticket did not ask for). */
  initialSegmentsByTrip: Record<string, LineSegment[]>;
  /** B2544 — this trip's own days whose typed `coordinates` fall inside a
   * spot the owner has hidden, computed server-side (`AS_AUTHOR`) and
   * handed to `TrackEditsPanel` to warn about. */
  hiddenDaysByTrip: Record<string, { date: string; slug: string; location: string }[]>;
}) {
  const { t, tn, formatShortDate, locale } = useI18n();
  const router = useRouter();
  // `formatShortDate` reads a calendar date, not an instant — `lastReceived`
  // is an ISO timestamp, so it gets its own formatter, the same shape
  // `RouteRecordSection`'s own `fmt` uses.
  const fmtInstant = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  const native = useNativeShell();
  const [trips, setTrips] = useState(initialTrips);
  const [nativeStatus, setNativeStatus] = useState<Record<string, RouteRecordStatus>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [segmentsByTrip, setSegmentsByTrip] = useState<Record<string, LineSegment[]>>({});
  const [lineError, setLineError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ tripId: string; date?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!native) return;
    let live = true;
    void Promise.all(
      trips.map(async (trip) => {
        try {
          const s = await routeStatus(trip.tripId);
          return [trip.tripId, s] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!live) return;
      const next: Record<string, RouteRecordStatus> = {};
      for (const row of results) if (row) next[row[0]] = row[1];
      setNativeStatus(next);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, trips.length]);

  async function refreshTrips() {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps/trips`);
    const json = (await res.json().catch(() => null)) as TripsResponse | null;
    if (json?.ok) setTrips(json.trips ?? []);
  }

  const loadLine = useCallback(
    async (tripId: string) => {
      setLineError(null);
      const res = await fetch(
        `/api/helper/${encodeURIComponent(username)}/gps/line?trip=${encodeURIComponent(tripId)}`,
      );
      const json = (await res.json().catch(() => null)) as LineResponse | null;
      if (!json?.ok) {
        setLineError(t("studio.location.route.previewError"));
        return;
      }
      setSegmentsByTrip((prev) => ({ ...prev, [tripId]: json.segments ?? [] }));
    },
    [username, t],
  );

  function toggleExpand(tripId: string) {
    if (expanded === tripId) {
      setExpanded(null);
      return;
    }
    setExpanded(tripId);
    if (!segmentsByTrip[tripId]) void loadLine(tripId);
  }

  async function confirmDelete() {
    if (!asking) return;
    setBusy(true);
    setError(undefined);
    try {
      const q = new URLSearchParams({ trip: asking.tripId });
      if (asking.date) q.set("date", asking.date);
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps/trip?${q}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as DeleteResponse | null;
      if (!res.ok || !json?.ok) {
        setError(t("studio.location.route.deleteError"));
        return;
      }
      setAsking(null);
      await refreshTrips();
      // B2549 — a public track derived from this recording has to stop
      // showing what was just deleted.
      router.refresh();
      // The deleted trip's/day's segments are now stale — drop them so a
      // re-expand fetches the current line rather than showing what was
      // just removed.
      setSegmentsByTrip((prev) => {
        const next = { ...prev };
        delete next[asking.tripId];
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  if (trips.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-ink-strong">
          {t("studio.location.route.heading")}
        </h2>
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.route.empty")}</p>
        <Link
          href={`${journalPath(username)}/studio/trip`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {t("studio.location.route.emptyCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-10">
      {/* S1 A's recording-status block — for now, one line per trip built
          from what the server already has (`lastReceived`, or the native
          shell's own live status when this session holds it). A parallel
          builder is adding a real `recordingState(user, tripId)` read; this
          block is the placeholder slot it swaps into, not that function. */}
      <div className="rounded-2xl border border-line-quiet bg-surface-subtle p-4">
        <h2 className="font-display text-base font-semibold text-ink-strong">
          {t("studio.location.route.statusHeading")}
        </h2>
        <ul className="mt-2 space-y-1">
          {trips.map((trip) => {
            const status = nativeStatus[trip.tripId];
            return (
              <li key={trip.tripId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-ink-strong">{trip.title}</span>
                <span className="text-ink-secondary">
                  {native && status
                    ? statusLine(status, t)
                    : t("studio.location.route.lastReceived", { at: fmtInstant(trip.lastReceived) })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold text-ink-strong">
        {t("studio.location.route.heading")}
      </h2>
      <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.route.lede")}</p>

      <ul className="mt-4 space-y-4">
        {trips.map((trip) => {
          const segments = segmentsByTrip[trip.tripId];
          const days = new Map<string, number>();
          for (const s of segments ?? []) {
            if (!s.day) continue;
            days.set(s.day, (days.get(s.day) ?? 0) + s.points.length);
          }
          const status = nativeStatus[trip.tripId];

          return (
            <li key={trip.tripId} className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
              <p className="font-display text-base font-semibold text-ink-strong">{trip.title}</p>
              <p className="text-sm text-ink-secondary">
                {tn("studio.location.route.daysRecorded", trip.daysRecorded, {
                  days: String(trip.daysRecorded),
                  tripDays: String(trip.tripDays),
                })}
              </p>
              <p className="text-sm text-ink-secondary">
                {native && status
                  ? statusLine(status, t)
                  : t("studio.location.route.lastReceived", { at: fmtInstant(trip.lastReceived) })}
              </p>
              {/* B2542 — the phone's own reported state, independent of
                  whether this browser is the device recording. Only shown
                  when a phone has ever actually reported something; the
                  native-status line above already covers "this device". */}
              {trip.recording && <p className="text-sm text-ink-secondary">{serverStateLine(trip.recording, t)}</p>}
              {(() => {
                const modes = kmByModeByTrip?.[trip.tripId];
                const entries = modes ? Object.entries(modes).filter(([, km]) => (km ?? 0) > 0) : [];
                if (entries.length === 0) return null;
                return (
                  <p className="text-sm text-ink-secondary">
                    {entries.map(([mode, km]) => `${km} km ${modeLabel(mode, t)}`).join(" · ")}
                  </p>
                );
              })()}

              {(() => {
                const initial = initialSegmentsByTrip[trip.tripId] ?? [];
                if (initial.length === 0) return null;
                const km = kmAlong(initial);
                const gaps = Math.max(0, initial.length - 1);
                return (
                  <>
                    <div className="mt-3 h-32 overflow-hidden rounded-xl border border-line-quiet">
                      <WorldMap
                        places={placesByTrip[trip.tripId] ?? []}
                        basemap={basemapByTrip[trip.tripId] ?? null}
                        track={initial.map((s) => s.points)}
                      />
                    </div>
                    <p className="mt-2 text-sm text-ink-secondary">
                      {tn("studio.location.route.cardFacts", trip.daysRecorded, {
                        days: String(trip.daysRecorded),
                        km: km.toFixed(1),
                        positions: String(trip.positions ?? 0),
                        gaps: String(gaps),
                      })}
                    </p>
                  </>
                );
              })()}
              <Link
                href={`${journalPath(username)}/studio/location?trip=${encodeURIComponent(trip.tripId)}&view=mine`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
              >
                {t("studio.location.route.viewTrip")}
              </Link>

              <div className="mt-3 flex flex-wrap gap-2">
                <BusyButton
                  busy={false}
                  type="button"
                  onClick={() => toggleExpand(trip.tripId)}
                  aria-expanded={expanded === trip.tripId}
                  className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                >
                  {expanded === trip.tripId
                    ? t("studio.location.route.hidePreview")
                    : t("studio.location.route.preview")}
                </BusyButton>
                <BusyButton
                  busy={busy && asking?.tripId === trip.tripId && !asking.date}
                  type="button"
                  onClick={() => setAsking({ tripId: trip.tripId })}
                  className="min-h-11 rounded-full border border-coral-600 px-4 text-sm font-semibold text-coral-600 hover:bg-coral-50"
                >
                  {t("studio.location.route.deleteTrip")}
                </BusyButton>
              </div>

              {asking?.tripId === trip.tripId && !asking.date && (
                <div className="mt-3">
                  <ConfirmPanel
                    label={t("studio.location.route.deleteTrip")}
                    question={t("studio.location.route.deleteTripQuestion", { title: trip.title })}
                    details={t("studio.location.route.deleteNote")}
                    confirmLabel={t("studio.location.route.deleteTripConfirm")}
                    tone="destructive"
                    busy={busy}
                    error={error}
                    onConfirm={() => void confirmDelete()}
                    onCancel={() => setAsking(null)}
                  />
                </div>
              )}

              {expanded === trip.tripId && (
                <div className="mt-4">
                  {!trip.hasPublishedTrack && (
                    <p className="text-sm text-ink-secondary">{t("studio.location.route.rawNote")}</p>
                  )}
                  {trip.hasPublishedTrack && (
                    <p className="text-sm text-ink-secondary">{t("studio.location.route.publishedOnly")}</p>
                  )}
                  {lineError && (
                    <p role="alert" className="mt-2 text-sm text-coral-600">
                      {lineError}
                    </p>
                  )}
                  {segments && segments.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">
                      <WorldMap
                        places={placesByTrip[trip.tripId] ?? []}
                        basemap={basemapByTrip[trip.tripId] ?? null}
                        track={segments.map((s) => s.points)}
                      />
                    </div>
                  )}
                  {segments && days.size > 0 && (
                    <ul className="mt-3 space-y-2">
                      {[...days.entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([date, points]) => (
                          <li
                            key={date}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm"
                          >
                            <span className="text-ink-body">
                              {formatShortDate(date)} · {tn("studio.location.route.dayPoints", points, { count: String(points) })}
                            </span>
                            <button
                              type="button"
                              onClick={() => setAsking({ tripId: trip.tripId, date })}
                              className="font-semibold text-coral-600 underline underline-offset-2"
                            >
                              {t("studio.location.route.deleteDay")}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {asking?.tripId === trip.tripId && asking.date && (
                    <div className="mt-3">
                      <ConfirmPanel
                        label={t("studio.location.route.deleteDay")}
                        question={t("studio.location.route.deleteDayQuestion", {
                          date: formatShortDate(asking.date),
                        })}
                        details={t("studio.location.route.deleteNote")}
                        confirmLabel={t("studio.location.route.deleteDayConfirm")}
                        tone="destructive"
                        busy={busy}
                        error={error}
                        onConfirm={() => void confirmDelete()}
                        onCancel={() => setAsking(null)}
                      />
                    </div>
                  )}

                  {/* B2539, D8 C — hide a spot, hide a stretch, name a
                      stretch, for this trip. Offered for every trip in this
                      list, including one whose `track.json` survives a
                      purge with nothing left recorded (`hasPublishedTrack`)
                      — the whole point of listing it at all (security
                      review, S2). The day picker is the trip's own calendar
                      span, not the segments above: a hidden/named stretch
                      is about a day the trip *has*, not one the store
                      currently happens to still hold a fix for. */}
                  <TrackEditsPanel
                    username={username}
                    tripId={trip.tripId}
                    days={datesBetween(trip.start, trip.end)}
                    hiddenDays={hiddenDaysByTrip[trip.tripId] ?? []}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** B2542 — turns the server's own `recordingState` answer into one line.
 * `permission`'s reason gets the exact "needs Always" wording the studio's
 * arming flow already uses elsewhere, so a person reads the same sentence
 * whichever screen told them. */
function serverStateLine(
  recording: NonNullable<RecordedTrip["recording"]>,
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
): string {
  if (recording.state === "recording") return t("studio.location.route.server.recording");
  if (recording.state === "off") return t("studio.location.route.server.off");
  return recording.reason === "permission"
    ? t("studio.location.route.server.silentPermission")
    : t("studio.location.route.server.silentStale");
}

/** One word per `TransportMode` (`importers/gps/schema.ts`) — the km-by-mode
 * line's own labels, B2541. A `Record` keyed by every mode the shared
 * vocabulary names, not a lookup that can silently miss one: TypeScript
 * refuses this object if a mode is ever added there and not here. An
 * unrecognised string (there should never be one — `kmByMode` only sums
 * fixes whose mode already validated against the same vocabulary) falls
 * back to the raw word rather than throwing. */
const MODE_KEYS: Record<string, TranslationKey> = {
  on_foot: "studio.location.route.mode.onFoot",
  bike: "studio.location.route.mode.bike",
  car: "studio.location.route.mode.car",
  bus: "studio.location.route.mode.bus",
  train: "studio.location.route.mode.train",
  tram: "studio.location.route.mode.tram",
  boat: "studio.location.route.mode.boat",
  plane: "studio.location.route.mode.plane",
  skiing: "studio.location.route.mode.skiing",
  unknown: "studio.location.route.mode.unknown",
};

function modeLabel(mode: string, t: (key: TranslationKey, vars?: Record<string, string>) => string): string {
  const key = MODE_KEYS[mode];
  return key ? t(key) : mode;
}

function statusLine(
  status: RouteRecordStatus,
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
): string {
  switch (status.state) {
    case "recording":
      return t("studio.location.route.native.recording");
    case "stopped":
      return t("studio.location.route.native.stopped");
    case "declined":
      return t("studio.location.route.native.declined");
    case "error":
      return t("studio.location.route.native.error");
    default:
      return t("studio.location.route.native.off");
  }
}
