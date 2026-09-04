import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import CostsPageContent from "@/app/[user]/(trip)/costs/CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUser, getUsernames } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import TripProvider from "@/components/TripProvider";
import { travellerNamesOf } from "@/lib/site";

export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    // A journal with spending switched off has no costs pages to prerender.
    // B165.
    if (!isEnabled("costs", user)) return [];
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
    .filter((t) => t.id !== current && t.status !== "upcoming")
      .map((t) => ({ user, trip: t.id }));
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]/costs">): Promise<Metadata> {
  const { user, trip: id } = await params;
  // No description of a page that is not there. B165.
  if (!isEnabled("costs", user)) return {};
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  const locale = await requestLocale();
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, "cost.title"),
      trip: trip.title,
    }),
    description: `What ${trip.title} actually cost, itemised in ${trip.username}'s currency.`,
    alternates: { canonical: `/${user}/trips/${trip.id}/costs` },
  };
}

export default async function TripCostsPage({ params }: PageProps<"/[user]/trips/[trip]/costs">) {
  const { user, trip: id } = await params;
  /**
   * A journal that does not do spending has no costs page — 404, not an empty
   * one. B165.
   *
   * `notFound()` is what every other capability-gated route does
   * (app/[user]/contacts/page.tsx, app/[user]/i/[token]/page.tsx), and the
   * reason it is right here is the one AGENTS.md gives: a capability that is
   * off must be *absent* rather than broken. An operator who switches `costs`
   * off is told by `/api/health` that it is off; a page that answers 200 with
   * the full budget panel makes that a claim the running site contradicts.
   *
   * In the page rather than the layout, for the reason in lib/tripGate.ts: a
   * layout gate leaks the page's data into the RSC payload and the head even
   * when it renders something else.
   */
  if (!isEnabled("costs", user)) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/costs`);

  const userConfig = getUser(user);
  if (!userConfig) notFound();

  return (
    <TripProvider trip={trip} isCurrent={false}>
      {(await mayViewCosts(trip)) ? (
        <CostsPageContent
          summary={getCostSummary(trip.ref)}
          travellers={travellerNamesOf(userConfig, trip)}
        />
      ) : (
        <CostsPrivate />
      )}
    </TripProvider>
  );
}
