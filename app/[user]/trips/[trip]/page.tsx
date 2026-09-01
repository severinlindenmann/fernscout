import type { Metadata } from "next";
import { lockedMetadata, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import { getAllEntries } from "@/lib/entries";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { buildStoryProps } from "@/lib/tripView";
import { getPlan } from "@/lib/plan";
import { getBudgetInBase } from "@/lib/costs";
import { BlogStructuredData } from "@/components/StructuredData";
import { getUser, getUsernames } from "@/lib/users";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellersOf } from "@/lib/site";
import { getDefaultUsername } from "@/lib/users";
import TripCountdown from "@/components/TripCountdown";
import TripStory from "@/app/TripStory";
import { isOwner } from "@/lib/contacts/session";

export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
    .filter((t) => t.id !== current)
      .map((t) => ({ user, trip: t.id }));
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  if (!(await mayReadTrip(trip))) return lockedMetadata(trip);
  const description = trip.tagline ?? trip.intro.replace(/\s+/g, " ").slice(0, 160);
  return {
    title: trip.title,
    description,
    alternates: { canonical: `/${user}/trips/${trip.id}` },
    openGraph: {
      type: "website",
      title: trip.title,
      description,
      url: `/${user}/trips/${trip.id}`,
      images: trip.cover ? [{ url: trip.cover, alt: trip.title }] : undefined,
    },
    twitter: { card: "summary_large_image", title: trip.title, description },
  };
}

export default async function TripPage({ params }: PageProps<"/[user]/trips/[trip]">) {
  const { user, trip: id } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The current trip lives at the bare URLs; one canonical URL per page.
  if (trip.status === "current") redirect(`/${user}`);

  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;

  if (trip.status === "upcoming") {
    // The countdown draws the same merged route as the map — see
    // app/[user]/(trip)/map/page.tsx for why this is gated on ownership.
    const plan = getPlan(trip.ref, { includeDrafts: await isOwner(user) });
    return (
      <TripProvider trip={trip} isCurrent={false}>
        <TripCountdown trip={trip} stops={plan.stops} budget={getBudgetInBase(trip.ref)} />
      </TripProvider>
    );
  }

  const { index, days, windowStart, initialDate, stats } = buildStoryProps(trip.ref, {
    showCosts: await mayViewCosts(trip),
    includeDrafts: await isOwner(user),
  });
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  return (
    <TripProvider trip={trip} isCurrent={false}>
      <BlogStructuredData
        entries={getAllEntries(trip.ref)}
        site={site}
        authors={travellersOf(userConfig, trip).map((p) => p.name)}
      />
      <TripStory
        index={index}
        days={days}
        windowStart={windowStart}
        initialDate={initialDate}
        stats={stats}
      />
    </TripProvider>
  );
}
