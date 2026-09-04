import type { Metadata } from "next";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import CostsPageContent from "./CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import TripProvider from "@/components/TripProvider";
import { getUser } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import { travellerNamesOf } from "@/lib/site";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/costs">): Promise<Metadata> {
  const { user } = await params;
  // No description of a page that is not there. B165.
  if (!isEnabled("costs", user)) return {};
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
