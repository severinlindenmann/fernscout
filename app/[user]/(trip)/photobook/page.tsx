import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { notFound } from "next/navigation";
import TripProvider from "@/components/TripProvider";
import { AS_AUTHOR, getAllMedia, getDays } from "@/lib/entries";
import { balanceOf } from "@/lib/credits";
import { hasCostsData } from "@/lib/costs";
import { hasWeather, weatherDays } from "@/lib/weatherStats";
import { bookLocalesFor, photobookEntryFor } from "@/lib/photobook/entry";
import { spineTextFor } from "@/lib/photobook/plan";
import { outcomeFrom } from "@/lib/photobook/orders";
import { loadUserConfig } from "@/lib/config";
import { partyFor } from "@/lib/travellers/parse";
import PhotobookPageContent from "./PhotobookPageContent";
import { bookRecipientsWithAddress } from "@/lib/photobook/recipients";

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

  const days = getDays(trip.ref, AS_AUTHOR);

  return (
    <TripProvider trip={trip} isCurrent canPublish={false}>
      <PhotobookPageContent
        entry={entry}
        tripRef={trip.ref}
        tripTitle={trip.title}
        spineText={spineTextFor(trip.title, trip.start)}
        // Whether anybody has actually been described — B727. The figures
        // switch is offered only where it would draw something, the same rule
        // the numbers tile follows: `buildBookSource` filters an undescribed
        // party away to nothing, so the alternative is a control that does
        // nothing and says nothing about why.
        hasFigures={
          partyFor(trip.travellers ?? [], loadUserConfig(user).travellers ?? []).filter(
            (f) => Object.keys(f).length > 0,
          ).length > 0
        }
        // Every photograph is in the book until the owner says otherwise, so
        // the grid starts fully selected. Drafts are the owner's own and are
        // included: this page is only ever the owner's.
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
        // Whether the order page's first visit should start with the chart
        // and cost pages already on — B642. Both read the owner's own data
        // (`AS_AUTHOR`), same as everything else on this page.
        hasCosts={hasCostsData(trip.ref, AS_AUTHOR)}
        hasWeather={hasWeather(weatherDays(days))}
        balance={await balanceOf(user)}
        // Who this book can be posted to — B1157. A printed book is what is
        // for sale, so the recipient is part of the purchase rather than a
        // second decision afterwards, and the owner is the one preselected.
        //
        // The full address travels because the owner is checking an envelope
        // before spending on a delivery (B1145). `bookRecipients` itself is
        // unchanged and still answers a name and a town — that is the shape an
        // agent gets — and this page is the owner's own, 404 for anybody else.
        recipients={await bookRecipientsWithAddress(user)}
        locales={bookLocalesFor(user)}
        outcome={await outcomeFrom(user, await searchParams)}
      />
    </TripProvider>
  );
}
