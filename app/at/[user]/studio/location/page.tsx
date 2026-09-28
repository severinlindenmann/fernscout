import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import LocationFlow from "@/components/studio/location/LocationFlow";
import ImportDisclosure from "@/components/studio/location/ImportDisclosure";
import LocationSample from "@/components/studio/location/LocationSample";
import GpsZones from "@/components/studio/location/GpsZones";
import GpsPurgePanel from "@/components/studio/location/GpsPurgePanel";
import RecordedTripsSection from "@/components/studio/location/RecordedTripsSection";
import TripDetailView from "@/components/studio/location/TripDetailView";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips, tripRef } from "@/lib/trips";
import { isEnabled } from "@/lib/capabilities";
import { kmByMode, ownerTripLine, recordedTrips } from "@/lib/gps/api";
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
export default async function StudioLocationPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/location">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const query = await searchParams;
  const selectedTripId = typeof query.trip === "string" ? query.trip : null;
  const selectedView = query.view === "readers" ? "readers" : "mine";
  const selectedDay = typeof query.day === "string" ? query.day : undefined;

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
  let tripDetail = null;
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
    // B2541 — km by transport mode, for the same trips. Small enough (a
    // handful of numbers) to compute for every row rather than only on
    // expand, the same reasoning `daysRecorded` already gets.
    const kmByModeByTrip: Record<string, ReturnType<typeof kmByMode>> = {};
    // The owner's own raw line per trip, computed once here rather than
    // fetched client-side — B2540's overview card map and facts line
    // (`days · km · positions · gaps`), always visible rather than folded
    // behind the accordion's own "Preview" toggle.
    const initialSegmentsByTrip: Record<string, NonNullable<ReturnType<typeof ownerTripLine>>["segments"]> = {};
    for (const trip of recorded) {
      const places = getPlaces(tripRef(user, trip.tripId), AS_AUTHOR);
      placesByTrip[trip.tripId] = places;
      basemapByTrip[trip.tripId] = basemapForRoute(places);
      kmByModeByTrip[trip.tripId] = kmByMode(user, trip.tripId);
      initialSegmentsByTrip[trip.tripId] = ownerTripLine(user, trip.tripId)?.segments ?? [];
    }
    routeSection = (
      <RecordedTripsSection
        username={user}
        initialTrips={recorded}
        placesByTrip={placesByTrip}
        basemapByTrip={basemapByTrip}
        kmByModeByTrip={kmByModeByTrip}
        initialSegmentsByTrip={initialSegmentsByTrip}
      />
    );

    // The trip-detail view (S3 A) and its own day view (S5 A) — B2540,
    // reached at `?trip=<id>` (`&view=mine|readers`, `&day=<date>`), never a
    // client-side route of its own: the query string is what makes Mine and
    // Readers' each a real URL a capture can navigate to directly.
    const selectedTrip = selectedTripId ? recorded.find((r) => r.tripId === selectedTripId) : undefined;
    if (selectedTrip) {
      tripDetail = (
        <TripDetailView username={user} trip={selectedTrip} view={selectedView} day={selectedDay} />
      );
    }
  }
  const streetMapsOn = isEnabled("streetMaps");

  return (
    <StudioPage
      username={user}
      group="bringIn"
      title={translateIn(locale, "studio.location.title")}
      lede={translateIn(locale, "studio.location.lede")}
    >
      {routeSection}
      {tripDetail}
      <GpsZones username={user} streetMapsOn={streetMapsOn} />

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
