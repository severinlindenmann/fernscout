"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import { useI18n } from "@/components/LocaleProvider";
import { routeStatus, useNativeShell, type RouteRecordStatus } from "@/components/nativeShell";
import type { Basemap } from "@/lib/basemap";
import type { TranslationKey } from "@/lib/i18n";

type RecordedTrip = {
  tripId: string;
  title: string;
  start: string;
  end: string;
  daysRecorded: number;
  tripDays: number;
  lastReceived: string;
};

type LineSegment = { day?: string; points: [number, number][] };
type LineResponse = { ok?: true; segments?: LineSegment[]; error?: string };
type TripsResponse = { ok?: true; trips?: RecordedTrip[]; error?: string };
type DeleteResponse = { ok?: true; removed?: number; error?: string };

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
}: {
  username: string;
  initialTrips: RecordedTrip[];
  placesByTrip: Record<string, PlaceView[]>;
  basemapByTrip: Record<string, Basemap | null>;
}) {
  const { t, tn, formatShortDate, locale } = useI18n();
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
          href={`/${username}/studio/trip`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {t("studio.location.route.emptyCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-ink-strong">
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
                  <p className="text-sm text-ink-secondary">{t("studio.location.route.rawNote")}</p>
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
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
