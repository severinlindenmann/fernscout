import { notFound } from "next/navigation";
import { recordTripView } from "@/lib/analytics/record";
import { readFor, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getAllEntries, type ReadOptions } from "@/lib/entries";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { defaultLocaleFor, requestLocale } from "@/lib/locales";
import { buildStoryProps, tripTrackFor } from "@/lib/tripView";
import { BlogStructuredData } from "@/components/StructuredData";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellerNamesOf, travellersOf, type SiteSummary, madeWithFor } from "@/lib/site";
import { getDefaultUsername, getUser } from "@/lib/users";
import TripStory from "@/app/TripStory";
import RouteBoundary from "@/components/RouteBoundary";
import type { UserConfig } from "@/lib/config";
import type { Trip } from "@/lib/types";

/** B2550 — kept in the client router cache for 30s: a `Link` tap back to a
 * day, trip or list a reader already opened moments ago (Trips → back, a
 * `StoryPager` step) shows what was already fetched rather than waiting on
 * the server again. Owner-only mutations do not live on this page (they are
 * under `/studio`), so nothing here can go stale in a way that matters more
 * than a 30s wait would have cost anyway. Pages only, per Next's own rule —
 * never on a layout. */
export const unstable_dynamicStaleTime = 30;

export default async function Home({ params }: PageProps<"/at/[user]">) {
  const { user } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  // No current trip is a normal state, not a missing journal — the four
  // pages `SiteNav` offers all resolve it the same way. See lib/currentTrip.ts.
  const current = await currentTripOrRedirect(user);
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(current))) return null;

  // B566. After the gate, deliberately: a view that was refused is not a
  // view. `journal` rather than `trip` because this URL *is* the journal —
  // `/<user>` renders whichever trip is current — so it is the number the
  // owner means by "was it opened at all". The trip id rides along so the
  // per-trip table still counts it.
  //
  // B327: the owner, or somebody on the trip. `canPublish` travels with it
  // because the draft banner has to say which of the two is reading.
  //
  // Together rather than one after another: the view is written whatever the
  // other two answer, and neither of them reads what it writes, so the only
  // thing the order bought was three round trips where one will do.
  const [, { read, canPublish, owner }, showCosts] = await Promise.all([
    recordTripView(current, "journal"),
    readFor(current),
    mayViewCosts(current),
  ]);
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  return (
    <TripProvider trip={current} isCurrent canPublish={canPublish} reader={read.reader} owner={owner} units={userConfig.units}>
      {/* Every answer this page can give other than the story is settled
          above this line; see the same boundary in
          app/at/[user]/trips/[trip]/page.tsx and components/RouteSkeleton.tsx. */}
      <RouteBoundary shape="story">
        <CurrentStoryBody trip={current} read={read} showCosts={showCosts} site={site} userConfig={userConfig} />
      </RouteBoundary>
    </TripProvider>
  );
}

/** The story, below the boundary — see `TripStoryBody` in
 * app/at/[user]/trips/[trip]/page.tsx, which this mirrors for the bare URL. */
async function CurrentStoryBody({
  trip,
  read,
  showCosts,
  site,
  userConfig,
}: {
  trip: Trip;
  read: ReadOptions;
  showCosts: boolean;
  site: SiteSummary;
  userConfig: UserConfig;
}) {
  const tripId = trip.ref;
  const { index, days, windowStart, initialDate, stats, basemap, locals } = buildStoryProps(tripId, {
    showCosts,
    ...read,
    // The window's prose is rendered here, in this reader's language — see
    // lib/prose.ts.
    locale: await requestLocale(),
  });
  // The trip's own recorded line — B2449. See the mirrored call in
  // app/[user]/trips/[trip]/page.tsx.
  const tripTrack = tripTrackFor(trip, index);
  return (
    <>
      <BlogStructuredData
        entries={getAllEntries(tripId)}
        site={site}
        authors={travellersOf(userConfig, trip).map((p) => p.name)}
        dayBase={site.base}
        inLanguage={defaultLocaleFor(site.username)}
      />
      <TripStory
        madeWith={madeWithFor(userConfig, trip)}
        index={index}
        days={days}
        windowStart={windowStart}
        initialDate={initialDate}
        stats={stats}
        basemap={basemap}
        locals={locals}
        tripTrack={tripTrack}
        // B10 — who took this trip, visible on the page itself rather than
        // only inside the StructuredData script tag above.
        travellerNames={travellerNamesOf(userConfig, trip)}
      />
    </>
  );
}
