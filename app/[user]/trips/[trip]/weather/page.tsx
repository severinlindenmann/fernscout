import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import WeatherPageContent from "@/app/[user]/(trip)/weather/WeatherPageContent";
import TripProvider from "@/components/TripProvider";
import { isEnabled } from "@/lib/capabilities";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { draftsVisibleTo, mayReadTrip } from "@/lib/tripGate";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUsernames } from "@/lib/users";
import { hasWeather, summariseWeather, weatherDays } from "@/lib/weatherStats";

export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    // A journal with the weather capability off has no weather pages to
    // prerender. B165.
    if (!isEnabled("weather", user)) return [];
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
      .filter((t) => t.id !== current && t.status !== "upcoming")
      .filter((t) => hasWeather(weatherDays(getDays(tripRef(user, t.id)))))
      .map((t) => ({ user, trip: t.id }));
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]/weather">): Promise<Metadata> {
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
    alternates: { canonical: `/${user}/trips/${trip.id}/weather` },
  };
}

export default async function TripWeatherPage({
  params,
}: PageProps<"/[user]/trips/[trip]/weather">) {
  const { user, trip: id } = await params;
  // See the note on the current trip's own weather page: absent rather than
  // broken, and in the page rather than the layout.
  if (!isEnabled("weather", user)) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();

  const drafts = await draftsVisibleTo(trip);
  const days = weatherDays(getDays(trip.ref, { includeDrafts: drafts.visible }));
  if (!hasWeather(days)) notFound();
  // The layout draws the gate; this stops the page from *running*.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/weather`);

  return (
    <TripProvider trip={trip} isCurrent={false}>
      <WeatherPageContent summary={summariseWeather(days)} />
    </TripProvider>
  );
}
