import type { Metadata } from "next";
import AnalyticsHubContent from "./AnalyticsHubContent";
import TripProvider from "@/components/TripProvider";
import { analyticsCardsFor } from "@/lib/analytics";
import { getCostSummary } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { getCurrentTrip } from "@/lib/trips";
import { getDays, type ReadOptions } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { summariseWeather, weatherDays } from "@/lib/weatherStats";

import { journalPath } from "@/lib/journalPath";
/** B2550 — kept in the client router cache for 30s: a `Link` tap back to a
 * day, trip or list a reader already opened moments ago (Trips → back, a
 * `StoryPager` step) shows what was already fetched rather than waiting on
 * the server again. The owner's own controls (publish, notify,
 * the plan link) render here too, but the cache is per tab and every sign-in,
 * sign-out and identity change ends in a full load or `router.refresh()`
 * (test/auth-navigation-full-load.test.ts), and every studio save refreshes
 * (test/studio-refresh-after-save.test.ts). What is left is a reader seeing
 * for up to 30s what they were already served. Pages only, per Next's own rule —
 * never on a layout. */
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/analytics">): Promise<Metadata> {
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
  const locale = await requestLocale();
  return {
    title: translateIn(locale, "analytics.title"),
    description: translateIn(locale, "analytics.subtitle"),
    alternates: { canonical: `${journalPath(user)}/analytics` },
  };
}

export default async function AnalyticsPage({ params }: PageProps<"/at/[user]/analytics">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = await currentTripOrRedirect(user);

  /**
   * Who may see this trip's unpublished days is the *trip's* question, not
   * "is this the owner" — B327, pinned by test/draft-audience.test.ts. The
   * hub's own figures come off the same read as the pages they lead to, so a
   * card cannot advertise a total that its page then declines to show.
   */
  const { read, canPublish } = await readFor(trip);
  const cards = analyticsCardsFor(user, trip.ref, read);
  /**
   * A hub with no cards is an empty hub, and says so — B1709.
   *
   * It used to `notFound()`, on the B165/B267 rule that an optional capability
   * is absent rather than broken. The rule is right; this was the wrong place
   * to apply it. The tab that leads here is hidden journal-wide
   * (`analyticsAvailable`) and cannot be hidden per trip, so on a journal that
   * measures anything at all the tab is on every trip — and the 404 it reached
   * renders the journal's own not-found copy, *"That trip isn't here any
   * more"*, about a trip the reader is standing on.
   *
   * A sentence saying nothing was measured is true. That page was not.
   */
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts.
  if (!(await mayReadTrip(trip))) return null;

  const base = journalPath(user);
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
function headline(ref: string, read: ReadOptions) {
  const summary = summariseWeather(weatherDays(getDays(ref, read)));
  return { measured: summary.measured, missing: summary.missing, avgHigh: summary.avgHigh };
}
