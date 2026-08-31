import { notFound, redirect } from "next/navigation";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getAllEntries } from "@/lib/entries";
import { currentTripRef, getTrip } from "@/lib/trips";
import { buildStoryProps } from "@/lib/tripView";
import { BlogStructuredData } from "@/components/StructuredData";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellersOf } from "@/lib/site";
import { getDefaultUsername, getUser } from "@/lib/users";
import TripStory from "@/app/TripStory";
import { isOwner } from "@/lib/contacts/session";

export default async function Home({ params }: PageProps<"/[user]">) {
  const { user } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  /**
   * The bare `/<user>` serves whichever trip is `current`. Having none is a
   * normal state, not a missing journal: a new journal has no trips at all,
   * and one whose trips are all `upcoming` or `past` is simply between
   * journeys. Both used to answer 404 — so a journal created through the API
   * was born broken, and its owner's first act was to look at a page that
   * said it did not exist.
   */
  const tripId = currentTripRef(user);
  if (!tripId) redirect(`/${user}/trips`);
  const current = getTrip(tripId);
  if (!current) notFound();
  // The layout draws the password form; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(current))) return null;

  const { trip, index, days, windowStart, initialDate, stats } = buildStoryProps(tripId, {
    showCosts: await mayViewCosts(current),
    includeDrafts: await isOwner(user),
  });
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  return (
    <TripProvider trip={trip} isCurrent>
      <BlogStructuredData
        entries={getAllEntries(tripId)}
        site={site}
        authors={travellersOf(userConfig, trip).map((p) => p.name)}
      />
      <TripStory
        index={index}
        days={days}
        windowStart={windowStart}
        initialDate={initialDate}
        stats={stats}
      />
    </TripProvider>
  );
}
