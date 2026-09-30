import { notFound } from "next/navigation";
import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import WorldMap from "@/components/WorldMap";
import DayLineMap from "@/components/studio/location/DayLineMap";
import DayStretchEditor from "@/components/studio/location/DayStretchEditor";
import PositionsTable, { type DisplayRow } from "@/components/studio/location/PositionsTable";
import RouteMenu from "@/components/studio/location/RouteMenu";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn, translatePluralIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { getPlaces } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { primaryStreetMap } from "@/lib/maps/dir";
import { framePoints } from "@/lib/map/tripFrame";
import { isRealDate, ownerDayLine, recordedTrips, zoneLabelFor } from "@/lib/gps/api";
import { readerTrack } from "@/lib/gps/track";
import { isInHiddenSpot, readTrackEdits } from "@/lib/gps/edits";
import { townNameFor } from "@/lib/map/townName";
import { utcToZonedParts } from "@/lib/timezone";
import { buildPositionRows, gapDurationParts, resolveHiddenBy } from "@/lib/gps/positionRows";
import { modeLabel } from "@/app/at/[user]/studio/location/[trip]/page";

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
  // Owner-only, D11 — the Readers view never gets this tab at all, so a
  // reader's own `?tab=positions` (typed, not linked to) simply falls back
  // to the ordinary map.
  const tab = view === "mine" && query.tab === "positions" ? "positions" : "map";

  const locale = await requestLocale();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const ref = tripRef(user, tripId);
  const base = `${journalPath(user)}/studio/location`;
  const tripBase = `${base}/${encodeURIComponent(tripId)}`;
  const dayBase = `${tripBase}/${encodeURIComponent(date)}`;

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

  // B2563 T5 — built server-side, straight from `ownerLine`'s own arrays;
  // no new reader of the store (`ownerDayLine` already carries `times`/
  // `modes`), and `lib/gps/positionRows.ts`'s pure builder does the
  // arithmetic so it stays unit-testable without a fixture. `readTrackEdits`/
  // `isInHiddenSpot` (`lib/gps/edits.ts`, app-importable) and `zoneLabelFor`
  // (`lib/gps/api.ts`, which alone reaches the private-zone file this page
  // may not open on its own) resolve "Hidden by"; `townNameFor` never a raw
  // coordinate, only its own fallback ("" here — a blank cell, not a
  // guess) when the offline geodata index has nothing for the point.
  let positionRows: DisplayRow[] = [];
  let positionsSummary = "";
  if (tab === "positions" && ownerLine) {
    const edits = readTrackEdits(user, tripId);
    const rawRows = buildPositionRows({
      points: ownerLine.points,
      times: ownerLine.times,
      modes: ownerLine.modes,
      gapAfter: ownerLine.gapAfter,
      placeFor: (lat, lon) => townNameFor(lat, lon, ""),
      hiddenByFor: (lat, lon) =>
        resolveHiddenBy(
          zoneLabelFor(user, lat, lon),
          isInHiddenSpot({ lat, lon }, edits.hiddenSpots),
          t("studio.location.positions.hiddenSpot"),
        ),
    });
    let hiddenCount = 0;
    let fixCount = 0;
    positionRows = rawRows.map((row) => {
      if (row.kind === "gap") {
        const { hours, minutes } = gapDurationParts(row.ms);
        return {
          kind: "gap",
          label:
            hours === 0
              ? t("studio.location.positions.gapMinutes", { minutes: String(Number(minutes)) })
              : t("studio.location.positions.gap", { hours: String(hours), minutes }),
        };
      }
      fixCount++;
      if (row.hiddenBy) hiddenCount++;
      return {
        kind: "fix",
        index: row.index,
        lat: row.lat,
        lon: row.lon,
        timeLabel: utcToZonedParts(new Date(row.epochSeconds * 1000), ownerLine.timezone).time,
        modeLabel: row.mode ? modeLabel(row.mode, t) : undefined,
        storedMode: row.mode,
        place: row.place || "–",
        distanceLabel:
          row.distanceM !== undefined ? t("studio.location.positions.distanceUnit", { distance: String(row.distanceM) }) : undefined,
        speedLabel:
          row.speedKmh !== undefined ? t("studio.location.positions.speedUnit", { speed: row.speedKmh.toFixed(1) }) : undefined,
        hiddenBy: row.hiddenBy,
        epochSeconds: row.epochSeconds,
      };
    });
    positionsSummary = translatePluralIn(locale, "studio.location.positions.summary", fixCount, {
      count: String(fixCount),
      hidden: String(hiddenCount),
    });
  }

  const tabClass = (active: boolean) =>
    `min-h-11 rounded-t-lg border-b-2 px-3 text-sm font-semibold leading-[2.5rem] ${
      active ? "border-yellow-400 text-ink-strong" : "border-transparent text-ink-secondary hover:text-ink-strong"
    }`;

  return (
    <StudioPage
      username={user}
      group="bringIn"
      width="wide"
      title={new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
        new Date(`${date}T00:00:00Z`),
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={`${tripBase}?day=${date}&view=${view}`}
          className="text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {trip.title}
        </Link>
        <RouteMenu username={user} tripId={tripId} tripTitle={trip.title} date={date} backHref={tripBase} />
      </div>

      {points.length > 0 && view === "mine" && (
        <div className="mt-3 flex gap-2 border-b border-line-quiet" role="tablist">
          <Link href={dayBase} role="tab" aria-selected={tab === "map"} className={tabClass(tab === "map")}>
            {t("studio.location.tabs.mapAndEdits")}
          </Link>
          <Link
            href={`${dayBase}?tab=positions`}
            role="tab"
            aria-selected={tab === "positions"}
            className={tabClass(tab === "positions")}
          >
            {t("studio.location.tabs.positions")}
          </Link>
        </div>
      )}

      {points.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayEmpty")}</p>
      ) : tab === "positions" && ownerLine ? (
        <PositionsTable
          rows={positionRows}
          points={ownerLine.points}
          gapAfter={ownerLine.gapAfter}
          region={region}
          streetMapsOn={streetMapsOn}
          timezone={ownerLine.timezone}
          summary={positionsSummary}
        />
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
