import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AnalyticsHubContent from "@/app/at/[user]/(trip)/analytics/AnalyticsHubContent";
import TripProvider from "@/components/TripProvider";
import { analyticsCardsFor } from "@/lib/analytics";
import { getCostSummary } from "@/lib/costs";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getTrip, tripRef } from "@/lib/trips";
import { summariseWeather, weatherDays } from "@/lib/weatherStats";

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
}: PageProps<"/at/[user]/trips/[trip]/analytics">): Promise<Metadata> {
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
    alternates: { canonical: `${journalPath(user)}/trips/${trip.id}/analytics` },
  };
}

export default async function TripAnalyticsPage({
  params,
}: PageProps<"/at/[user]/trips/[trip]/analytics">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();

  const { read, canPublish } = await readFor(trip);
  // An empty hub says so rather than 404ing — see the sibling page under
  // `(trip)` for why. B1709.
  const cards = analyticsCardsFor(user, trip.ref, read);
  // The layout draws the gate; this stops the page from *running*.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`${journalPath(user)}/analytics`);

  const base = `${journalPath(user)}/trips/${trip.id}`;
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
