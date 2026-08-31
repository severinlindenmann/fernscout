import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/proxy";
import { getPlaces, getTripStats } from "@/lib/entries";
import { getTrips } from "@/lib/trips";
import { listableTrips } from "@/lib/tripGate";
import TripsIndexContent from "./TripsIndexContent";

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
  const description = translateIn(journal, "trips.subtitle");
  const shared = translateIn(journal, "trips.title");
  return {
    title: translateIn(reader, "trips.title"),
    description,
    alternates: { canonical: "/trips" },
    openGraph: { type: "website", title: shared, description, url: "/trips" },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function TripsPage({ params }: PageProps<"/[user]/trips">) {
  const { user } = await params;
  // Filtered by who is asking, not just fetched. The trip switcher in the user
  // layout has always run `listableTrips`; this page — the one actually called
  // "Trips" — did not, and listed every restricted trip's title, tagline,
  // dates, day and country counts, and drew its route on the lifetime map.
  const trips = await listableTrips(getTrips(user));
  // Upcoming trips have no entries, so they contribute nothing to the map or
  // the lifetime totals — only a card with a countdown.
  const travelled = trips.filter((t) => t.status !== "upcoming");

  // getPlaces/getTripStats each re-read and re-derive from every entry file,
  // so each travelled trip is computed once here and reused below, rather
  // than once per card plus twice more for the lifetime totals.
  // Keyed and looked up by `ref` — `getPlaces`/`getTripStats` resolve a
  // directory from `<user>/<tripId>`, and a bare id silently reads nothing,
  // which showed here as every trip having 0 days, 0 countries and no route.
  const placesByTrip = new Map(travelled.map((t) => [t.ref, getPlaces(t.ref)]));
  const statsByTrip = new Map(travelled.map((t) => [t.ref, getTripStats(t.ref)]));

  const routes = travelled.map((trip) => ({
    id: trip.id,
    title: trip.title,
    accent: trip.accent,
    translations: trip.translations,
    points: placesByTrip
      .get(trip.ref)!
      .map((p) => ({ lat: p.lat, lng: p.lng, location: p.location })),
  }));

  const cards = trips.map((trip) => {
    const stats = statsByTrip.get(trip.ref);
    return {
      id: trip.id,
      title: trip.title,
      tagline: trip.tagline,
      cover: trip.cover,
      accent: trip.accent,
      status: trip.status,
      start: trip.start,
      end: trip.end,
      translations: trip.translations,
      // `tripDays`, not `dayCount`: the label says "days on the road", and
      // that is elapsed time, not the number of days somebody wrote about. A
      // fortnight with five entries is a fortnight.
      tripDays: stats?.tripDays ?? 0,
      countries: stats?.countries ?? 0,
      totalMedia: stats?.totalMedia ?? 0,
    };
  });

  const countries = new Set(
    travelled.flatMap((t) => placesByTrip.get(t.ref)!.map((p) => p.country).filter(Boolean)),
  );

  return (
    <TripsIndexContent
      trips={cards}
      routes={routes}
      lifetime={{
        countries: countries.size,
        days: travelled.reduce((n, t) => n + statsByTrip.get(t.ref)!.tripDays, 0),
        photos: travelled.reduce((n, t) => n + statsByTrip.get(t.ref)!.totalMedia, 0),
        trips: travelled.length,
      }}
    />
  );
}
