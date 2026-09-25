import AddDayFlow from "@/components/studio/day/AddDayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { speechProvider } from "@/lib/helper/transcribe";
import { balanceOf } from "@/lib/credits";
import { formatChf } from "@/lib/creditsFormat";
import { creditsInRappen } from "@paid/credits/lib/credits/pricing";
import { WRITE_DAY_CREDITS } from "@/lib/helper/credits";
import { MINUTES_PER_CREDIT } from "@/lib/helper/speech";
import { getTrips } from "@/lib/trips";
import { journalCurrencies } from "@/lib/rates";
import { namesOnTrip } from "@/lib/tripPeople";
import { readTellBy } from "@/lib/studio/tellBy";
import { proposeAddDayTrip, tripsForAddDay, writtenDatesForTrip } from "@/lib/studio/day";

export const dynamic = "force-dynamic";

/**
 * "Add a day" — B1830, spec §5. The studio's main flow, and the first proof
 * the skeleton (B1824/B1829) carries something that is not a file upload.
 *
 * Everything read here is server-side and handed down once, the same split
 * `app/[user]/studio/photos/page.tsx` already makes for its own trip list —
 * `AddDayFlow` never re-derives the trip proposal or the declinable field
 * list itself, so the hub's own reasoning and this flow's cannot drift.
 */
export default async function StudioAddDayPage({ params, searchParams }: PageProps<"/[user]/studio/day/new">) {
  const { user } = await params;
  // `?trip=<id>` — trip/new's done screen names the trip it just made.
  const { trip, photos } = await searchParams;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  const trips = tripsForAddDay(user);
  // One prop, read server-side from the same owner-scoped source
  // `findDayForDate` uses — `DayStrip` (B1989) marks a written day without a
  // client-side fetch, and a trip with no days yet gets an empty array,
  // never a missing key.
  const writtenDatesByTrip = Object.fromEntries(trips.map((t) => [t.id, writtenDatesForTrip(user, t.id)]));
  const proposal = proposeAddDayTrip(user);
  // The same two gates `write-day/route.ts` itself checks before it will
  // spend a credit — read here so the flow never even offers a button that
  // route would refuse. `isEnabled("helper", user)` is the capability
  // switch; consent is the owner's own prior "yes" to a model reading their
  // notes at all (AGENTS.md: every optional capability is absent, not
  // broken, when off).
  const wordsAssistAvailable = isEnabled("helper", user) && hasHelperConsent(user, "words");
  // B2200, D1 — the "where" step's place suggestion. Read here, server-side,
  // the same way `wordsAssistAvailable` is: an owner-scoped capability check
  // the flow uses to decide whether to ask the suggestion route at all,
  // never a route a switched-off journal's browser calls and gets refused.
  const routeRecordingAvailable = isEnabled("routeRecording", user);
  // B2188 — the weather chip and the microphone, each absent (never
  // broken) with its capability off.
  const weatherAvailable = isEnabled("weather", user);
  const speechEnabled = isEnabled("transcription", user);
  // B2234 — the owner's balance, read once and shared by "Polish my text"
  // and the spoken questions: both say a price before the tap, and both
  // refuse it before the tap rather than after a 402, from the same number.
  const credits = wordsAssistAvailable || speechEnabled ? await balanceOf(user) : null;
  const speech = speechEnabled
    ? {
        consented: hasHelperConsent(user, "speech"),
        provider: speechProvider(),
        credits,
        // B2288 — same pattern as `polishPriceChf` above: computed here, not
        // in `RecordButton`/`SpeakFlow` (client components), since pricing is
        // paid-only code after the open-core split.
        priceChf: formatChf(creditsInRappen(1 / MINUTES_PER_CREDIT)),
      }
    : null;
  // Who else sees a draft on each trip — `draftsVisibleTo` lets in the owner
  // and the people on the trip, which is exactly `namesOnTrip` after the
  // owner's own name. Names only, never an address.
  const readersByTrip = Object.fromEntries(
    await Promise.all(getTrips(user).map(async (t) => [t.id, (await namesOnTrip(t)).slice(1).filter(Boolean)] as const)),
  );

  return (
    <StudioPage username={user} group="write" title={translateIn(locale, "studio.day.title")} lede={translateIn(locale, "studio.day.lede")}>
      <AddDayFlow
        username={user}
        trips={trips}
        writtenDatesByTrip={writtenDatesByTrip}
        proposal={proposal}
        polishCredits={wordsAssistAvailable ? credits : null}
        // B2254 — computed here, not in `PolishText` (a client component):
        // pricing is paid-only code after the open-core split, and a public
        // build must show no price rather than a wrong CHF 0.00.
        polishPriceChf={wordsAssistAvailable ? formatChf(creditsInRappen(WRITE_DAY_CREDITS)) : null}
        routeRecordingAvailable={routeRecordingAvailable}
        weatherAvailable={weatherAvailable}
        speech={speech}
        readersByTrip={readersByTrip}
        initialTripId={typeof trip === "string" ? trip : undefined}
        tellBy={speech ? readTellBy(user) : null}
        // B2193 — `?photos=<date>|undated`, a hub day card.
        initialPhotos={typeof photos === "string" ? photos : undefined}
        currencies={journalCurrencies(user)}
      />
    </StudioPage>
  );
}
