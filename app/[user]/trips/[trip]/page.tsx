import type { Metadata } from "next";
import { readFor, lockedMetadata, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { recordTripView } from "@/lib/analytics/record";
import { notFound, redirect } from "next/navigation";
import { basemapForRoute } from "@/lib/basemap";
import { getAllEntries } from "@/lib/entries";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { buildStoryProps, showsCountdown } from "@/lib/tripView";
import { getPlan, getPlanPrivate, stopsForReaders } from "@/lib/plan";
import { getBudgetInBase } from "@/lib/costs";
import { photobookEntryFor } from "@paid/photobook/lib/photobook/entry";
import { BlogStructuredData } from "@/components/StructuredData";
import { getUser, getUsernames } from "@/lib/users";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellerNamesOf, travellersOf } from "@/lib/site";
import { getDefaultUsername } from "@/lib/users";
import TripCountdown from "@/components/TripCountdown";
import TripStory from "@/app/TripStory";
import { requestLocale } from "@/lib/locales";
import { localizedTripTitle } from "@/lib/i18n";
import type { Trip } from "@/lib/types";

export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
    .filter((t) => t.id !== current)
      .map((t) => ({ user, trip: t.id }));
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  if (!(await mayReadTrip(trip))) return lockedMetadata();
  const description = trip.tagline ?? trip.intro.replace(/\s+/g, " ").slice(0, 160);
  // The tab follows the *reader* (see app/[user]/trips/page.tsx for why); the
  // share card below keeps `trip.title`, the language the trip is written in.
  const { title } = localizedTripTitle(trip, await requestLocale());
  return {
    title,
    description,
    alternates: { canonical: `/${user}/trips/${trip.id}` },
    openGraph: {
      type: "website",
      title: trip.title,
      description,
      url: `/${user}/trips/${trip.id}`,
      images: trip.cover ? [{ url: trip.cover, alt: trip.title }] : undefined,
    },
    twitter: { card: "summary_large_image", title: trip.title, description },
  };
}

export default async function TripPage({ params }: PageProps<"/[user]/trips/[trip]">) {
  const { user, trip: id } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  // The current trip lives at the bare URLs; one canonical URL per page.
  if (trip.status === "current") redirect(`/${user}`);

  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;

  // B566. `trip`, not `journal`: the current trip is at `/<user>` and records
  // itself there, so everything reaching this route is somebody choosing a
  // past trip out of the switcher — which is the more interesting number of
  // the two, and would be lost if both URLs recorded the same kind.
  await recordTripView(trip, "trip");

  // B327: who may see this trip's unpublished days, and whether putting one
  // on the site is theirs. Owner, or somebody on the trip.
  const { read, canPublish, owner } = await readFor(trip);

  // Not `status === "upcoming"` alone: see `showsCountdown` for why a
  // published day settles it whatever the status says (B72).
  if (showsCountdown(trip)) {
    // The countdown draws the same merged route as the map — see
    // app/[user]/(trip)/map/page.tsx for why this is gated on ownership.
    const plan = getPlan(trip.ref, read);
    // B2012 — the map alone, or the fuller stop-by-stop detail too; absent
    // on disk reads as `map`. `Trip.planSection` still carries `readers`
    // (only `private` is stripped, unconditionally — see `dropPlanPrivate`
    // in lib/trips.ts), so no separate read is needed for this half.
    const readers = trip.planSection?.readers ?? "map";
    // `nights`/`note`/`see` etc. are the `details` level's own fields —
    // dropped here rather than only unrendered, so a `map`-level reader's
    // page source never carries them either. See lib/plan.ts's
    // stopsForReaders.
    const stops = stopsForReaders(plan.stops, readers);
    // The stay and links behind each stop: read fresh, off disk, and only
    // for a `person` reader — never through `Trip`, which is cached
    // process-wide and handed whole to this same client component
    // regardless of who is asking. See lib/plan.ts's getPlanPrivate.
    const personPlan = read.reader === "person" ? getPlanPrivate(trip.ref) : null;
    // Neither client component below reads `planSection` at all — the
    // countdown draws the plan from `stops`, already projected for this
    // reader above. Left on `trip` it would still reach the client whole:
    // `Trip` is one object handed to both, and `dropPlanPrivate`
    // (lib/trips.ts) only ever strips `private`, never a note the `map`
    // level itself has to hold back. Dropped here rather than widening that
    // stripping to be reader-aware, since nothing downstream of this branch
    // needs the section at all.
    const clientTrip: Trip = { ...trip, planSection: undefined };
    return (
      <TripProvider trip={clientTrip} isCurrent={false}>
        <TripCountdown
          trip={clientTrip}
          stops={stops}
          readers={readers}
          personPlan={personPlan}
          // `owner`, not `canPublish`: changing the plan is the same
          // editorial call as publishing a draft, and this is that same
          // boolean — see the note on `readFor`'s own `owner` field.
          changePlanHref={owner ? `/${user}/studio/plan/${trip.id}` : undefined}
          // Costs are their own visibility question — B2012 wires the
          // budget total into it, same as the story page below already
          // does for its own spend block.
          budget={(await mayViewCosts(trip)) ? getBudgetInBase(trip.ref) : undefined}
          // No stops, no map (TripCountdown draws one only when there are),
          // and therefore no basemap — see basemapForRoute, and B85.
          basemap={basemapForRoute(plan.stops)}
        />
      </TripProvider>
    );
  }

  const { index, days, windowStart, initialDate, stats, basemap, locals } = buildStoryProps(trip.ref, {
    showCosts: await mayViewCosts(trip),
    ...read,
    // The window's prose is rendered here, in this reader's language — see
    // lib/prose.ts.
    locale: await requestLocale(),
  });
  const userConfig = getUser(user);
  if (!userConfig) notFound();
  // Not `isOwner` inline: see the note beside the equivalent call in the
  // gallery page.
  const photobook = await photobookEntryFor(trip);
  return (
    // `canPublish` is the same viewer fact every sibling route passes
    // (`/day/<slug>`, the gallery, the map) and this one did not — it is read
    // at the top of this function and was simply never handed on, so an
    // owner's own controls on a past trip's story, `DayNotify` among them,
    // rendered for nobody.
    <TripProvider trip={trip} isCurrent={false} canPublish={canPublish} reader={read.reader} owner={owner} units={userConfig.units}>
      <BlogStructuredData
        entries={getAllEntries(trip.ref)}
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
        locals={locals}
        photobook={photobook}
        // B10 — who took this trip, visible on the page itself rather than
        // only inside the StructuredData script tag above.
        travellerNames={travellerNamesOf(userConfig, trip)}
      />
    </TripProvider>
  );
}
