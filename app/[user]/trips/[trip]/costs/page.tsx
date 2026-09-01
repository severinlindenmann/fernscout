import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import CostsPageContent from "@/app/[user]/(trip)/costs/CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUser, getUsernames } from "@/lib/users";
import TripProvider from "@/components/TripProvider";
import { travellerNamesOf } from "@/lib/site";

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
}: PageProps<"/[user]/trips/[trip]/costs">): Promise<Metadata> {
  const { user, trip: id } = await params;
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
