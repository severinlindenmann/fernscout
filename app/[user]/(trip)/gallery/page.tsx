import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { mayReadTrip } from "@/lib/tripGate";
import GalleryPageContent from "./GalleryPageContent";
import { getAllMedia, getPlaces } from "@/lib/entries";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import TripProvider from "@/components/TripProvider";
import { isOwner } from "@/lib/contacts/session";

/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  const description = translateIn(journal, "gallery.description");
  const shared = translateIn(journal, "gallery.title");
  return {
    title: translateIn(reader, "gallery.title"),
    description,
    alternates: { canonical: "/[user]/gallery" },
    openGraph: { type: "website", title: shared, description, url: "/gallery" },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function GalleryPage({ params }: PageProps<"/[user]/gallery">) {
  const { user } = await params;
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = currentTripOrRedirect(user);
  const tripId = trip.ref;
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;

  // B318: this page called getAllMedia/getPlaces with no options at all, so
  // it filtered drafts out for every viewer, owner included — the one
  // reading path in the trip that never checked who was asking.
  const owner = await isOwner(user);
  const read = { includeDrafts: owner };

  return (
    <TripProvider trip={trip} isCurrent>
      <GalleryPageContent media={getAllMedia(tripId, read)} places={getPlaces(tripId, read)} />
    </TripProvider>
  );
}
