import { notFound } from "next/navigation";
import StudioPage from "@/components/studio/StudioPage";
import GpsZones from "@/components/studio/location/GpsZones";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { isEnabled } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * "Add a private place" — B2563 T4. Its own address, off the routes
 * overview's compact card, so the street-map picker (`GpsZones`, `mode`
 * unset — the same editor form the overview card used to inline before this
 * ticket) gets a whole page rather than fighting the trip list for space.
 *
 * Same gate as every other page under `/studio/location`: `requireStudioOwner`
 * (may open this studio at all) plus `isJournalOwner` (the real owner's own
 * cookie, never the operator's admin one — private zones are the owner's own
 * settings, not something any admin grant reaches, AGENTS.md).
 */
export default async function NewPrivatePlacePage({ params }: PageProps<"/at/[user]/studio/location/places/new">) {
  const { user } = await params;
  await requireStudioOwner(user);
  if (!(await isJournalOwner(user))) notFound();

  const locale = await requestLocale();
  const streetMapsOn = isEnabled("streetMaps");

  return (
    <StudioPage username={user} group="bringIn" title={translateIn(locale, "studio.location.zones.title")}>
      <GpsZones
        username={user}
        streetMapsOn={streetMapsOn}
        afterAddHref={`${journalPath(user)}/studio/location`}
      />
    </StudioPage>
  );
}
