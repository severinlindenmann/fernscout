import type { Metadata } from "next";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import CostsPageContent from "./CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { currentTripRef, getTrip } from "@/lib/trips";
import TripProvider from "@/components/TripProvider";
import { getUser } from "@/lib/users";

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
  const tripId = currentTripRef(user);
  if (!tripId) notFound();
  const trip = getTrip(tripId);
  if (!trip) notFound();
  // The layout draws the password form; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  return (
    <TripProvider trip={trip} isCurrent>
      {(await mayViewCosts(trip)) ? (
        <CostsPageContent summary={getCostSummary(tripId)} />
      ) : (
        <CostsPrivate />
      )}
    </TripProvider>
  );
}
