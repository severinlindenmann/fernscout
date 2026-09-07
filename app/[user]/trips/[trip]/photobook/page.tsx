import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import TripProvider from "@/components/TripProvider";
import { AS_AUTHOR, getAllMedia, getDays } from "@/lib/entries";
import { balanceOf } from "@/lib/credits";
import { hasCostsData } from "@/lib/costs";
import { hasWeather, weatherDays } from "@/lib/weatherStats";
import { bookLocalesFor, photobookEntryFor } from "@/lib/photobook/entry";
import { spineTextFor } from "@/lib/photobook/plan";
import { getTrip, tripRef } from "@/lib/trips";
import { outcomeFrom } from "@/lib/photobook/orders";
import { loadUserConfig } from "@/lib/config";
import { partyFor } from "@/lib/travellers/parse";
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

  const days = getDays(trip.ref, AS_AUTHOR);

  return (
    <TripProvider trip={trip} isCurrent={false} canPublish={false}>
      <PhotobookPageContent
        entry={entry}
        tripRef={trip.ref}
        tripTitle={trip.title}
        spineText={spineTextFor(trip.title, trip.start)}
        // See the sibling page: the figures switch is offered only where
        // somebody has been described — B727.
        hasFigures={
          partyFor(trip.travellers ?? [], loadUserConfig(user).travellers ?? []).filter(
            (f) => Object.keys(f).length > 0,
          ).length > 0
        }
        media={// Un-reversed. `getAllMedia` returns newest first, which is what a
        // gallery wants and the opposite of what a book prints: the planner
        // walks each entry's `gallery` in the order it was written. Showing
        // the composer's grid the other way round meant the first photograph
        // of a day appeared last, and moving one "earlier" moved it later on
        // paper — a control that lies about its own direction.
        [...getAllMedia(trip.ref, AS_AUTHOR)]
          .reverse()
          .filter((m) => m.type === "image")}
        // Whether any day says how it was travelled — B737. The transport
        // page only exists when one does, so the vehicles switch is offered
        // only where it would draw something, like the two before it.
        hasTransport={days.some((d) => d.lead.transport !== undefined)}
        days={days.map((d) => ({
          date: d.date,
          title: d.lead.title,
          location: [d.lead.location, d.lead.country].filter(Boolean).join(", "),
        }))}
        hasCosts={hasCostsData(trip.ref, AS_AUTHOR)}
        hasWeather={hasWeather(weatherDays(days))}
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
