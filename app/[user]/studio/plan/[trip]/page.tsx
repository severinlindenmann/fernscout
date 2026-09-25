import { redirect } from "next/navigation";
import StudioPage from "@/components/studio/StudioPage";
import PlannerFlow from "@/components/studio/plan/PlannerFlow";
import { isEnabled } from "@/lib/capabilities";
import { loadUserConfig } from "@/lib/config";
import { journalCurrencies } from "@/lib/rates";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { buildTripDoc } from "@/lib/api/v2/trips";
import { readTripFile } from "@/lib/api/v2/store";
import { getTrip, tripRef } from "@/lib/trips";
import type { CostsDoc, PlanDoc } from "@/lib/planner/types";

export const dynamic = "force-dynamic";

/**
 * `/[user]/studio/plan/[trip]` — B2011. The studio's own place to plan a
 * trip before it starts: `PlannerFlow` is the whole composer/list/money/
 * links component; this page only gathers what it needs, server-side, and
 * redirects away from a trip planning has nothing to say about.
 *
 * `buildTripDoc(..., includePrivatePlan: true)` — the same function and the
 * same flag the v2 `GET` route uses once it has confirmed the caller may act
 * as the owner (`app/api/v2/[user]/trips/[trip]/route.ts`). This page's own
 * gate, `requireStudioOwner`, already proved that; reading the trip file
 * directly here (rather than an HTTP round trip to itself) is the same
 * pattern every other studio flow uses (`StudioLocationPage`'s own
 * `getTrips`/`getCurrentTrip` calls).
 */
export default async function PlanPage({ params }: PageProps<"/[user]/studio/plan/[trip]">) {
  const { user, trip: tripId } = await params;
  await requireStudioOwner(user);

  const trip = getTrip(tripRef(user, tripId));
  if (!trip || trip.status !== "upcoming") {
    // No trip to plan — the ticket's own line: send the person to New trip.
    redirect(`/${user}/studio/trip/new`);
  }

  const stored = readTripFile(user, tripId);
  if (!stored) redirect(`/${user}/studio/trip/new`);

  const doc = buildTripDoc(user, tripId, stored, "none", { includePrivatePlan: true });
  const config = loadUserConfig(user);

  return (
    <StudioPage
      username={user}
      group="plan"
      title={translateIn(await requestLocale(), "studio.hub.item.plan.title", { trip: trip.title })}
    >
      <PlannerFlow
        username={user}
        tripId={tripId}
        tripStart={trip.start}
        initialPlan={(doc.plan as PlanDoc | undefined) ?? null}
        initialCosts={(doc.costs as CostsDoc | undefined) ?? null}
        baseCurrency={config.baseCurrency}
        currencies={journalCurrencies(user)}
        addressLookupEnabled={isEnabled("addressLookup", user)}
      />
    </StudioPage>
  );
}
