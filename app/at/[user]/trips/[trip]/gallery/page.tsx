import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { readFor, mayReadTrip } from "@/lib/tripGate";
import { notFound, redirect } from "next/navigation";
import GalleryPageContent from "@/app/at/[user]/(trip)/gallery/GalleryPageContent";
import { photobookEntryFor } from "@paid/photobook/lib/photobook/entry";
import { postcardEntryFor } from "@paid/postcard/lib/postcard/entry";
import { getAllMedia } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import TripProvider from "@/components/TripProvider";

import { journalPath } from "@/lib/journalPath";
/** B2550 — kept in the client router cache for 30s: a `Link` tap back to a
 * day, trip or list a reader already opened moments ago (Trips → back, a
 * `StoryPager` step) shows what was already fetched rather than waiting on
 * the server again. The owner's own controls (publish, notify,
 * the plan link) render here too, but the cache is per tab and every sign-in,
 * sign-out and identity change ends in a full load or `router.refresh()`
 * (test/auth-navigation-full-load.test.ts), and every studio save refreshes
 * (test/studio-refresh-after-save.test.ts). What is left is a reader seeing
 * for up to 30s what they were already served. Pages only, per Next's own rule —
 * never on a layout. */
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/trips/[trip]/gallery">): Promise<Metadata> {
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
    alternates: { canonical: `${journalPath(user)}/trips/${trip.id}/gallery` },
  };
}

export default async function TripGalleryPage({
  params,
}: PageProps<"/at/[user]/trips/[trip]/gallery">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  if (trip.status === "current") redirect(`${journalPath(user)}/gallery`);

  // B318: this page called getAllMedia/getPlaces with no options at all, so
  // it filtered drafts out for every viewer, owner included — the one
  // reading path in the trip that never checked who was asking.
  const { read, canPublish, owner } = await readFor(trip);

  // Not `isOwner` inline: see the note beside the equivalent call in the
  // current-trip gallery page.
  const photobook = await photobookEntryFor(trip);
  // B582: a trip being over is not a reason not to post a card from it. The
  // API never asked which trip was current; only this page did, by omission.
  const postcard = await postcardEntryFor(trip);

  return (
    <TripProvider
      trip={trip}
      isCurrent={false}
      canPublish={canPublish}
      reader={read.reader}
      owner={owner}
    >
      <GalleryPageContent
        media={getAllMedia(trip.ref, read)}
        photobook={photobook}
        postcard={postcard}
      />
    </TripProvider>
  );
}
