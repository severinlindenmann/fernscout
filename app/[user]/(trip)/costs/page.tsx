import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { notFound } from "next/navigation";
import CostsPageContent from "./CostsPageContent";
import CostsPrivate from "@/components/CostsPrivate";
import { getCostSummary } from "@/lib/costs";
import { currentTripOrRedirect } from "@/lib/currentTrip";
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
 * `cost.title` and `cost.subtitle` are the page's own heading and standfirst,
 * so the tab and the description are the strings the reader is about to see
 * rather than a second English paraphrase of them that nobody maintains.
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
  // Present tense, as `cost.subtitle` is, on a trip that may not have started.
  // The page itself switches to `cost.subtitlePlanned` there; this line does
  // not, and that is B214 rather than something absorbed into B139.
  const description = translateIn(journal, "cost.subtitle", { currency });
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
          summary={getCostSummary(tripId)}
          travellers={travellerNamesOf(userConfig, trip)}
        />
      ) : (
        <CostsPrivate />
      )}
    </TripProvider>
  );
}
