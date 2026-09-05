import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllEntries, getEntryBySlug } from "@/lib/entries";
import { currentTripRef, getTrip } from "@/lib/trips";
import { draftsVisibleTo, lockedMetadata, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { getUser, getUsernames } from "@/lib/users";
import { buildStoryProps } from "@/lib/tripView";
import { DayStructuredData } from "@/components/StructuredData";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellersOf } from "@/lib/site";
import { getDefaultUsername } from "@/lib/users";
import TripStory from "@/app/TripStory";
import { defaultLocaleFor, requestLocale } from "@/lib/locales";
import { localizedEntryTitle, titleWithLocation } from "@/lib/i18n";

/** Per-day permalinks. Each entry gets a real, shareable, indexable URL that
 * renders the same scrolling story, opened at that day. */
export function generateStaticParams() {
  // Every user's days, so each one is prerendered at its own URL.
  return getUsernames().flatMap((user) => {
    const ref = currentTripRef(user);
    return ref ? getAllEntries(ref).map((e) => ({ user, slug: e.slug })) : [];
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/day/[slug]">): Promise<Metadata> {
  const { user, slug } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const ref = currentTripRef(user);
  const trip = ref ? getTrip(ref) : undefined;
  if (!trip) return {};
  // Before the entry is even looked up: the description below is the day's own
  // prose, and the title names the place. Neither may leave a locked trip.
  if (!(await mayReadTrip(trip))) return lockedMetadata();
  const entry = getEntryBySlug(ref!, slug);
  if (!entry) return {};

  const image = entry.gallery.find((g) => g.type === "image")?.src;
  const description = entry.content.replace(/\s+/g, " ").slice(0, 160);
  const shared = titleWithLocation(entry.title, entry.location);
  // The tab follows the *reader*, same as the heading below it; the share
  // card keeps the written title (`entry.location` has no translation slot
  // either way).
  const locale = await requestLocale();
  const writtenLocale = defaultLocaleFor(user);
  const title = titleWithLocation(localizedEntryTitle(entry, locale, writtenLocale), entry.location);
  const url = `/${user}/day/${entry.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: shared,
      description,
      url,
      publishedTime: entry.date,
      images: image ? [{ url: image, alt: entry.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: shared,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function DayPage({ params }: PageProps<"/[user]/day/[slug]">) {
  const { user, slug } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const tripId = currentTripRef(user);
  if (!tripId) notFound();
  const current = getTrip(tripId);
  if (!current) notFound();
  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(current))) return null;

  // The owner, or somebody on the trip, may open the permalink of a day
  // nobody has published yet; for everybody else a draft slug is simply not a
  // page. B327 — before it, a buddy could not reach a day they had written.
  const drafts = await draftsVisibleTo(current);
  const entry = getEntryBySlug(tripId, slug, { includeDrafts: drafts.visible });
  if (!entry) notFound();

  const { trip, index, days, windowStart, initialDate, stats, basemap } = buildStoryProps(tripId, {
    openAt: entry.date,
    showCosts: await mayViewCosts(current),
    includeDrafts: drafts.visible,
  });

  const userConfig = getUser(user);
  if (!userConfig) notFound();

  return (
    <TripProvider trip={trip} isCurrent canPublish={drafts.canPublish}>
      <DayStructuredData
        entry={entry}
        site={site}
        authors={travellersOf(userConfig, trip).map((p) => p.name)}
      />
      <TripStory
        index={index}
        days={days}
        windowStart={windowStart}
        initialDate={initialDate}
        openAtDate={entry.date}
        stats={stats}
        basemap={basemap}
      />
    </TripProvider>
  );
}
