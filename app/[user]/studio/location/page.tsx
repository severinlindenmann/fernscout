import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import LocationFlow from "@/components/studio/location/LocationFlow";
import ImportDisclosure from "@/components/studio/location/ImportDisclosure";
import LocationSample from "@/components/studio/location/LocationSample";
import GpsZones from "@/components/studio/location/GpsZones";
import GpsPurgePanel from "@/components/studio/location/GpsPurgePanel";
import RecordedTripsSection from "@/components/studio/location/RecordedTripsSection";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips, tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { recordedTrips } from "@/lib/gps/api";
import { AS_AUTHOR, getPlaces } from "@/lib/entries";
import { basemapForRoute } from "@/lib/basemap";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * "Your route" — B2240 reordered this page so recording, the thing a
 * phone already does, leads; importing older history (Google Timeline, GPX,
 * our own JSON) is the secondary "Import existing history" section below it.
 * Before B2240 the page opened with the import flow and buried the
 * recording section beneath a hub card that still called itself an export —
 * the owner could not find "Your route" (B2226) at all.
 *
 * The import flow itself is `LocationFlow.tsx` — B1937, spec §7.3, the
 * five-step why → get it → deliver it → peek → decide flow that replaced the
 * bare `NonPhotoImport` picker this page rendered since B1825. See
 * `LocationFlow.tsx`'s own doc comment for what makes it different from its
 * `PeopleFlow`/`StatementFlow` siblings — the extent-only peek and D7's
 * pre-selected default chief among them.
 *
 * `requireStudioOwner`, not the older `requireExtractOwner` — this page
 * matches every other flow under `/studio`. With `routeRecording` off, the
 * recording section is simply absent (`routeSection` stays `null`) and the
 * page still works as the import page.
 */
export default async function StudioLocationPage({ params }: PageProps<"/[user]/studio/location">) {
  const { user } = await params;
  await requireStudioOwner(user);

  const trips = getTrips(user).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }));
  const current = getCurrentTrip(user);
  const locale = await requestLocale();

  // "Your route" — B2226. Behind the same capability as every other door
  // onto `gps/`, and absent (not broken) when it is off — no fetch this
  // section's own client component could make would otherwise tell a reader
  // that apart from "no trips recorded yet".
  // The owner's own cookie, not merely a studio caller: `requireStudioOwner`
  // also admits the operator's admin address, and which trips hold a
  // recording and when its last position arrived is location-history
  // metadata every `gps/` door refuses the admin (B2226 security review).
  const isJournalOwner = (await resolveAccess(user)).email === getUser(user)?.owner.email;
  let routeSection = null;
  if (isJournalOwner && isEnabled("routeRecording", user)) {
    const recorded = recordedTrips(user);
    // Places and a basemap for exactly the trips this owner has a
    // recording for — the same pair the trip map page computes
    // (`getPlaces`/`basemapForRoute`), read with `AS_AUTHOR` so a draft
    // day's own place still frames the preview. The map's frame comes from
    // the trip's own stops, never the raw track itself — see docs/gps.md,
    // "What it looks like".
    const placesByTrip: Record<string, ReturnType<typeof getPlaces>> = {};
    const basemapByTrip: Record<string, ReturnType<typeof basemapForRoute>> = {};
    for (const trip of recorded) {
      const places = getPlaces(tripRef(user, trip.tripId), AS_AUTHOR);
      placesByTrip[trip.tripId] = places;
      basemapByTrip[trip.tripId] = basemapForRoute(places);
    }
    routeSection = (
      <RecordedTripsSection
        username={user}
        initialTrips={recorded}
        placesByTrip={placesByTrip}
        basemapByTrip={basemapByTrip}
      />
    );
  }

  return (
    <StudioPage
      username={user}
      group="bringIn"
      title={translateIn(locale, "studio.location.title")}
      lede={translateIn(locale, "studio.location.lede")}
    >
      {routeSection}
      <GpsZones username={user} />

      {/* Second, and folded away (B2240): recording is what this page is
          for. `ImportDisclosure` mounts the import flow only when opened. */}
      <ImportDisclosure summary={translateIn(locale, "studio.location.import.heading")}>
        <p className="mt-2 text-sm text-ink-secondary">{translateIn(locale, "studio.location.import.intro")}</p>
        <LocationFlow username={user} trips={trips} defaultTripId={current?.id ?? null} />
        <LocationSample />
      </ImportDisclosure>

      <GpsPurgePanel username={user} />
    </StudioPage>
  );
}
