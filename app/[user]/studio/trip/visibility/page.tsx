import Link from "next/link";
import TripPicker from "@/components/studio/trip/TripPicker";
import TripVisibilityFlow from "@/components/studio/trip/TripVisibilityFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { tripForVisibilityFlow } from "@/lib/studio/tripVisibilityFlow";
import { previewTrip } from "@/lib/studio/audiencePreview";
import { VISIBILITIES } from "@/lib/tripWrite";
import { tripsForEdit } from "@/lib/studio/tripEdit";

export const dynamic = "force-dynamic";

/**
 * "Who may read this trip" — B1833, spec §7.6; a page since B2071, reached
 * from Edit a trip and from the trip page's own visibility badge.
 *
 * Every candidate's preview (V2) is computed here, server-side, for all
 * three visibilities at once — there are only three, and precomputing them
 * means switching which one the person is looking at costs nothing.
 *
 * B2141: "Choose another trip" (`?pick=1`) swaps the flow for the studio's
 * `TripPicker`, which is also what a journal with no current trip sees
 * instead of "no trip".
 */
export default async function StudioTripVisibilityPage({
  params,
  searchParams,
}: PageProps<"/[user]/studio/trip/visibility">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { trip: tripParam, pick } = await searchParams;
  const tripId = typeof tripParam === "string" ? tripParam : null;

  const trips = tripsForEdit(user);
  const trip = pick ? undefined : tripForVisibilityFlow(user, tripId);
  const locale = await requestLocale();

  if (!trip && trips.length > 0) {
    return (
      <StudioPage
        username={user}
        group="plan"
        title={translateIn(locale, "studio.tripVisibility.title")}
        lede={translateIn(locale, "studio.tripVisibility.pick")}
      >
        <TripPicker base={`/${user}/studio/trip/visibility`} trips={trips} />
      </StudioPage>
    );
  }

  if (!trip) {
    return (
      <StudioPage username={user} group="plan" title={translateIn(locale, "studio.hub.item.tripEdit.title")}>
        <p className="mt-2 text-sm text-ink-body">{translateIn(locale, "studio.tripVisibility.empty")}</p>
      </StudioPage>
    );
  }

  const previews = Object.fromEntries(
    VISIBILITIES.map((v) => [
      v,
      previewTrip(user, trip, v === "private" ? "guest" : v, v),
    ]),
  ) as Record<(typeof VISIBILITIES)[number], ReturnType<typeof previewTrip>>;

  return (
    <StudioPage
      username={user}
      group="plan"
      title={translateIn(locale, "studio.tripVisibility.title")}
      lede={translateIn(locale, "studio.tripVisibility.lede", { title: trip.title })}
    >
      {trips.length > 1 && (
        <Link
          href={`/${user}/studio/trip/visibility?pick=1`}
          className="mt-2 inline-block text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {translateIn(locale, "studio.tripVisibility.chooseAnother")}
        </Link>
      )}
      <TripVisibilityFlow
        username={user}
        trip={{ id: trip.id, title: trip.title, visibility: trip.visibility, listed: trip.listed, teaser: trip.teaser === true }}
        visibilities={VISIBILITIES}
        previews={previews}
      />
    </StudioPage>
  );
}
