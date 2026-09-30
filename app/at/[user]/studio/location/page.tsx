import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import GpsZones from "@/components/studio/location/GpsZones";
import RecordingStrip from "@/components/studio/location/RecordingStrip";
import TrackThumb from "@/components/studio/location/TrackThumb";
import { requestLocale, translateIn, translatePluralIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { ownerTripLine, recordedTrips, type RecordedTrip } from "@/lib/gps/api";
import { kmBetween } from "@/lib/mapFrame";
import { journalPath } from "@/lib/journalPath";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/** Pinned first, then the two most recent others — D10. Never more than
 *  three rows without `?all=1`. */
const VISIBLE_WITHOUT_ALL = 3;

type LineSegment = { day?: string; points: [number, number][] };

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
 * D10, as a pure function — the trip being recorded pinned first, then the
 * rest by most recent start date, and never more than
 * `VISIBLE_WITHOUT_ALL` rows unless `showAll`. Exported so
 * `test/gps-route-page.test.ts` can prove the limiting rule directly, rather
 * than through a full page render.
 */
export function orderAndLimitTrips(
  recorded: RecordedTrip[],
  showAll: boolean,
): { visible: RecordedTrip[]; ordered: RecordedTrip[]; pinnedId: string | undefined } {
  const pinned = recorded.find((r) => r.recording?.state === "recording");
  const rest = recorded.filter((r) => r !== pinned).sort((a, b) => b.start.localeCompare(a.start));
  const ordered = pinned ? [pinned, ...rest] : rest;
  const visible = showAll ? ordered : ordered.slice(0, VISIBLE_WITHOUT_ALL);
  return { visible, ordered, pinnedId: pinned?.tripId };
}

/**
 * "Your routes" — B2226, redrawn by B2563. Three addresses now share this
 * one door: this file is the overview alone (D1) — a trip's own page is
 * `[trip]/page.tsx`, a day's `[trip]/[date]/page.tsx`. Opening a trip used to
 * append `TripDetailView` below the whole list on this same page; it is a
 * real navigation now, so the browser's own Back walks back up the levels.
 *
 * `requireStudioOwner`, not the older `requireExtractOwner` — this page
 * matches every other flow under `/studio`. With `routeRecording` off, or
 * for a caller who is not the journal's real owner (the operator's admin
 * cookie included — B2226 security review, restated by B2563's own review),
 * the trips list, the recording strip and the private-places card are all
 * simply absent; only the import/history links and the page frame remain.
 */
export default async function StudioLocationPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/location">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const query = await searchParams;
  const showAll = query.all === "1";
  const locale = await requestLocale();

  const routeRecordingOn = (await isJournalOwner(user)) && isEnabled("routeRecording", user);

  let tripsSection = null;
  let stripSection = null;
  if (routeRecordingOn) {
    const recorded = recordedTrips(user);
    const { visible, ordered, pinnedId } = orderAndLimitTrips(recorded, showAll);

    tripsSection = (
      <section className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
        <h2 className="font-display text-base font-semibold text-ink-strong">{translateIn(locale, "studio.location.route.heading")}</h2>
        {recorded.length === 0 ? (
          <p className="mt-2 text-sm text-ink-secondary">{translateIn(locale, "studio.location.route.empty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-quiet">
            {visible.map((trip) => (
              <TripRow key={trip.tripId} username={user} trip={trip} recording={trip.tripId === pinnedId} locale={locale} />
            ))}
          </ul>
        )}
        {!showAll && ordered.length > VISIBLE_WITHOUT_ALL && (
          <Link
            href={`${journalPath(user)}/studio/location?all=1`}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {translatePluralIn(locale, "studio.location.route.showAll", ordered.length, { count: String(ordered.length) })}
          </Link>
        )}
      </section>
    );

    // The strip's own trip: the one actually recording, else the current
    // trip if — and only if — it already has a `recordingState` to show
    // (`recorded` is the one caller `recordingState` may have, B2226/B2563
    // security review; a current trip with nothing recorded yet simply has
    // no state to show here rather than this page reading it a second way).
    const current = getCurrentTrip(user);
    const stripEntry = pinnedId
      ? recorded.find((r) => r.tripId === pinnedId)
      : current
        ? recorded.find((r) => r.tripId === current.id)
        : undefined;
    const stripTripMeta = stripEntry ? getTrips(user).find((tr) => tr.id === stripEntry.tripId) : undefined;
    const newest = recorded.reduce<string | undefined>(
      (max, r) => (!max || r.lastReceived > max ? r.lastReceived : max),
      undefined,
    );
    stripSection = (
      <RecordingStrip
        username={user}
        trip={stripTripMeta ? { id: stripTripMeta.id, title: stripTripMeta.title, start: stripTripMeta.start, end: stripTripMeta.end } : null}
        recording={stripEntry?.recording ?? null}
        newestPosition={newest}
      />
    );
  }

  const streetMapsOn = isEnabled("streetMaps");

  return (
    <StudioPage
      username={user}
      group="bringIn"
      width="board"
      title={translateIn(locale, "studio.location.title")}
      lede={translateIn(locale, "studio.location.lede")}
    >
      <div className="flex flex-col gap-4">
        {stripSection}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
          {tripsSection}
          <section id="private-places" className="rounded-2xl border border-line-quiet bg-surface-raised p-4 [&>section]:mt-0">
            <GpsZones
              username={user}
              streetMapsOn={streetMapsOn}
              mode="overview"
              newPlaceHref={`${journalPath(user)}/studio/location/places/new`}
            />
          </section>
        </div>

      <div className="flex flex-wrap items-center gap-2 gap-x-6 border-t border-line-quiet pt-4 text-sm">
        <Link
          href={`${journalPath(user)}/studio/location/import`}
          className={
            routeRecordingOn
              ? "font-semibold text-ink-secondary underline underline-offset-2"
              : "inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-4 font-semibold text-yellow-950"
          }
        >
          {translateIn(locale, "studio.location.importLink")}
        </Link>
        <Link
          href={`${journalPath(user)}/studio/location/history`}
          className="font-semibold text-ink-secondary underline underline-offset-2"
        >
          {translateIn(locale, "studio.location.historyLink")}
        </Link>
      </div>
      </div>
    </StudioPage>
  );
}

/** One row: thumbnail, title, "N of M days · km" (D6 — no gap count). A
 *  `hasPublishedTrack`-only row (D7) has no positions to draw a line or a
 *  count from, so it says so and is greyed rather than pretending to be a
 *  normal card. */
function TripRow({
  username,
  trip,
  recording,
  locale,
}: {
  username: string;
  trip: RecordedTrip;
  recording: boolean;
  locale: string;
}) {
  const segments = trip.hasPublishedTrack ? [] : (ownerTripLine(username, trip.tripId)?.segments ?? []);
  const km = kmAlong(segments);
  const href = `${journalPath(username)}/studio/location/${encodeURIComponent(trip.tripId)}`;

  return (
    <li>
      <Link href={href} className={`flex items-center gap-3 py-3 ${trip.hasPublishedTrack ? "opacity-60" : ""}`}>
        <TrackThumb segments={segments.map((s) => s.points)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold text-ink-strong">{trip.title}</span>{" "}
            {(recording || trip.hasPublishedTrack) && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                  recording ? "bg-green-100 text-green-700" : "bg-surface-subtle text-ink-secondary"
                }`}
              >
                {translateIn(locale, recording ? "studio.location.route.recordingBadge" : "studio.location.route.publishedOnlyBadge")}
              </span>
            )}
          </span>
          <span className="block text-sm text-ink-secondary">
            {trip.hasPublishedTrack
              ? translateIn(locale, "studio.location.route.publishedOnlyRow", { tripDays: String(trip.tripDays) })
              : translatePluralIn(locale, "studio.location.route.overviewFacts", trip.daysRecorded, {
                  days: String(trip.daysRecorded),
                  tripDays: String(trip.tripDays),
                  km: km.toFixed(1),
                })}
          </span>
        </span>
        <span aria-hidden className="text-ink-secondary">
          ›
        </span>
      </Link>
    </li>
  );
}
