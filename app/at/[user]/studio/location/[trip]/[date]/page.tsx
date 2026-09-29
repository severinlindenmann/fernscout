import { notFound } from "next/navigation";
import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import WorldMap from "@/components/WorldMap";
import DayLineMap from "@/components/studio/location/DayLineMap";
import DayStretchEditor from "@/components/studio/location/DayStretchEditor";
import RouteMenu from "@/components/studio/location/RouteMenu";
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
 * One recorded day's own page — B2563 T1 moved `TripDetailView`'s (retired)
 * former `DayPanel` off `?day=` and onto its own address, so the day
 * dropdown that used to start on the trip's first day simply cannot exist
 * any more: this page's only day is the one in the URL. B2563 T3 replaces
 * that wave's placeholder read-only map with the real editor — a two-handle
 * time bar, a selected-stretch card and a tap-the-map hidden spot, all in
 * `DayStretchEditor.tsx` — for the **owner's own** view; the Readers switch
 * keeps the same plain, read-only map it always has, since there is nothing
 * for a reader to edit on their own view of somebody else's route.
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

  const streetMapsOn = isEnabled("streetMaps");
  const places = getPlaces(ref, { includeDrafts: false });
  const region = streetMapsOn ? primaryStreetMap(user, tripId, framePoints(places)) : undefined;

  const ownerLine = view === "mine" ? ownerDayLine(user, tripId, date) : null;

  let points: [number, number][] = [];
  let gapAfter: boolean[] = [];
  if (view === "mine") {
    points = ownerLine?.points ?? [];
    gapAfter = ownerLine?.gapAfter ?? [];
  } else {
    const publicDates = new Set(
      places.flatMap((p) => p.entries.map((e) => e.date)).filter((d): d is string => Boolean(d)),
    );
    if (publicDates.has(date)) {
      const day = readerTrack(user, tripId, publicDates, false)?.segments.find((s) => s.day === date);
      points = day?.points ?? [];
    }
  }

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
      ) : view === "mine" && ownerLine ? (
        <DayStretchEditor
          username={user}
          tripId={tripId}
          date={date}
          points={ownerLine.points}
          times={ownerLine.times}
          modes={ownerLine.modes}
          gapAfter={ownerLine.gapAfter}
          timezone={ownerLine.timezone}
          region={region}
          streetMapsOn={streetMapsOn}
        />
      ) : region ? (
        <div className="mt-3 h-64 overflow-hidden rounded-xl border border-line-quiet">
          <DayLineMap points={points} gapAfter={gapAfter} bounds={region.bounds} pmtilesUrl={region.url} className="h-full w-full" />
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">
          <WorldMap
            places={[]}
            basemap={null}
            track={splitAtGaps(points, gapAfter)}
            frameHint={points.map(([lat, lng]) => ({ lat, lng }))}
            showTimeScrubber={false}
          />
        </div>
      )}
      {view !== "mine" && gapAfter.some(Boolean) && (
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayGapNote")}</p>
      )}
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
