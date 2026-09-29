import { notFound } from "next/navigation";
import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import WorldMap from "@/components/WorldMap";
import DayLineMap from "@/components/studio/location/DayLineMap";
import RouteMenu from "@/components/studio/location/RouteMenu";
import TrackEditsPanel from "@/components/studio/location/TrackEditsPanel";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { getPlaces } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { primaryStreetMap } from "@/lib/maps/dir";
import { framePoints } from "@/lib/map/tripFrame";
import { isRealDate, ownerDayLine, recordedTrips } from "@/lib/gps/api";
import { readerTrack } from "@/lib/gps/track";

/**
 * One recorded day's own page — B2563 T1, `TripDetailView`'s (retired)
 * former `DayPanel`, moved off `?day=` and onto its own address so the day
 * dropdown that used to start on the trip's first day simply cannot exist
 * any more: this page's only day is the one in the URL.
 *
 * `TrackEditsPanel` is handed `days={[date]}` on purpose — wave 2 (T3)
 * replaces the from/to form entirely with a time bar; for now, the smallest
 * change that fixes "the dropdown starts on the trip's first day" is to
 * shrink that dropdown's own option list to just this day.
 */
export default async function DayPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/location/[trip]/[date]">) {
  const { user, trip: tripId, date } = await params;
  await requireStudioOwner(user);
  if (!(await isJournalOwner(user)) || !isEnabled("routeRecording", user)) notFound();

  const trip = recordedTrips(user).find((r) => r.tripId === tripId);
  if (!trip || !isRealDate(date) || date < trip.start || date > trip.end) notFound();

  const query = await searchParams;
  const view = query.view === "readers" ? "readers" : "mine";

  const locale = await requestLocale();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const ref = tripRef(user, tripId);
  const base = `${journalPath(user)}/studio/location`;
  const tripBase = `${base}/${encodeURIComponent(tripId)}`;

  let points: [number, number][] = [];
  let gapAfter: boolean[] = [];
  if (view === "mine") {
    const line = ownerDayLine(user, tripId, date);
    points = line?.points ?? [];
    gapAfter = line?.gapAfter ?? [];
  } else {
    const places = getPlaces(ref, { includeDrafts: false });
    const publicDates = new Set(
      places.flatMap((p) => p.entries.map((e) => e.date)).filter((d): d is string => Boolean(d)),
    );
    if (publicDates.has(date)) {
      const day = readerTrack(user, tripId, publicDates, false)?.segments.find((s) => s.day === date);
      points = day?.points ?? [];
    }
  }

  const streetMapsOn = isEnabled("streetMaps");
  const places = getPlaces(ref, { includeDrafts: false });
  const region = streetMapsOn ? primaryStreetMap(user, tripId, framePoints(places)) : undefined;

  return (
    <StudioPage username={user} group="bringIn" title={date}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={`${tripBase}?day=${date}&view=${view}`}
          className="text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {trip.title}
        </Link>
        <RouteMenu username={user} tripId={tripId} tripTitle={trip.title} date={date} backHref={tripBase} />
      </div>

      {points.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayEmpty")}</p>
      ) : region ? (
        <div className="mt-3 h-64 overflow-hidden rounded-xl border border-line-quiet">
          <DayLineMap points={points} gapAfter={gapAfter} bounds={region.bounds} pmtilesUrl={region.url} className="h-full w-full" />
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">
          <WorldMap places={[]} basemap={null} track={splitAtGaps(points, gapAfter)} />
        </div>
      )}
      {gapAfter.some(Boolean) && <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayGapNote")}</p>}

      <TrackEditsPanel username={user} tripId={tripId} days={[date]} />
    </StudioPage>
  );
}

function splitAtGaps(points: [number, number][], gapAfter: boolean[]): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = points.length > 0 ? [points[0]] : [];
  for (let i = 1; i < points.length; i++) {
    if (gapAfter[i - 1]) {
      if (run.length > 1) out.push(run);
      run = [points[i]];
    } else {
      run.push(points[i]);
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}
