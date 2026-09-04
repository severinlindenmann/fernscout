import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { draftsVisibleTo, mayReadTrip } from "@/lib/tripGate";
import MapPageContent from "./MapPageContent";
import { basemapForRoute } from "@/lib/basemap";
import { getPlaces, getTripStats } from "@/lib/entries";
import { getPlan } from "@/lib/plan";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { currentTripRef, getTrip } from "@/lib/trips";
import TripProvider from "@/components/TripProvider";
import type { TranslationKey } from "@/lib/i18n";

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
 * Asked here the same way `MapPageContent` asks it — on whether `getPlaces`
 * returns anything, not on `trip.status` — so the two cannot drift apart again.
 * `getPlaces` is cached per directory (lib/entries.ts), so the page below does
 * not read the trip a second time.
 *
 * And, since B336, the same *audience* the page asks it for. `getPlaces` used
 * to be called here with no options — always published-only — so an owner
 * whose only entries were drafts got `<title>Where we're going</title>` over a
 * page that then rendered their draft markers under "Where we've been". This
 * runs behind the same cookie the page reads, so the tense this reader is
 * shown here is the tense their own request is about to render.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[user]/map">): Promise<Metadata> {
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
  const visited = ref !== undefined && getPlaces(ref, { includeDrafts: drafts.visible }).length > 0;
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
    alternates: { canonical: "/[user]/map" },
    openGraph: { type: "website", title: shared, description, url: "/map" },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function MapPage({ params }: PageProps<"/[user]/map">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = currentTripOrRedirect(user);
  const tripId = trip.ref;
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  // Planned stops derived from drafts are the trip's own next moves — shown
  // to whoever may see the drafts themselves, which since B327 is the owner
  // *or* somebody on the trip. Widened deliberately: `getPlan`'s contract used
  // to say "the owner", on the reasoning that a reader must not learn where
  // somebody is going next. Somebody on the trip is not that reader — they are
  // on the bus, and where it goes next is not a secret from them.
  const drafts = await draftsVisibleTo(trip);
  const plan = getPlan(tripId, { includeDrafts: drafts.visible });
  // B336: the solid "where we've been" markers asked this question one line
  // below `getPlan` and got a different answer, because this call carried no
  // options at all — always published-only, regardless of who was looking.
  // The dashed planned route already followed `drafts.visible`; the stats
  // block below has to agree with both, or its counts contradict the markers
  // on the same map.
  const read = { includeDrafts: drafts.visible };
  const stats = getTripStats(tripId, read);
  const places = getPlaces(tripId, read);
  // Clipped here so the reader gets their own trip's worth of map rather than
  // the whole bundle — see the same two lines in the trip-scoped route.
  const basemap = basemapForRoute(places.length > 0 ? places : plan.stops);
  return (
    <TripProvider trip={trip} isCurrent canPublish={drafts.canPublish}>
      <MapPageContent
        places={places}
        plan={plan.stops}
        reachedCount={plan.reachedCount}
        basemap={basemap}
        stats={{
          tripDays: stats.tripDays,
          places: stats.places,
          countries: stats.countries,
          totalMedia: stats.totalMedia,
        }}
      />
    </TripProvider>
  );
}
