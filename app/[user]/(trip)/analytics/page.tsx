import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AnalyticsHubContent from "./AnalyticsHubContent";
import TripProvider from "@/components/TripProvider";
import { analyticsCardsFor } from "@/lib/analytics";
import { getCostSummary } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { getCurrentTrip } from "@/lib/trips";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { draftsVisibleTo, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { summariseWeather, weatherDays } from "@/lib/weatherStats";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/analytics">): Promise<Metadata> {
  const { user } = await params;
  /**
   * `getCurrentTrip`, not `currentTripOrRedirect`: metadata must not redirect,
   * and a journal between trips has no hub to describe. The costs page's own
   * metadata makes the same call for the same reason.
   *
   * Drafts are not asked for here. A description is served to whoever asks,
   * including a crawler, so it is computed from the published trip the way
   * `SiteSummary` is — never from days only the owner can see.
   */
  const trip = getCurrentTrip(user);
  // No description of a page that is not there. B165.
  if (!trip) return {};
  const cards = analyticsCardsFor(user, trip.ref);
  if (!cards.costs && !cards.weather) return {};
  const locale = await requestLocale();
  return {
    title: translateIn(locale, "analytics.title"),
    description: translateIn(locale, "analytics.subtitle"),
    alternates: { canonical: `/${user}/analytics` },
  };
}

export default async function AnalyticsPage({ params }: PageProps<"/[user]/analytics">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = currentTripOrRedirect(user);

  /**
   * Who may see this trip's unpublished days is the *trip's* question, not
   * "is this the owner" — B327, pinned by test/draft-audience.test.ts. The
   * hub's own figures come off the same read as the pages they lead to, so a
   * card cannot advertise a total that its page then declines to show.
   */
  const drafts = await draftsVisibleTo(trip);
  const read = { includeDrafts: drafts.visible };
  const cards = analyticsCardsFor(user, trip.ref, read);
  /**
   * A hub with no cards is not an empty hub, it is a page that is not there —
   * the same answer `/costs` gives for a journal with spending off or a trip
   * that never wrote a `costs.md`. Absent rather than broken. B165, B267.
   */
  if (!cards.costs && !cards.weather) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts.
  if (!(await mayReadTrip(trip))) return null;

  const base = `/${user}`;
  return (
    <TripProvider trip={trip} isCurrent>
      <AnalyticsHubContent
        costs={
          cards.costs
            ? {
                href: `${base}/costs`,
                // Withheld, not zeroed, for a reader the trip does not show
                // its spending to — a card reading "CHF 0" would be a claim
                // about the trip rather than about this reader's access.
                total: (await mayViewCosts(trip))
                  ? getCostSummary(trip.ref, undefined, read).total
                  : undefined,
              }
            : undefined
        }
        weather={
          cards.weather
            ? { href: `${base}/weather`, ...headline(trip.ref, read) }
            : undefined
        }
      />
    </TripProvider>
  );
}

/** The three numbers the weather card shows, from the same summary its page draws. */
function headline(ref: string, read: { includeDrafts: boolean }) {
  const summary = summariseWeather(weatherDays(getDays(ref, read)));
  return { measured: summary.measured, missing: summary.missing, avgHigh: summary.avgHigh };
}
