import ExtractFlow from "@/components/extract/ExtractFlow";
import PageHeader from "@/components/PageHeader";
import { hasHelperConsent } from "@/lib/helper/consent";
import { requireExtractOwner } from "@/lib/extract/pageGate";
import { speechProvider } from "@/lib/helper/transcribe";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The guided camera-roll flow — B1751, moved here from the bare
 * `/<user>/extract` by B1797 so that address could become the hub.
 *
 * `trips` is this owner's own trip list, for Step 02's "add to a trip you
 * have" — `getTrips(username)` directly, the same function every other
 * owner-facing trip page already calls server-side
 * (`app/[user]/trips/page.tsx`, `app/[user]/layout.tsx`'s own trip
 * switcher), rather than a new client route. The owner is looking at their
 * own journal here, so nothing needs `listableTrips`'s reader-side filter.
 *
 * `PageHeader` rather than `ExtractFlow`'s own hand-rolled back link —
 * B1802, same reasoning as the rest of the import's pages.
 */
export default async function ExtractPhotosPage({ params }: PageProps<"/[user]/extract/photos">) {
  const { user } = await params;
  await requireExtractOwner(user);
  const trips = getTrips(user).map((trip) => ({
    id: trip.id,
    title: trip.title,
    year: trip.start.slice(0, 4),
  }));
  return (
    <div className="min-h-screen">
      <PageHeader />
      <ExtractFlow
        username={user}
        consentedSpeech={hasHelperConsent(user, "speech")}
        speechProvider={speechProvider()}
        trips={trips}
      />
    </div>
  );
}
