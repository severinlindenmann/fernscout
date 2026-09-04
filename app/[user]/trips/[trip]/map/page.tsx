import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { draftsVisibleTo, mayReadTrip } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import MapPageContent from "@/app/[user]/(trip)/map/MapPageContent";
import { basemapForRoute } from "@/lib/basemap";
import { getPlaces, getTripStats } from "@/lib/entries";
import { getPlan } from "@/lib/plan";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUsernames } from "@/lib/users";
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
  // The tab title carried the same past tense the page did — "Wo wir waren"
  // for a trip nobody has left for yet. Asked the same way the page asks it,
  // on whether there are days rather than on `trip.status`, so the two can
  // never disagree. `getPlaces` is cached per directory (lib/entries.ts), so
  // this does not re-read the trip a second time.
  //
  // And, since B336, the same audience the page asks it for — see the sibling
  // route's `generateMetadata` for why a bare `getPlaces` call here drifted
  // from what the page itself renders.
  const drafts = await draftsVisibleTo(trip);
  const visited = getPlaces(trip.ref, { includeDrafts: drafts.visible }).length > 0;
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, visited ? "map.title" : "map.titlePlanned"),
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
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/map`);

  // See app/[user]/(trip)/map/page.tsx — drafted stops are the owner's alone.
  // B327 — see the sibling route for why this widened past the owner. B336:
  // the solid markers and the stats block below now ask the same question,
  // rather than the bare, always-published-only calls they used to be.
  const drafts = await draftsVisibleTo(trip);
  const plan = getPlan(trip.ref, { includeDrafts: drafts.visible });
  const read = { includeDrafts: drafts.visible };
  const stats = getTripStats(trip.ref, read);
  const places = getPlaces(trip.ref, read);
  // The frame is worked out here as well as in the component, so that only the
  // few dozen kilobytes this trip covers cross the wire rather than the eleven
  // megabytes of the baked bundle. `frameRoute` is pure, so the two agree.
  const basemap = basemapForRoute(places.length > 0 ? places : plan.stops);
  return (
    <TripProvider trip={trip} isCurrent={false} canPublish={drafts.canPublish}>
      <MapPageContent
        places={places}
        plan={plan.stops}
        reachedCount={plan.reachedCount}
        basemap={basemap}
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
