import Link from "next/link";
import WorldMap from "@/components/WorldMap";
import DayLineMap from "./DayLineMap";
import TrackEditsPanel from "./TrackEditsPanel";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn, translatePluralIn } from "@/lib/locales";
import { AS_AUTHOR, getPlaces } from "@/lib/entries";
import { basemapForRoute } from "@/lib/basemap";
import { kmBetween } from "@/lib/mapFrame";
import { tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { primaryStreetMap } from "@/lib/maps/dir";
import { ownerDayLine, ownerTripLine, type RecordedTrip } from "@/lib/gps/api";
import { readerTrack } from "@/lib/gps/track";

type LineSegment = { day?: string; points: [number, number][] };

/** Every calendar date from `start` to `end`, inclusive — restated from
 * `RecordedTripsSection`'s own private helper of the same name and shape
 * (both trivial, both read only by their own file, so sharing one would cost
 * an import for six lines). */
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
 * One recorded trip's own page inside the "Your routes" overview — B2540, S3
 * A and S5 A, reached at `?trip=<id>` (`&view=mine|readers`, `&day=<date>`),
 * every bit of it server-rendered from the query string rather than restyled
 * in the browser: **Mine** is `ownerTripLine` (the owner's raw, unclipped
 * line, same door `RecordedTripsSection`'s own preview already uses);
 * **Readers'** is exactly `readerTrack` computed for a public reader —
 * `{ includeDrafts: false }`, `live` hard-`false` — never the owner's own
 * wider grant, because the whole point of the switch is "what does a
 * stranger actually see", not "what would a signed-in guest see".
 *
 * The day panel (`day` present) draws with `DayLineMap` when `streetMaps` is
 * on and this trip has a region file (B2535); otherwise it falls back to the
 * same `WorldMap` the trip overview uses, which cannot dash one edge of a
 * line differently from the rest — a long jump is drawn as a break in the
 * line instead there, never as a straight line over the gap. Only the street
 * map path actually dashes it, which is where the gap rule
 * (`ownerDayLine`, ">10 min and >600 m") is drawn from.
 */
export default async function TripDetailView({
  username,
  trip,
  view,
  day,
}: {
  username: string;
  trip: RecordedTrip;
  view: "mine" | "readers";
  day?: string;
}) {
  const locale = await requestLocale();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);
  const ref = tripRef(username, trip.tripId);
  const dates = datesBetween(trip.start, trip.end);

  const places = view === "mine" ? getPlaces(ref, AS_AUTHOR) : getPlaces(ref, { includeDrafts: false });
  const basemap = basemapForRoute(places);

  let segments: LineSegment[] = [];
  let positions: number;
  if (view === "mine") {
    segments = ownerTripLine(username, trip.tripId)?.segments ?? [];
    positions = trip.positions;
  } else {
    // A public reader, exactly — never this owner's own wider grant. Dates a
    // reader may see are the trip's published days only; `live` is hard
    // `false`, the same "never for a stranger" rule the live tail itself
    // follows (docs/gps.md).
    const publicDates = new Set(
      places.flatMap((p) => p.entries.map((e) => e.date)).filter((d): d is string => Boolean(d)),
    );
    segments =
      readerTrack(username, trip.tripId, publicDates, false)?.segments.map((s) => ({
        day: s.day,
        points: s.points,
      })) ?? [];
    positions = segments.reduce((n, s) => n + s.points.length, 0);
  }
  const km = kmAlong(segments);
  const gaps = Math.max(0, segments.length - 1);
  const allPoints = segments.flatMap((s) => s.points);

  const base = `${journalPath(username)}/studio/location`;
  const linkFor = (v: "mine" | "readers", d?: string) => {
    const q = new URLSearchParams({ trip: trip.tripId, view: v });
    if (d) q.set("day", d);
    return `${base}?${q}`;
  };

  const streetMapsOn = isEnabled("streetMaps");
  const region = streetMapsOn ? primaryStreetMap(username, trip.tripId) : undefined;

  return (
    <section className="mt-10 rounded-2xl border border-line-quiet bg-surface-raised p-4" data-testid="trip-detail">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink-strong">{trip.title}</h2>
        <Link href={base} className="text-sm font-semibold text-ink-strong underline underline-offset-2">
          {t("studio.location.tripDetail.back")}
        </Link>
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

      <p className="mt-3 text-sm text-ink-secondary">
        {translatePluralIn(locale, "studio.location.tripDetail.stats", trip.daysRecorded, {
          days: String(trip.daysRecorded),
          km: km.toFixed(1),
          positions: String(positions),
          gaps: String(gaps),
        })}
      </p>

      {allPoints.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">
          <WorldMap places={places} basemap={basemap} track={segments.map((s) => s.points)} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-secondary">{t("studio.location.tripDetail.nothingToShow")}</p>
      )}

      <Link
        href={`${journalPath(username)}/studio/trip/visibility?trip=${encodeURIComponent(trip.tripId)}`}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
      >
        {t("studio.location.tripDetail.whoSeesLink")}
      </Link>

      <h3 className="mt-4 text-sm font-semibold text-ink-strong">{t("studio.location.tripDetail.daysHeading")}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {dates.map((d) => (
          <li key={d}>
            <Link
              href={linkFor(view, d)}
              data-testid={`day-link-${d}`}
              aria-current={day === d ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${
                day === d ? "border-yellow-400 bg-yellow-100 text-yellow-950" : "border-line-strong text-ink-strong"
              }`}
            >
              {d}
            </Link>
          </li>
        ))}
      </ul>

      {day && (
        <DayPanel username={username} trip={trip} date={day} view={view} region={region} t={t} />
      )}
    </section>
  );
}

async function DayPanel({
  username,
  trip,
  date,
  view,
  region,
  t,
}: {
  username: string;
  trip: RecordedTrip;
  date: string;
  view: "mine" | "readers";
  region: { url: string; bounds: [[number, number], [number, number]] } | undefined;
  t: (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => string;
}) {
  const dates = datesBetween(trip.start, trip.end);
  let points: [number, number][] = [];
  let gapAfter: boolean[] = [];
  if (view === "mine") {
    const line = ownerDayLine(username, trip.tripId, date);
    points = line?.points ?? [];
    gapAfter = line?.gapAfter ?? [];
  } else {
    const ref = tripRef(username, trip.tripId);
    const places = getPlaces(ref, { includeDrafts: false });
    const publicDates = new Set(
      places.flatMap((p) => p.entries.map((e) => e.date)).filter((d): d is string => Boolean(d)),
    );
    if (publicDates.has(date)) {
      const day = readerTrack(username, trip.tripId, publicDates, false)?.segments.find((s) => s.day === date);
      points = day?.points ?? [];
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line-quiet p-3" data-testid="day-panel">
      <h4 className="text-sm font-semibold text-ink-strong">{date}</h4>
      {points.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayEmpty")}</p>
      ) : region ? (
        <div className="mt-2 h-64 overflow-hidden rounded-xl border border-line-quiet">
          <DayLineMap
            points={points}
            gapAfter={gapAfter}
            bounds={region.bounds}
            pmtilesUrl={region.url}
            className="h-full w-full"
          />
        </div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-line-quiet">
          {/* No trip region file (B2535) yet, or `streetMaps` off — the
              WorldMap fallback the ticket named. It cannot dash a single
              edge, so a real gap is drawn as a break in the line instead of
              a straight line over it (never invented), same rule
              `RecordedSegment.gap` already documents in tripFrame.ts. */}
          <WorldMap places={[]} basemap={null} track={splitAtGaps(points, gapAfter)} />
        </div>
      )}
      {gapAfter.some(Boolean) && (
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.tripDetail.dayGapNote")}</p>
      )}
      <TrackEditsPanel username={username} tripId={trip.tripId} days={dates} />
    </div>
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
