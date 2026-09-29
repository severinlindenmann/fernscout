import StudioPage from "@/components/studio/StudioPage";
import LocationFlow from "@/components/studio/location/LocationFlow";
import LocationSample from "@/components/studio/location/LocationSample";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Import older history" — B2563 T1, moved off the overview's own
 * `ImportDisclosure` fold and onto its own address so it stops competing
 * with the trips list for the same screen's weight. `LocationFlow` and
 * `LocationSample` are unchanged; only where they are reached from moved.
 */
export default async function StudioLocationImportPage({ params }: PageProps<"/at/[user]/studio/location/import">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  const trips = getTrips(user).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }));
  const current = getCurrentTrip(user);

  return (
    <StudioPage username={user} group="bringIn" title={translateIn(locale, "studio.location.import.heading")}>
      <p className="text-sm text-ink-secondary">{translateIn(locale, "studio.location.import.intro")}</p>
      <LocationFlow username={user} trips={trips} defaultTripId={current?.id ?? null} />
      <LocationSample />
    </StudioPage>
  );
}
