import { notFound } from "next/navigation";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getAllEntries } from "@/lib/entries";
import { currentTripOrRedirect } from "@/lib/currentTrip";
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
  // No current trip is a normal state, not a missing journal — the four
  // pages `SiteNav` offers all resolve it the same way. See lib/currentTrip.ts.
  const current = currentTripOrRedirect(user);
  const tripId = current.ref;
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(current))) return null;

  const { trip, index, days, windowStart, initialDate, stats, basemap } = buildStoryProps(tripId, {
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
        basemap={basemap}
      />
    </TripProvider>
  );
}
