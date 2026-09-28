import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { draftsVisibleTo, mayReadLiveTrack, mayReadTrip } from "@/lib/tripGate";
import { recordTripView } from "@/lib/analytics/record";
import MapPageContent from "./MapPageContent";
import { basemapForRoute } from "@/lib/basemap";
import { isEnabled } from "@/lib/capabilities";
import { primaryStreetMap, streetMapRegionFiles } from "@/lib/maps/dir";
import { framePoints } from "@/lib/map/tripFrame";
import { getDays, getPlaces, getTripStats } from "@/lib/entries";
import { getMapDays } from "@/lib/map/mapDays";
import { getPlan } from "@/lib/plan";
import { liveTailStatus, readerTrack } from "@/lib/gps/track";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { currentTripRef, getTrip } from "@/lib/trips";
import { isOver } from "@/lib/tripTime";
import TripProvider from "@/components/TripProvider";
import RouteBoundary from "@/components/RouteBoundary";
import type { TranslationKey } from "@/lib/i18n";
import type { Trip } from "@/lib/types";

import { journalPath } from "@/lib/journalPath";
/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 *
 * And one tense, also on purpose (B118). B54 gave the heading a choice between
 * "Where we've been" and "Where we're going" and left this function saying the
 * first unconditionally, on the reasoning that a *current* trip with no days
 * written is a brief window. It is not: `getCurrentTrip` falls back to the most
 * recent past trip when nothing is current, so every journal between trips
 * whose newest trip has no entries served `<h1>Where we're going</h1>` under
 * `<title>Where we've been</title>` — one page, two tenses, about one trip.
 *
 * Asked here the same way the page below asks it — whether `getPlaces` returns
 * anything, **or** `isOver` says the trip itself is finished (B1289) — so the
 * two cannot drift apart again. A finished trip whose only day has no
 * coordinates (`unrecorded: [coordinates]`, ordinary for anybody writing
 * without GPS) used to fall through to the planned-tense copy on the reasoning
 * that nothing had been drawn yet; the trip being over is a fact the calendar
 * already knows regardless of what got drawn, and the trip's own hero
 * (`isOver` in `lib/tripTime.ts`) already says so three lines into the page.
 * `getPlaces` and `getDays` are both cached per directory (lib/entries.ts), so
 * the page below does not read the trip a second time.
 *
 * And, since B336, the same *audience* the page asks it for. `getPlaces` used
 * to be called here with no options — always published-only — so an owner
 * whose only entries were drafts got `<title>Where we're going</title>` over a
 * page that then rendered their draft markers under "Where we've been". This
 * runs behind the same cookie the page reads, so the tense this reader is
 * shown here is the tense their own request is about to render.
 */
