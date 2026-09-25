import NewTripFlow from "@/components/studio/trip/NewTripFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { existingTripsForNewTrip, restForNewTrip } from "@/lib/studio/newTrip";
import { VISIBILITIES, ACCENTS } from "@/lib/tripWrite";
import { isEnabled } from "@/lib/capabilities";
import { waitingDaysFor } from "@/lib/studio/inbox";

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export const dynamic = "force-dynamic";

/**
 * "A new trip" — B1821, spec §7.2.
 *
 * `VISIBILITIES` and `ACCENTS` are read here, server-side, and handed down as
 * plain props — `lib/tripWrite.ts` is `server-only` and cannot be imported
 * from `NewTripFlow.tsx` itself (see that component's own doc comment).
 */
export default async function StudioNewTripPage({ params, searchParams }: PageProps<"/[user]/studio/trip/new">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const rest = await restForNewTrip(user);
  // B2193 — `?start=&end=` from a hub day card: dates prefilled, and the
  // photographs they span counted from the same grouping the card used.
  const sp = await searchParams;
  const [start, end] = [isoDay(sp.start), isoDay(sp.end)];
  const { cards } = waitingDaysFor(user);
  const initialRange =
    start && end && start <= end
      ? { start, end, photos: cards.filter((c) => start <= c.date && c.date <= end).reduce((n, c) => n + c.photoIds.length, 0) }
      : undefined;

  return (
    <StudioPage username={user} group="plan" title={translateIn(await requestLocale(), "studio.hub.item.newTrip.title")}>
      <NewTripFlow
        key={initialRange ? `${start}_${end}` : "blank"}
        username={user}
        visibilities={VISIBILITIES}
        accents={ACCENTS}
        existingTrips={existingTripsForNewTrip(user)}
        whatsappAvailable={isEnabled("whatsapp", user)}
        initialRange={initialRange}
        photoRun={cards.find((c) => c.newTrip)?.newTrip ?? null}
        {...rest}
      />
    </StudioPage>
  );
}
