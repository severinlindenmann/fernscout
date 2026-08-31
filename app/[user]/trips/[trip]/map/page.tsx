import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import MapPageContent from "@/app/[user]/(trip)/map/MapPageContent";
import { getPlaces, getTripStats } from "@/lib/entries";
import { getPlan } from "@/lib/plan";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUsernames } from "@/lib/users";
import { isOwner } from "@/lib/contacts/session";
import TripProvider from "@/components/TripProvider";

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
}: PageProps<"/[user]/trips/[trip]/map">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  const locale = await requestLocale();
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, "map.title"),
      trip: trip.title,
    }),
    description: `Every stop on ${trip.title}, with routes coloured by how we travelled.`,
    alternates: { canonical: `/${user}/trips/${trip.id}/map` },
  };
}

export default async function TripMapPage({ params }: PageProps<"/[user]/trips/[trip]/map">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The layout draws the password form; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/map`);

  const stats = getTripStats(trip.ref);
  // See app/[user]/(trip)/map/page.tsx — drafted stops are the owner's alone.
  const plan = getPlan(trip.ref, { includeDrafts: await isOwner(user) });
  return (
    <TripProvider trip={trip} isCurrent={false}>
      <MapPageContent
        places={getPlaces(trip.ref)}
        plan={plan.stops}
        reachedCount={plan.reachedCount}
        stats={{
          tripDays: stats.tripDays,
          places: stats.places,
          countries: stats.countries,
          totalMedia: stats.totalMedia,
        }}
      />
    </TripProvider>
  );
}
