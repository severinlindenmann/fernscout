import TripPlanReadersFlow from "@/components/studio/trip/TripPlanReadersFlow";
import TripPicker from "@/components/studio/trip/TripPicker";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getTrips } from "@/lib/trips";
import { PLAN_READERS } from "@/lib/tripWrite";

export const dynamic = "force-dynamic";

/**
 * "What does a reader see of the plan" — B2012, beside the trip's own
 * `/studio/trip/visibility` (who may read it at all). `?trip=` names the
 * trip; without it the page shows a picker of the trips that have a plan
 * (B2071) — it used to fall back to the current trip silently, which is not
 * the trip the hub's link meant on a journal with more than one plan. With
 * only one plannable trip, that one opens directly.
 */
export default async function StudioTripPlanReadersPage({
  params,
  searchParams,
}: PageProps<"/[user]/studio/trip/plan-readers">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { trip: tripParam } = await searchParams;
  const tripId = typeof tripParam === "string" ? tripParam : null;

  const planned = getTrips(user).filter((t) => t.planSection);
  const trip = tripId ? planned.find((t) => t.id === tripId) : planned.length === 1 ? planned[0] : undefined;
  const locale = await requestLocale();

  if (!trip) {
    return (
      <StudioPage
        username={user}
        group="plan"
        title={translateIn(locale, "studio.hub.item.planReaders.title")}
        lede={translateIn(locale, planned.length > 0 ? "studio.planReaders.pick" : "studio.planReaders.empty")}
      >
        {planned.length > 0 && (
          <TripPicker base={`/${user}/studio/trip/plan-readers`} trips={planned.map((t) => ({ id: t.id, title: t.title }))} />
        )}
      </StudioPage>
    );
  }

  return (
    <StudioPage
      username={user}
      group="plan"
      title={translateIn(locale, "studio.planReaders.heading", { title: trip.title })}
    >
      <TripPlanReadersFlow
        username={user}
        trip={{ id: trip.id, title: trip.title, readers: trip.planSection?.readers ?? "map" }}
        readerLevels={PLAN_READERS}
        costsPublic={trip.costsVisibility === "public"}
      />
    </StudioPage>
  );
}
