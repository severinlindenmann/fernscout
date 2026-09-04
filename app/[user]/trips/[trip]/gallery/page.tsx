import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import GalleryPageContent from "@/app/[user]/(trip)/gallery/GalleryPageContent";
import { getAllMedia, getPlaces } from "@/lib/entries";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUsernames } from "@/lib/users";
import TripProvider from "@/components/TripProvider";
import { isOwner } from "@/lib/contacts/session";

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
}: PageProps<"/[user]/trips/[trip]/gallery">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  const locale = await requestLocale();
  return {
    // The section name follows the reader; the trip's own title is the
    // author's and is never translated. See the note in the gallery page.
    title: translateIn(locale, "meta.sectionOfTrip", {
      section: translateIn(locale, "gallery.title"),
      trip: trip.title,
    }),
    description: `Every photo and video from ${trip.title}, newest first — filterable by place.`,
    alternates: { canonical: `/${user}/trips/${trip.id}/gallery` },
  };
}

export default async function TripGalleryPage({
  params,
}: PageProps<"/[user]/trips/[trip]/gallery">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`/${user}/gallery`);

  // B318: this page called getAllMedia/getPlaces with no options at all, so
  // it filtered drafts out for every viewer, owner included — the one
  // reading path in the trip that never checked who was asking.
  const owner = await isOwner(user);
  const read = { includeDrafts: owner };

  return (
    <TripProvider trip={trip} isCurrent={false}>
      <GalleryPageContent media={getAllMedia(trip.ref, read)} places={getPlaces(trip.ref, read)} />
    </TripProvider>
  );
}
