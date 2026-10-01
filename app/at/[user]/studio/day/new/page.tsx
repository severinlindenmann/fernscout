import DayFlow from "@/components/studio/day/DayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { isEnabled } from "@/lib/capabilities";
import { currentHelperProvider, hasHelperConsent } from "@/lib/helper/consent";
import { readAssistantChoice } from "@/lib/studio/assistantChoice";
import { speechProvider } from "@/lib/helper/transcribe";
import { aiDaysStatus, mayUseAi } from "@paid/billing/lib/aiDays";
import AiDaysChip from "@/components/studio/day/AiDaysChip";
import { PLANS, chf } from "@paid/billing/lib/plans";
import { getTrips } from "@/lib/trips";
import { journalCurrencies } from "@/lib/rates";
import { namesOnTrip } from "@/lib/tripPeople";
import { readTellBy } from "@/lib/studio/tellBy";
import { proposeAddDayTrip, tripsForAddDay, writtenDatesForTrip } from "@/lib/studio/day";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "Add a day" — B1830, spec §5. The studio's main flow, and the first proof
 * the skeleton (B1824/B1829) carries something that is not a file upload.
 *
 * Everything read here is server-side and handed down once, the same split
 * `app/at/[user]/studio/photos/page.tsx` already makes for its own trip list —
 * `AddDayFlow` never re-derives the trip proposal or the declinable field
 * list itself, so the hub's own reasoning and this flow's cannot drift.
 */
export default async function StudioAddDayPage({ params, searchParams }: PageProps<"/at/[user]/studio/day/new">) {
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
  // use an AI day — read here so the flow never even offers a button that
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
  // B2234/B2591 — the plan's AI-day gate, read once and shared by the
  // spoken questions' own before-the-tap check and "Polish my text", both of
  // which need an active plan or unused Free days (`mayUseAi`) but take no
  // AI day themselves.
  const aiAvailable = wordsAssistAvailable || speechEnabled ? (await mayUseAi(user)).ok : null;
  const polishAiAvailable = wordsAssistAvailable ? aiAvailable : null;
  const speech = speechEnabled
    ? {
        consented: hasHelperConsent(user, "speech"),
        provider: speechProvider(),
        aiAvailable,
      }
    : null;
  // Who else sees a draft on each trip — `draftsVisibleTo` lets in the owner
  // and the people on the trip, which is exactly `namesOnTrip` after the
  // owner's own name. Names only, never an address.
  const readersByTrip = Object.fromEntries(
    await Promise.all(getTrips(user).map(async (t) => [t.id, (await namesOnTrip(t)).slice(1).filter(Boolean)] as const)),
  );

  // B2591 — the "AI days X of Y" chip, canvas draft "Studio: AI days used
  // up" (board Wall.dc.html). Absent with `billing` off or an unlimited
  // plan (`aiDaysStatus` reports `{unlimited: true}` in both cases).
  const aiStatus = await aiDaysStatus(user);

  return (
    <StudioPage username={user} group="write" title={translateIn(locale, "studio.day.title")} lede={translateIn(locale, "studio.day.lede")}>
      <AiDaysChip
        username={user}
        status={aiStatus}
        offers={{
          passPrice: chf(PLANS.tripPass.priceChf),
          passDays: PLANS.tripPass.days,
          plusPrice: `${chf(PLANS.plus.priceChf)} / ${translateIn(locale, "plans.perYear")}`,
        }}
      />
      <DayFlow
        // TIX-2 — the whole flow: assistant choice, parts, check, share.
        assistantChoice={readAssistantChoice(user)}
        assistantPossible={isEnabled("helper", user) || speechEnabled}
        helperOn={isEnabled("helper", user)}
        consents={{
          words: hasHelperConsent(user, "words"),
          photos: hasHelperConsent(user, "photos"),
          speech: hasHelperConsent(user, "speech"),
        }}
        providers={{ words: currentHelperProvider("words"), speech: speechEnabled ? speechProvider() : null }}
        username={user}
        trips={trips}
        writtenDatesByTrip={writtenDatesByTrip}
        proposal={proposal}
        polishAiAvailable={polishAiAvailable}
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
