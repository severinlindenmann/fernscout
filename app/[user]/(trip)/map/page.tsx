import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { mayReadTrip } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import MapPageContent from "./MapPageContent";
import { basemapFor } from "@/lib/basemap";
import { getPlaces, getTripStats } from "@/lib/entries";
import { frameRoute } from "@/lib/mapFrame";
import { getPlan } from "@/lib/plan";
import { currentTripRef, getTrip } from "@/lib/trips";
import TripProvider from "@/components/TripProvider";
import { isOwner } from "@/lib/contacts/session";

/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  const description = translateIn(journal, "map.subtitle");
  const shared = translateIn(journal, "map.title");
  return {
    title: translateIn(reader, "map.title"),
    description,
    alternates: { canonical: "/[user]/map" },
    openGraph: { type: "website", title: shared, description, url: "/map" },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function MapPage({ params }: PageProps<"/[user]/map">) {
  const { user } = await params;
  const tripId = currentTripRef(user);
  if (!tripId) notFound();
  const trip = getTrip(tripId);
  if (!trip) notFound();
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
