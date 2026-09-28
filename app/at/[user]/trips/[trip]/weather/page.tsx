import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import WeatherPageContent from "@/app/at/[user]/(trip)/weather/WeatherPageContent";
import TripProvider from "@/components/TripProvider";
import { isEnabled } from "@/lib/capabilities";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip } from "@/lib/tripGate";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { hasWeather, summariseWeather, weatherDays } from "@/lib/weatherStats";

import { journalPath } from "@/lib/journalPath";
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
}: PageProps<"/at/[user]/trips/[trip]/weather">): Promise<Metadata> {
  const { user, trip: id } = await params;
  // No description of a page that is not there. B165.
  if (!isEnabled("weather", user)) return {};
  const trip = getTrip(tripRef(user, id));
  if (!trip || !hasWeather(weatherDays(getDays(trip.ref)))) return {};
  const locale = await requestLocale();
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, "weatherPage.title"),
      trip: trip.title,
    }),
    description: translateIn(locale, "weatherPage.subtitle"),
    alternates: { canonical: `${journalPath(user)}/trips/${trip.id}/weather` },
  };
}

export default async function TripWeatherPage({
  params,
}: PageProps<"/at/[user]/trips/[trip]/weather">) {
  const { user, trip: id } = await params;
  // See the note on the current trip's own weather page: absent rather than
  // broken, and in the page rather than the layout.
  if (!isEnabled("weather", user)) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();

  const { read, canPublish } = await readFor(trip);
  const days = weatherDays(getDays(trip.ref, read));
  if (!hasWeather(days)) notFound();
  // The layout draws the gate; this stops the page from *running*.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`${journalPath(user)}/weather`);

  return (
    <TripProvider trip={trip} isCurrent={false} units={getUser(user)?.units}>
      <WeatherPageContent summary={summariseWeather(days)} />
    </TripProvider>
  );
}
