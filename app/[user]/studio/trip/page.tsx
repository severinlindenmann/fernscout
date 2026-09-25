import TripEditFlow from "@/components/studio/trip/TripEditFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { tripEditPanel, tripForEdit, tripsForEdit } from "@/lib/studio/tripEdit";
import { requestLocale, translateIn } from "@/lib/locales";
import { isEnabled } from "@/lib/capabilities";
import { hasHomeZoneOrDeclined } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

/**
 * "Edit a trip" — B2018; one page with sections since B2072. A trip's title,
 * dates, visibility, plan readers, address and deletion used to be four
 * different places; this is the one page.
 *
 * Without `?trip=` on a multi-trip journal this shows the picker alone rather
 * than silently guessing a trip the way `tripForVisibilityFlow`'s
 * current-trip fallback does. With one trip on the journal, that one trip
 * opens directly and there is nothing to pick between. `?section=` scrolls
 * to one section on arrival (`address`, from the retired rename route).
 */
export default async function StudioTripEditPage({
  params,
  searchParams,
}: PageProps<"/[user]/studio/trip">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { trip: tripParam, section } = await searchParams;
  const tripId = typeof tripParam === "string" ? tripParam : null;
  const locale = await requestLocale();

  const trips = tripsForEdit(user);

  if (trips.length === 0) {
    return (
      <StudioPage username={user} group="plan" title={translateIn(locale, "studio.hub.item.tripEdit.title")}>
        <p className="mt-2 text-sm text-ink-body">{translateIn(locale, "studio.tripEdit.empty")}</p>
      </StudioPage>
    );
  }

  const resolvedId = tripId ?? (trips.length === 1 ? trips[0].id : null);
  const fullTrip = resolvedId ? tripForEdit(user, resolvedId) : undefined;
  const trip = fullTrip ? tripEditPanel(fullTrip) : undefined;
  // B2198 — read server-side, the same way `wordsAssistAvailable` is on the
  // add-a-day page: a capability the client never has to ask for.
  const routeRecordingAvailable = isEnabled("routeRecording", user);
  const homeZoneReady = routeRecordingAvailable ? hasHomeZoneOrDeclined(user) : false;

  return (
    <StudioPage
      username={user}
      group="plan"
      title={translateIn(locale, "studio.hub.item.tripEdit.title")}
      lede={
        trip
          ? translateIn(locale, "studio.tripEdit.lede", { title: trip.title })
          : translateIn(locale, "studio.tripEdit.pick.subtitle")
      }
    >
      {/* Keyed on picking vs editing, not on the id: choosing a trip mounts
          the form fresh, while a rename (a new id, same trip) keeps it. */}
      <TripEditFlow
        key={trip ? "trip" : "pick"}
        username={user}
        trips={trips}
        trip={trip}
        section={typeof section === "string" ? section : undefined}
        routeRecordingAvailable={routeRecordingAvailable}
        homeZoneReady={homeZoneReady}
      />
    </StudioPage>
  );
}
