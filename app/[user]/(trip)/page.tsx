import { notFound } from "next/navigation";
import { mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getAllEntries } from "@/lib/entries";
import { currentTripRef, getTrip } from "@/lib/trips";
import { buildStoryProps } from "@/lib/tripView";
import { BlogStructuredData } from "@/components/StructuredData";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellerFullNamesOf } from "@/lib/site";
import { getDefaultUsername, getUser } from "@/lib/users";
import TripStory from "@/app/TripStory";
import { isOwner } from "@/lib/contacts/session";

export default async function Home({ params }: PageProps<"/[user]">) {
  const { user } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const tripId = currentTripRef(user);
  if (!tripId) notFound();
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
        authors={travellerFullNamesOf(userConfig, trip)}
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
