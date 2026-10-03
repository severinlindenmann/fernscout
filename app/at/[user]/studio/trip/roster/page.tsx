import { notFound } from "next/navigation";
import TripPicker from "@/components/studio/trip/TripPicker";
import GroupRosterFlow from "@/components/studio/trip/GroupRosterFlow";
import StudioPage from "@/components/studio/StudioPage";
import { isEnabled } from "@/lib/capabilities";
import { readRoster } from "@/lib/groupRoster";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { isJournalOwner, requireStudioOwner } from "@/lib/studio/pageGate";
import { tripForEdit, tripsForEdit } from "@/lib/studio/tripEdit";

export const dynamic = "force-dynamic";

/**
 * "Who writes which day" — B2435 slice 1. The group-trip roster and duty plan,
 * the trip owner's own page, reached from one row on Edit a trip. Absent (404)
 * unless features.groupTrips is on. Nothing here opens anything for anyone else.
 */
export default async function StudioTripRosterPage({ params, searchParams }: PageProps<"/at/[user]/studio/trip/roster">) {
  const { user } = await params;
  await requireStudioOwner(user);
  // Minors' names: the operator gets the same 404 a stranger does.
  if (!(await isJournalOwner(user))) notFound();
  if (!isEnabled("groupTrips", user)) notFound();
  const { trip: tripParam } = await searchParams;
  const locale = await requestLocale();
  const trips = tripsForEdit(user);
  const id = typeof tripParam === "string" ? tripParam : trips.length === 1 ? trips[0].id : null;
  const trip = id ? tripForEdit(user, id) : undefined;
  const title = translateIn(locale, "studio.groupTrip.title");

  if (!trip) {
    return (
      <StudioPage username={user} group="plan" title={title} lede={translateIn(locale, "studio.tripEdit.pick.subtitle")}>
        <TripPicker base={`${journalPath(user)}/studio/trip/roster`} trips={trips} />
      </StudioPage>
    );
  }
  return (
    <StudioPage username={user} group="plan" title={title} lede={translateIn(locale, "studio.groupTrip.lede", { title: trip.title })}>
      <GroupRosterFlow
        username={user}
        trip={{ id: trip.id, title: trip.title, start: trip.start, end: trip.end }}
        initial={readRoster(user, trip.id)}
      />
    </StudioPage>
  );
}
