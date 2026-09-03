import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { mayReadTrip } from "@/lib/tripGate";
import MapPageContent from "./MapPageContent";
import { basemapFor } from "@/lib/basemap";
import { getPlaces, getTripStats } from "@/lib/entries";
import { frameRoute } from "@/lib/mapFrame";
import { getPlan } from "@/lib/plan";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { currentTripRef } from "@/lib/trips";
import TripProvider from "@/components/TripProvider";
import { isOwner } from "@/lib/contacts/session";
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
  const visited = ref !== undefined && getPlaces(ref).length > 0;
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
  const stats = getTripStats(tripId);
  // Planned stops derived from drafts are the trip's own next moves — shown
  // only to the person who wrote them, exactly like the drafts themselves.
  const plan = getPlan(tripId, { includeDrafts: await isOwner(user) });
  const places = getPlaces(tripId);
  // Clipped here so the reader gets their own trip's worth of map rather than
  // the whole bundle — see the same two lines in the trip-scoped route.
  const basemap = basemapFor(frameRoute(places.length > 0 ? places : plan.stops));
  return (
    <TripProvider trip={trip} isCurrent>
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
