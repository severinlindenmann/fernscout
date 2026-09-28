import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadLiveTrack, readFor, mayReadTrip } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import MapPageContent from "@/app/at/[user]/(trip)/map/MapPageContent";
import { basemapForRoute } from "@/lib/basemap";
import { isEnabled } from "@/lib/capabilities";
import { primaryStreetMap } from "@/lib/maps/dir";
import { framePoints } from "@/lib/map/tripFrame";
import { getDays, getPlaces, getTripStats, type ReadOptions } from "@/lib/entries";
import { getMapDays } from "@/lib/map/mapDays";
import { getPlan } from "@/lib/plan";
import { liveTailStatus, readerTrack } from "@/lib/gps/track";
import { getTrip, tripRef } from "@/lib/trips";
import { isOver } from "@/lib/tripTime";
import TripProvider from "@/components/TripProvider";
import RouteBoundary from "@/components/RouteBoundary";
import type { Trip } from "@/lib/types";

import { journalPath } from "@/lib/journalPath";
export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/trips/[trip]/map">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  const locale = await requestLocale();
  // The tab title carried the same past tense the page did — "Wo wir waren"
  // for a trip nobody has left for yet. Asked the same way the page asks it,
  // on whether there are days rather than on `trip.status`, so the two can
  // never disagree. `getPlaces` is cached per directory (lib/entries.ts), so
  // this does not re-read the trip a second time.
  //
  // And, since B336, the same audience the page asks it for — see the sibling
  // route's `generateMetadata` for why a bare `getPlaces` call here drifted
  // from what the page itself renders.
  const { read, canPublish } = await readFor(trip);
  const visited = getPlaces(trip.ref, read).length > 0;
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, visited ? "map.title" : "map.titlePlanned"),
      trip: trip.title,
    }),
    description: `Every stop on ${trip.title}, with routes coloured by how we travelled.`,
    alternates: { canonical: `${journalPath(user)}/trips/${trip.id}/map` },
  };
}

export default async function TripMapPage({ params }: PageProps<"/at/[user]/trips/[trip]/map">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`${journalPath(user)}/map`);

  // See app/at/[user]/(trip)/map/page.tsx — drafted stops are the owner's alone.
  // B327 — see the sibling route for why this widened past the owner. B336:
  // the solid markers and the stats block below now ask the same question,
  // rather than the bare, always-published-only calls they used to be.
  const { read, canPublish } = await readFor(trip);
  return (
    <TripProvider trip={trip} isCurrent={false} canPublish={canPublish}>
      {/* The 404 and the redirect are above this line; see
          components/RouteSkeleton.tsx. */}
      <RouteBoundary shape="map">
        <TripMapBody trip={trip} read={read} />
      </RouteBoundary>
    </TripProvider>
  );
}

/**
 * The map, below the page's boundary: every stop, the recorded route and
 * the basemap framed around them. Handed only the audience the page above
 * resolved for this reader.
 */
async function TripMapBody({ trip, read }: { trip: Trip; read: ReadOptions }) {
  const plan = getPlan(trip.ref, read);
  const stats = getTripStats(trip.ref, read);
  const places = getPlaces(trip.ref, read);
  // The dates this reader is actually shown an entry for — B2202. Derivation
  // now covers every trip date regardless of publish state, so this, not the
  // file on disk, is what keeps a draft day's route off this page.
  const days = getDays(trip.ref, read);
  // B1289 — this route never asked either question before this fix, so a
  // finished trip's own map page (not the bare `/map` route, which already
  // asked both) said "Where we're going" about a trip that ended years ago.
  // Same resolution as the sibling route's own `MapBody`.
  const over = isOver(trip, days);
  // The frame is worked out here as well as in the component, so that only the
  // few dozen kilobytes this trip covers cross the wire rather than the eleven
  // megabytes of the baked bundle. `frameRoute` is pure, so the two agree.
  // B2534: framed on the places where days happened, never a far outlier —
  // `WorldMap`'s own client-side `base` calls the same `framePoints` on the
  // same `places` array, so the two keep agreeing.
  const basemap = basemapForRoute(places.length > 0 ? framePoints(places) : plan.stops);
  // B2536 — same resolution the bare map page makes; see its own comment.
  const live = await mayReadLiveTrack(trip);
  const visibleDates = new Set(days.map((d) => d.date));
  // The same filtered, freshness-checked answer `readerTrack` draws the dot
  // from below — never a raw, unfiltered `readTail()`.
  const liveTail = live ? liveTailStatus(trip.username, trip.id, visibleDates) : undefined;
  // B2535 — see the sibling route's own copy of this line.
  const streetMap = isEnabled("streetMaps") ? (primaryStreetMap(trip.username, trip.id) ?? null) : null;
  return (
    <MapPageContent
      places={places}
      days={getMapDays(trip.ref, read)}
      plan={plan.stops}
      streetMap={streetMap}
      // B665, and behind `mayReadTrip` in the page above like everything
      // else here. B2537 — see the sibling route's own comment on why `day`
      // is carried through rather than dropped.
      trackByDay={
        readerTrack(trip.username, trip.id, visibleDates, live)?.segments.map((s) => ({
          date: s.day,
          points: s.points,
        })) ?? []
      }
      liveTail={liveTail}
      reachedCount={plan.reachedCount}
      basemap={basemap}
      over={over}
      hasDays={days.length > 0}
      stats={{
        tripDays: stats.tripDays,
        places: stats.places,
        countries: stats.countries,
        totalMedia: stats.totalMedia,
      }}
    />
  );
}
