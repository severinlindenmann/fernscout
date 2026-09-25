import { redirect } from "next/navigation";
import StudioPage from "@/components/studio/StudioPage";
import PlannerFlow from "@/components/studio/plan/PlannerFlow";
import { reversePlace } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { loadUserConfig } from "@/lib/config";
import { journalCurrencies } from "@/lib/rates";
import { listWaitingPins } from "@/lib/inbox";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { buildTripDoc } from "@/lib/api/v2/trips";
import { readTripFile } from "@/lib/api/v2/store";
import { getTrip, tripRef } from "@/lib/trips";
import type { CostsDoc, PendingPin, PlanDoc } from "@/lib/planner/types";

/**
 * The pins waiting in the inbox, offered to the planner — B2014. Absent
 * outright (an empty array, never a hidden card) when WhatsApp is off; a
 * town is a best-effort reverse lookup, left off a pin rather than guessed
 * when address lookup is off or the provider fails.
 */
async function pendingPins(user: string): Promise<PendingPin[]> {
  if (!isEnabled("whatsapp", user)) return [];
  const waiting = listWaitingPins(user);
  if (waiting.length === 0) return [];
  const geocode = isEnabled("addressLookup", user);
  const locale = geocode ? await requestLocale() : "en";
  return Promise.all(
    waiting.map(async (pin) => {
      const place = geocode ? await reversePlace(pin.lat, pin.lon, locale).catch(() => null) : null;
      return {
        id: pin.id,
        lat: pin.lat,
        lng: pin.lon,
        receivedAt: pin.receivedAt,
        ...(pin.name ? { name: pin.name } : {}),
        ...(place?.location ? { town: place.location } : {}),
      };
    }),
  );
}

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
  const pins = await pendingPins(user);

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
        initialPins={pins}
      />
    </StudioPage>
  );
}
