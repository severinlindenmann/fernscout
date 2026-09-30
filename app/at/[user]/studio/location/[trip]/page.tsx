import { notFound } from "next/navigation";
import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import WorldMap from "@/components/WorldMap";
import DayLineMap from "@/components/studio/location/DayLineMap";
import RouteMenu from "@/components/studio/location/RouteMenu";
import TrackEditsPanel from "@/components/studio/location/TrackEditsPanel";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn, translatePluralIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { AS_AUTHOR, getDays, getPlaces } from "@/lib/entries";
import { basemapForRoute } from "@/lib/basemap";
import { kmBetween } from "@/lib/mapFrame";
import { tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { isHiddenPlace } from "@/lib/gps/edits";
import { kmByMode, ownerTripLine, recordedTrips } from "@/lib/gps/api";
import { readerTrack } from "@/lib/gps/track";
import { primaryStreetMap } from "@/lib/maps/dir";
import { earliestTodayISO } from "@/lib/tripTime";
import { weekdayIndex } from "@/lib/studio/dayStrip";
import { shortWeekdayName, type TranslationKey } from "@/lib/i18n";

type LineSegment = { day?: string; points: [number, number][] };

/** Every calendar date from `start` to `end`, inclusive — restated per file,
 * the same trivial helper `RecordedTripsSection` (now retired) and
 * `lib/gps/api.ts`'s own private copy each keep of their own (see either's
 * doc comment): six lines, read only here. */
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

/** B2563 T1 bug fix, as a pure function — a reader's day count is this
 * view's own segments, never `trip.daysRecorded` (the owner's full
 * recording): a private zone, a hidden stretch or an unpublished day can
 * each leave a reader with fewer days than the owner recorded, and the old
 * code showed the owner's count under the Readers switch too. Exported so
 * `test/gps-route-page.test.ts` can prove the count directly. */
export function readersDayCount(segments: LineSegment[]): number {
  return new Set(segments.map((s) => s.day).filter((d): d is string => Boolean(d))).size;
}

/** `segments` (each already a continuous run) flattened into the one
 * `points`/`gapAfter` pair `DayLineMap` draws — B2568/B2566: a join between
 * two segments is always a real gap (the two runs were broken apart for a
 * reason — a private zone, a date boundary, a day with no positions in
 * between), so only a join *within* one already-continuous segment is ever
 * drawn solid. */
function toLineAndGaps(segments: LineSegment[]): { points: [number, number][]; gapAfter: boolean[] } {
  const points: [number, number][] = [];
  const gapAfter: boolean[] = [];
  segments.forEach((segment, si) => {
    segment.points.forEach((point, pi) => {
      points.push(point);
      if (pi < segment.points.length - 1) gapAfter.push(false);
    });
    if (si < segments.length - 1 && segment.points.length > 0) gapAfter.push(true);
  });
  return { points, gapAfter };
}

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

/** Shared with the day page's own Positions tab (`[date]/page.tsx`, B2563 T5)
 *  — one mapping from the store's own mode string to its translation key,
 *  never duplicated. */
export const MODE_KEYS: Record<string, TranslationKey> = {
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

/**
 * One recorded trip's own page — B2563 T1, the address `TripDetailView`
 * (retired) used to render at `?trip=<id>` under the overview. **Mine** is
 * `ownerTripLine`, the owner's raw, unclipped line; **Readers'** is exactly
 * `readerTrack` computed for a public reader — `{ includeDrafts: false }`,
 * `live` hard-`false` — never this owner's own wider grant, because the
 * point of the switch is "what does a stranger actually see".
 *
 * `day` is kept only to highlight which chip was last opened (a day page,
 * `[trip]/[date]/page.tsx`, is its own address now); the Mine/Readers switch
 * carries both `view` and `day` forward so a return trip from the day page
 * lands back on the same chip and the same side of the switch.
 */
export default async function TripPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/location/[trip]">) {
  const { user, trip: tripId } = await params;
  await requireStudioOwner(user);
  if (!(await isJournalOwner(user)) || !isEnabled("routeRecording", user)) notFound();

  const trip = recordedTrips(user).find((r) => r.tripId === tripId);
  if (!trip) notFound();

  const query = await searchParams;
  const view = query.view === "readers" ? "readers" : "mine";
  const day = typeof query.day === "string" ? query.day : undefined;

  const locale = await requestLocale();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const ref = tripRef(user, tripId);
  const base = `${journalPath(user)}/studio/location`;

  const places = view === "mine" ? getPlaces(ref, AS_AUTHOR) : getPlaces(ref, { includeDrafts: false });

  let segments: LineSegment[] = [];
  let positions: number;
  let daysShown: number;
  if (view === "mine") {
    segments = ownerTripLine(user, tripId)?.segments ?? [];
    positions = trip.positions;
    daysShown = trip.daysRecorded;
  } else {
    const publicDates = new Set(
      places.flatMap((p) => p.entries.map((e) => e.date)).filter((d): d is string => Boolean(d)),
    );
    segments =
      readerTrack(user, tripId, publicDates, false)?.segments.map((s) => ({ day: s.day, points: s.points })) ?? [];
    positions = segments.reduce((n, s) => n + s.points.length, 0);
    daysShown = readersDayCount(segments);
  }
  const km = kmAlong(segments);
  const allPoints = segments.flatMap((s) => s.points);
  const routePoints = allPoints.map(([lat, lng]) => ({ lat, lng }));
  // B2568 — "Daily Updates" (and any trip with no written days) has an empty
  // `places`, so framing the basemap on it drew nothing at all (the world
  // map, not even borders). Falls back to the route's own bounds — the same
  // points `WorldMap`'s own `frameHint` below frames the client's camera on —
  // whenever there is nothing written to frame on instead.
  const basemap = basemapForRoute(places.length > 0 ? places : routePoints);
  // B2566/B2568 — a real street map (the trip's own extracted region, or the
  // world file once B2566 lands) stands in for the plain SVG map whenever
  // one is available for this route; framed on the route's own points the
  // same way `coveringRegion` picks among a trip's several regions.
  const streetMapsOn = isEnabled("streetMaps");
  const region = streetMapsOn ? primaryStreetMap(user, tripId, routePoints) : undefined;
  const lineForMap = toLineAndGaps(segments);
  const modes = Object.entries(kmByMode(user, tripId)).filter(([, v]) => (v ?? 0) > 0);

  // B2568, item 6 — chips only for days that actually have a position in
  // this view (a reader's own chips come from `segments`, which is already
  // the public-only line above), never a future date, and never a bare
  // ISO string: "Mon 28", the same short-weekday-plus-day shape a date chip
  // uses everywhere else in the studio.
  const recordedDates = new Set(segments.map((s) => s.day).filter((d): d is string => Boolean(d)));
  const today = earliestTodayISO();
  const dayDates = datesBetween(trip.start, trip.end).filter((d) => recordedDates.has(d) && d <= today);
  const dayChipLabel = (date: string) => {
    const dayOfMonth = Number(date.slice(8, 10));
    return `${shortWeekdayName(locale, weekdayIndex(date))} ${dayOfMonth}`;
  };

  const hiddenDays = getDays(ref, AS_AUTHOR)
    .filter(
      (d) =>
        Number.isFinite(d.lead.lat) && Number.isFinite(d.lead.lng) && isHiddenPlace(user, tripId, { lat: d.lead.lat, lon: d.lead.lng }),
    )
    .map((d) => ({ date: d.date, slug: d.lead.slug, location: d.lead.location }));

  const linkFor = (v: "mine" | "readers") => {
    const q = new URLSearchParams({ view: v });
    if (day) q.set("day", day);
    return `${base}/${encodeURIComponent(tripId)}?${q}`;
  };

  return (
    <StudioPage username={user} group="bringIn" title={trip.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={base} className="text-sm font-semibold text-ink-strong underline underline-offset-2">
          {t("studio.location.tripDetail.back")}
        </Link>
        <RouteMenu
          username={user}
          tripId={tripId}
          tripTitle={trip.title}
          whoSeesHref={`${journalPath(user)}/studio/trip/visibility?trip=${encodeURIComponent(tripId)}`}
          backHref={base}
        />
      </div>

      <div className="mt-3 inline-flex rounded-full border border-line-strong p-1" role="group">
        <Link
          href={linkFor("mine")}
          data-testid="view-mine"
          aria-current={view === "mine" ? "true" : undefined}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold leading-[2.5rem] ${
            view === "mine" ? "bg-yellow-400 text-yellow-950" : "text-ink-strong"
          }`}
        >
          {t("studio.location.tripDetail.mine")}
        </Link>
        <Link
          href={linkFor("readers")}
          data-testid="view-readers"
          aria-current={view === "readers" ? "true" : undefined}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold leading-[2.5rem] ${
            view === "readers" ? "bg-yellow-400 text-yellow-950" : "text-ink-strong"
          }`}
        >
          {t("studio.location.tripDetail.readers")}
        </Link>
      </div>

      {allPoints.length > 0 ? (
        region ? (
          <div className="mt-3 h-64 overflow-hidden rounded-xl border border-line-quiet lg:h-96">
            <DayLineMap
              points={lineForMap.points}
              gapAfter={lineForMap.gapAfter}
              bounds={region.bounds}
              pmtilesUrl={region.url}
              className="h-full w-full"
            />
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">
            <WorldMap places={places} basemap={basemap} track={segments.map((s) => s.points)} frameHint={routePoints} />
          </div>
        )
      ) : (
        <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.tripDetail.nothingToShow")}</p>
      )}

      {dayDates.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink-strong">{t("studio.location.tripDetail.daysHeading")}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {dayDates.map((d) => (
              <li key={d}>
                <Link
                  href={`${base}/${encodeURIComponent(tripId)}/${d}?view=${view}`}
                  data-testid={`day-link-${d}`}
                  aria-current={day === d ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${
                    day === d ? "border-yellow-400 bg-yellow-100 text-yellow-950" : "border-line-strong text-ink-strong"
                  }`}
                >
                  {dayChipLabel(d)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 space-y-1">
        <p className="text-sm text-ink-secondary">
          {translatePluralIn(locale, "studio.location.tripDetail.stats", daysShown, {
            days: String(daysShown),
            km: km.toFixed(1),
            positions: String(positions),
          })}
        </p>
        <p className="text-sm text-ink-secondary">{t("studio.location.tripDetail.sparseNote")}</p>
      </div>
      {view === "mine" && modes.length > 0 && (
        <p className="text-sm text-ink-secondary">
          {modes.map(([mode, v]) => `${v} km ${modeLabel(mode, t)}`).join(" · ")}
        </p>
      )}

      <TrackEditsPanel username={user} tripId={tripId} canAdd={false} hiddenDays={hiddenDays} />
    </StudioPage>
  );
}

/** Shared with the day page's own Positions tab (`[date]/page.tsx`, B2563 T5). */
export function modeLabel(mode: string, t: (key: TranslationKey, vars?: Record<string, string>) => string): string {
  const key = MODE_KEYS[mode];
  return key ? t(key) : mode;
}
