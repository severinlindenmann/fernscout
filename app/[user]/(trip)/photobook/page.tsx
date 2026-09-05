import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { notFound } from "next/navigation";
import TripProvider from "@/components/TripProvider";
import { getAllMedia } from "@/lib/entries";
import { balanceOf } from "@/lib/credits";
import { bookLocalesFor, photobookEntryFor } from "@/lib/photobook/entry";
import { outcomeFrom } from "@/lib/photobook/orders";
import PhotobookPageContent from "./PhotobookPageContent";

export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  return { title: translateIn(reader, "photobook.title"), robots: { index: false } };
}

export default async function PhotobookPage({
  params,
  searchParams,
}: PageProps<"/[user]/photobook">) {
  const { user } = await params;
  const trip = currentTripOrRedirect(user);
  if (!(await mayReadTrip(trip))) return null;

  // The one `isOwner`-shaped question this page asks, and it does not ask it
  // itself — `photobookEntryFor` decides, so this file never sits beside a
  // draft-visibility check and an `isOwner` call in the way
  // `test/draft-audience.test.ts` scans for.
  const entry = await photobookEntryFor(trip);
  if (!entry) notFound();

  return (
    <TripProvider trip={trip} isCurrent canPublish={false}>
      <PhotobookPageContent
        entry={entry}
        tripRef={trip.ref}
        tripTitle={trip.title}
        // Every photograph is in the book until the owner says otherwise, so
        // the grid starts fully selected. Drafts are the owner's own and are
        // included: this page is only ever the owner's.
        media={getAllMedia(trip.ref, { includeDrafts: true }).filter((m) => m.type === "image")}
        balance={await balanceOf(user)}
        locales={bookLocalesFor(user)}
        outcome={await outcomeFrom(user, await searchParams)}
      />
    </TripProvider>
  );
}
