import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { draftsVisibleTo, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import CostsPageContent from "./CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary, hasCostsData } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { getCurrentTrip } from "@/lib/trips";
import { getDays } from "@/lib/entries";
import { hasBegun } from "@/lib/tripTime";
import type { TranslationKey } from "@/lib/i18n";
import TripProvider from "@/components/TripProvider";
import { getUser } from "@/lib/users";
import { isEnabled } from "@/lib/capabilities";
import { travellerNamesOf } from "@/lib/site";

/**
 * Two languages on purpose — the same split the map and gallery pages carry,
 * and for the same reason.
 *
 * The tab title follows the *reader*: it lands in their history, their
 * bookmarks and their tab strip. The sharing card follows the *journal*,
 * because whoever sees a forwarded card is not this reader and their language
 * is not knowable from this request.
 *
 * Both were English literals until B139 — "Costs" in the tab over a page whose
 * `<h1>` said "Was die Reise kostet", on a journal that has never had an
 * English word on it. The trip-scoped route next door
 * (app/[user]/trips/[trip]/costs/page.tsx) had already been given the reader's
 * language; these are two routes onto one page and they disagreed.
 *
 * `cost.title` and the standfirst below it are the page's own strings, so the
 * tab and the description are what the reader is about to see rather than a
 * second English paraphrase of them that nobody maintains — and, since B214,
 * the standfirst's *tense* as well as its words.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[user]/costs">): Promise<Metadata> {
  const { user } = await params;
  // No description of a page that is not there. B165.
  if (!isEnabled("costs", user)) return {};
  const currency = getUser(user)?.baseCurrency ?? "CHF";
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  /**
   * The tense, asked the way the page asks it (B214).
   *
   * `cost.subtitle` — "from the visas and jabs before we left to today's
   * coffee" — is a claim about a trip under way, and the standfirst one line
   * below the description switches to `cost.subtitlePlanned` when there is no
   * such trip. This line did not, so a journal whose current trip is still
   * ahead of it shared a link preview contradicting its own page.
   *
   * Not `getCostSummary`, which is where the flag lives: it converts every
   * item in the trip and is not cached, so calling it for one string would
   * price the whole trip twice per request. Not `hasBegun(trip)` on its own
   * either, though the ticket offered it — it is the cheap half of the
   * question and differs from the page's answer for a trip still marked
   * `upcoming` that has a day written, which is exactly the case B19 and B72
   * are about and the one a reader would notice.
   *
   * `getDays` is the same call the summary makes, and `getAllEntries` beneath
   * it is cached per directory against a fingerprint of the files (see
   * lib/entries.ts), so this costs a `stat` and gives the identical answer.
   * Same trade as the map page's metadata, one route over.
   */
  const trip = getCurrentTrip(user);
  // No current trip at all: the page redirects to the trip list, so nothing
  // renders under this description. The planned wording is the one that claims
  // less, which is what the map page settled on for the same state.
  //
  // A current trip that has no `costs.md` is the other state nothing should
  // describe: the page below 404s for it (B267), so no description belongs
  // to it either — the same "not there" AGENTS.md asks for a disabled
  // capability, reached here by way of missing data rather than a switch.
  if (trip && !hasCostsData(trip.ref)) return {};
  const begun = trip ? hasBegun(trip, getDays(trip.ref)) : false;
  const blurb: TranslationKey = begun ? "cost.subtitle" : "cost.subtitlePlanned";
  const description = translateIn(journal, blurb, { currency });
  const shared = translateIn(journal, "cost.title");
  return {
    title: translateIn(reader, "cost.title"),
    description,
    alternates: { canonical: `/${user}/costs` },
    openGraph: {
      type: "website",
      title: shared,
      description,
      url: `/${user}/costs`,
    },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function CostsPage({ params }: PageProps<"/[user]/costs">) {
  const { user } = await params;
  /**
   * A journal that does not do spending has no costs page — 404, not an empty
   * one. B165.
   *
   * `notFound()` is what every other capability-gated route does
   * (app/[user]/contacts/page.tsx, app/[user]/i/[token]/page.tsx), and the
   * reason it is right here is the one AGENTS.md gives: a capability that is
   * off must be *absent* rather than broken. An operator who switches `costs`
   * off is told by `/api/health` that it is off; a page that answers 200 with
   * the full budget panel makes that a claim the running site contradicts.
   *
   * In the page rather than the layout, for the reason in lib/tripGate.ts: a
   * layout gate leaks the page's data into the RSC payload and the head even
   * when it renders something else.
   */
  if (!isEnabled("costs", user)) notFound();
  // No current trip is a normal state, not a missing page. See lib/currentTrip.ts.
  const trip = currentTripOrRedirect(user);
  const tripId = trip.ref;
  /**
   * `costs` is on by default at trip creation (lib/journals.ts), so the
   * capability being on says nothing about whether this trip ever got a
   * `costs.md`. Without this, a trip that never did rendered the panel
   * anyway, with every figure zero — the same "absent rather than broken"
   * failure the capability check above exists to prevent, reached by way of
   * missing data instead of a switched-off feature. B267.
   *
   * `hasCostsData` also asks the days now (B328), so a draft day's costs
   * must not count for a reader who cannot see that day — the same leak as
   * B296, B318 and B322. `read` below is the owner's own view; every other
   * reader gets the default, drafts excluded.
   */
  /**
   * Who may see this trip's unpublished days is the *trip's* question, not
   * "is this the owner" — B327 established that and `test/draft-audience.test.ts`
   * pins it: somebody named in a trip's `people:` may read their own writing
   * back, and a guest let into the journal may not. B328 arrived at the same
   * moment and reached for `isOwner`, which was the pattern B318 had used an
   * hour earlier and which B327 replaced everywhere else.
   */
  const drafts = await draftsVisibleTo(trip);
  const read = { includeDrafts: drafts.visible };
  if (!hasCostsData(tripId, read)) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  return (
    <TripProvider trip={trip} isCurrent>
      {(await mayViewCosts(trip)) ? (
        <CostsPageContent
          summary={getCostSummary(tripId, undefined, read)}
          travellers={travellerNamesOf(userConfig, trip)}
        />
      ) : (
        <CostsPrivate />
      )}
    </TripProvider>
  );
}
