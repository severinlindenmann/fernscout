import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AnalyticsHubContent from "@/app/[user]/(trip)/analytics/AnalyticsHubContent";
import TripProvider from "@/components/TripProvider";
import { analyticsCardsFor } from "@/lib/analytics";
import { getCostSummary } from "@/lib/costs";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUsernames } from "@/lib/users";
import { summariseWeather, weatherDays } from "@/lib/weatherStats";

export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
      .filter((t) => t.id !== current && t.status !== "upcoming")
      .map((t) => ({ user, trip: t.id }));
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]/analytics">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  const locale = await requestLocale();
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, "analytics.title"),
      trip: trip.title,
    }),
    description: translateIn(locale, "analytics.subtitle"),
    alternates: { canonical: `/${user}/trips/${trip.id}/analytics` },
  };
}

export default async function TripAnalyticsPage({
  params,
}: PageProps<"/[user]/trips/[trip]/analytics">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();

  const { read, canPublish } = await readFor(trip);
  // An empty hub says so rather than 404ing — see the sibling page under
  // `(trip)` for why. B1709.
  const cards = analyticsCardsFor(user, trip.ref, read);
  // The layout draws the gate; this stops the page from *running*.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/analytics`);

  const base = `/${user}/trips/${trip.id}`;
  const summary = summariseWeather(weatherDays(getDays(trip.ref, read)));
  return (
    <TripProvider trip={trip} isCurrent={false}>
      <AnalyticsHubContent
        costs={
          cards.costs
            ? {
                href: `${base}/costs`,
                total: (await mayViewCosts(trip))
                  ? getCostSummary(trip.ref, undefined, read).total
                  : undefined,
              }
            : undefined
        }
        weather={
          cards.weather
            ? {
                href: `${base}/weather`,
                measured: summary.measured,
                missing: summary.missing,
                avgHigh: summary.avgHigh,
              }
            : undefined
        }
      />
    </TripProvider>
  );
}