/** B2550 — kept in the client router cache for 30s: a `Link` tap back to a
 * day, trip or list a reader already opened moments ago (Trips → back, a
 * `StoryPager` step) shows what was already fetched rather than waiting on
 * the server again. Owner-only mutations do not live on this page (they are
 * under `/studio`), so nothing here can go stale in a way that matters more
 * than a 30s wait would have cost anyway. Pages only, per Next's own rule —
 * never on a layout. */
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/map">): Promise<Metadata> {
  const { user } = await params;
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  // Not `currentTripOrRedirect`: metadata is resolved alongside the page, and
  // the page is the one that decides where a journal with no current trip goes.
  // A journal with nothing in it has been nowhere and is going nowhere; the
  // planned wording is the one that claims less. Same shape as the day
  // permalink's metadata, which resolves the trip this way too.
  const ref = currentTripRef(user);
  const trip = ref ? getTrip(ref) : undefined;
  const drafts = trip ? await draftsVisibleTo(trip) : { visible: false, canPublish: false };
  const read = { includeDrafts: drafts.visible };
  // `days.length > 0` guards `isOver` here — B118 is still the rule for a
  // trip with nothing written at all: "has been nowhere and is going
  // nowhere" stays true of a zero-day trip even once its dates are past, and
  // `map-tense.test.tsx` is that policy asserted. `isOver` only gets to move
  // the tense once there is at least one day for it to be true *about*.
  const days = ref ? getDays(ref, read) : [];
  const visited =
    ref !== undefined &&
    (getPlaces(ref, read).length > 0 ||
      (trip !== undefined && days.length > 0 && isOver(trip, days)));
  // The subtitle switches with it. It is the `<meta name="description">` and
  // the sharing card's blurb, and "Tap any stop to see how long we stayed" is
  // the same false claim as the heading, one line further down.
  const heading: TranslationKey = visited ? "map.title" : "map.titlePlanned";
  const blurb: TranslationKey = visited ? "map.subtitle" : "map.subtitlePlanned";
  const description = translateIn(journal, blurb);
  const shared = translateIn(journal, heading);
  return {
    title: translateIn(reader, heading),
    description,
    alternates: { canonical: `${journalPath(user)}/map` },
    openGraph: { type: "website", title: shared, description, url: `${journalPath(user)}/map` },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function MapPage({ params }: PageProps<"/at/[user]/map">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = await currentTripOrRedirect(user);
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  // B566.
  await recordTripView(trip, "map");
  // Planned stops derived from drafts are the trip's own next moves — shown
  // to whoever may see the drafts themselves, which since B327 is the owner
  // *or* somebody on the trip. Widened deliberately: `getPlan`'s contract used
  // to say "the owner", on the reasoning that a reader must not learn where
  // somebody is going next. Somebody on the trip is not that reader — they are
  // on the bus, and where it goes next is not a secret from them.
  const drafts = await draftsVisibleTo(trip);
  return (
    <TripProvider trip={trip} isCurrent canPublish={drafts.canPublish}>
      {/* The redirect for a journal with no trip is above this line; see
          components/RouteSkeleton.tsx. */}
      <RouteBoundary shape="map">
        <MapBody trip={trip} includeDrafts={drafts.visible} />
      </RouteBoundary>
    </TripProvider>
  );
}

/**
 * The map, below the page's boundary — see `TripMapBody` in
 * app/at/[user]/trips/[trip]/map/page.tsx, which this mirrors for the bare URL.
 * `includeDrafts` is the page's answer for this reader, not a question this
 * asks again.
 */
async function MapBody({ trip, includeDrafts }: { trip: Trip; includeDrafts: boolean }) {
  const tripId = trip.ref;
  const plan = getPlan(tripId, { includeDrafts });
  // B336: the solid "where we've been" markers asked this question one line
  // below `getPlan` and got a different answer, because this call carried no
  // options at all — always published-only, regardless of who was looking.
  // The dashed planned route already followed `drafts.visible`; the stats
  // block below has to agree with both, or its counts contradict the markers
  // on the same map.
  const read = { includeDrafts };
  const stats = getTripStats(tripId, read);
  const places = getPlaces(tripId, read);
  // Whether there is a day written at all, as distinct from whether any of
  // them carries coordinates — B1289. `places` answers neither question on
  // its own: a published day with no `location:` never appears in it, so
  // "no places" used to read as "no days written" even when one was there.
  const days = getDays(tripId, read);
  // The trip hero's own tense (`isOver`, lib/tripTime.ts) — B1289. A finished
  // trip whose only day has no coordinates used to stay in the planned tense
  // forever, because `places` was empty and nothing else was asked.
  const over = isOver(trip, days);
  // Clipped here so the reader gets their own trip's worth of map rather than
  // the whole bundle — see the same two lines in the trip-scoped route.
  // B2534: framed on the places where days happened, never a far outlier —
  // `WorldMap`'s own client-side `base` calls the same `framePoints` on the
  // same `places` array, so the two keep agreeing.
  // The trip's own main-region places (`framePoints`'s own doc) — reused
  // below to pick whichever extracted region file actually covers this
  // trip's main region, rather than an operator's first-extracted one
  // (B2560: `primaryStreetMap`'s own doc explains why `[0]` alone was wrong).
  const mainRegionPoints = places.length > 0 ? framePoints(places) : [];
  const basemap = basemapForRoute(mainRegionPoints.length > 0 ? mainRegionPoints : plan.stops);
  // B2535: on only when the capability is on *and* something has been
  // extracted for this trip — `undefined` otherwise, which is what tells
  // `MapPageContent` to keep drawing the SVG map exactly as it does today.
  const streetMap = isEnabled("streetMaps")
    ? (primaryStreetMap(trip.username, trip.id, mainRegionPoints) ?? null)
    : null;
  // B2560 — every region file this trip has, so a reader's region switch on
  // the client can pick the file that actually covers whichever region they
  // switched to, rather than always redrawing the main region's own tiles.
  const streetMapRegions = isEnabled("streetMaps")
    ? (streetMapRegionFiles(trip.username, trip.id) ?? null)
    : null;
  // The ground actually covered, where the owner has derived it (B665). Read
  // here rather than in the component: it is a file in the trip folder, behind
  // the same gate as everything else on this page, and `mayReadTrip` in the
  // page above is what stands between it and a reader. Since B2202, derivation
  // covers every trip date regardless of publish state — `readerTrack` is what
  // actually keeps a draft day's or too-recent fix's segment off this page,
  // filtered to the exact dates `days` above already resolved for this reader.
  const visibleDates = new Set(days.map((d) => d.date));
  // B2536 — whether this viewer's own request may see the last 24h at all.
  // The owner always does; a named guest does unless the trip's own
  // `guestsLive` says 24h late; a public reader never does. Computed once
  // and threaded through, never re-derived per marker.
  const live = await mayReadLiveTrack(trip);
  // B2537: each run carries the calendar day its own local-midnight window
  // belongs to (`TrackSegment.day`), threaded through so the map page can
  // draw the real recorded/gap line grammar and fit a selected day's own
  // line — see `recordedSegmentsFor` in `MapPageContent`.
  const trackByDay =
    readerTrack(trip.username, trip.id, visibleDates, live)?.segments.map((s) => ({
      date: s.day,
      points: s.points,
    })) ?? [];
  // B2536 — the badge/dot copy, from the same filtered answer `readerTrack`
  // just drew from: only when a tail segment actually survived for this
  // reader's own visible dates, and only when the tail is still under 24h
  // old itself (`liveTailStatus`'s own `tailIsLive`) — never a stale "N min
  // ago" from a trip nobody has re-derived in days.
  const liveTail = live ? liveTailStatus(trip.username, trip.id, visibleDates) : undefined;
  return (
    <MapPageContent
      places={places}
      days={getMapDays(tripId, read)}
      plan={plan.stops}
      trackByDay={trackByDay}
      liveTail={liveTail}
      reachedCount={plan.reachedCount}
      basemap={basemap}
      over={over}
      hasDays={days.length > 0}
      streetMap={streetMap}
      streetMapRegions={streetMapRegions}
      stats={{
        tripDays: stats.tripDays,
        places: stats.places,
        countries: stats.countries,
        totalMedia: stats.totalMedia,
      }}
    />
  );
}
