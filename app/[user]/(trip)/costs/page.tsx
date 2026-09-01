import type { Metadata } from "next";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import CostsPageContent from "./CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import TripProvider from "@/components/TripProvider";
import { getUser } from "@/lib/users";
import { travellerNamesOf } from "@/lib/site";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/costs">): Promise<Metadata> {
  const { user } = await params;
  const currency = getUser(user)?.baseCurrency ?? "CHF";
  const description =
    `What the trip actually costs, itemised in ${currency} — preparation, ` +
    "flights, beds, food and everything in between.";
  return {
    title: "Costs",
    description,
    alternates: { canonical: `/${user}/costs` },
    openGraph: {
      type: "website",
      title: "What the trip costs",
      description,
      url: `/${user}/costs`,
    },
    twitter: { card: "summary_large_image", title: "Costs", description },
  };
}

export default async function CostsPage({ params }: PageProps<"/[user]/costs">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = currentTripOrRedirect(user);
  const tripId = trip.ref;
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  return (
    <TripProvider trip={trip} isCurrent>
      {(await mayViewCosts(trip)) ? (
        <CostsPageContent
          summary={getCostSummary(tripId)}
          travellers={travellerNamesOf(userConfig, trip)}
        />
      ) : (
        <CostsPrivate />
      )}
    </TripProvider>
  );
}
