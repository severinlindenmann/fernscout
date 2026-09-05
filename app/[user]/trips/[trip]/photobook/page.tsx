import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import TripProvider from "@/components/TripProvider";
import { getAllMedia, getDays } from "@/lib/entries";
import { balanceOf } from "@/lib/credits";
import { bookLocalesFor, photobookEntryFor } from "@/lib/photobook/entry";
import { getTrip, tripRef } from "@/lib/trips";
import { outcomeFrom } from "@/lib/photobook/orders";
import PhotobookPageContent from "../../../(trip)/photobook/PhotobookPageContent";

export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  return { title: translateIn(reader, "photobook.title"), robots: { index: false } };
}

// Deliberately no `generateStaticParams`, unlike the gallery page it
// otherwise mirrors — this page is owner-only and must never be prerendered.
export default async function TripPhotobookPage({
  params,
  searchParams,
}: PageProps<"/[user]/trips/[trip]/photobook">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  if (!(await mayReadTrip(trip))) return null;

  const entry = await photobookEntryFor(trip);
  if (!entry) notFound();

  return (
    <TripProvider trip={trip} isCurrent={false} canPublish={false}>
      <PhotobookPageContent
        entry={entry}
        tripRef={trip.ref}
        tripTitle={trip.title}
        media={getAllMedia(trip.ref, { includeDrafts: true }).filter((m) => m.type === "image")}
        days={getDays(trip.ref, { includeDrafts: true }).map((d) => ({
          date: d.date,
          title: d.lead.title,
          location: [d.lead.location, d.lead.country].filter(Boolean).join(", "),
        }))}
        balance={await balanceOf(user)}
        locales={bookLocalesFor(user)}
        // `order/route.ts` always redirects here — this is the URL its
        // `back()` builds — so this copy of the page, and not the
        // current-trip one above, is the one that actually needs to read the
        // outcome back. Both accept it; only one is ever asked.
        outcome={await outcomeFrom(user, await searchParams)}
      />
    </TripProvider>
  );
}
