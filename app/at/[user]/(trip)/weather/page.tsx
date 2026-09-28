import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WeatherPageContent from "./WeatherPageContent";
import TripProvider from "@/components/TripProvider";
import { isEnabled } from "@/lib/capabilities";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { getDays } from "@/lib/entries";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip } from "@/lib/tripGate";
import { getCurrentTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { hasWeather, summariseWeather, weatherDays } from "@/lib/weatherStats";

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
}: PageProps<"/at/[user]/weather">): Promise<Metadata> {
  const { user } = await params;
  // No description of a page that is not there. B165.
  if (!isEnabled("weather", user)) return {};
  const trip = getCurrentTrip(user);
  if (!trip || !hasWeather(weatherDays(getDays(trip.ref)))) return {};
  const locale = await requestLocale();
  return {
    title: translateIn(locale, "weatherPage.title"),
    description: translateIn(locale, "weatherPage.subtitle"),
    alternates: { canonical: `${journalPath(user)}/weather` },
  };
}

export default async function WeatherPage({ params }: PageProps<"/at/[user]/weather">) {
  const { user } = await params;
  /**
   * A journal that does not record the weather has no weather page — 404, not
   * an empty one. The same call `/costs` makes for `features.costs`, and for
   * the reason AGENTS.md gives: an optional capability must be absent rather
   * than broken, and `/api/health` is what explains why it is off.
   *
   * In the page rather than the layout, for the reason in lib/tripGate.ts: a
   * layout gate leaks the page's data into the RSC payload and the head even
   * when it renders something else.
   */
  if (!isEnabled("weather", user)) notFound();
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = await currentTripOrRedirect(user);

  /**
   * Who may see this trip's unpublished days is the *trip's* question, not
   * "is this the owner" — B327, pinned by test/draft-audience.test.ts.
   */
  const { read, canPublish } = await readFor(trip);
  const days = weatherDays(getDays(trip.ref, read));
  /**
   * The capability being on says nothing about whether this trip ever asked
   * for a reading: `weather: true` is per day, and a trip may carry none. A
   * page of empty charts under headings promising a summary is the same
   * failure with an extra step. B267's rule, applied here.
   */
  if (!hasWeather(days)) notFound();
  // The layout draws the gate; this stops the page from *running*.
  if (!(await mayReadTrip(trip))) return null;

  return (
    <TripProvider trip={trip} isCurrent units={getUser(user)?.units}>
      <WeatherPageContent summary={summariseWeather(days)} />
    </TripProvider>
  );
}
