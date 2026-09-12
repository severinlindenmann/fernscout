import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAllEntries, getEntryBySlug } from "@/lib/entries";
import { getCurrentTrip, getTrip, getTrips, tripRef } from "@/lib/trips";
import { buildStoryProps } from "@/lib/tripView";
import { readFor, lockedMetadata, mayReadTrip, mayViewCosts } from "@/lib/tripGate";
import { photobookEntryFor } from "@/lib/photobook/entry";
import { DayStructuredData } from "@/components/StructuredData";
import { getUser, getUsernames } from "@/lib/users";
import TripProvider from "@/components/TripProvider";
import { siteSummary, travellersOf } from "@/lib/site";
import { getDefaultUsername } from "@/lib/users";
import TripStory from "@/app/TripStory";
import { defaultLocaleFor, requestLocale } from "@/lib/locales";
import { localizedEntryTitle, titleWithLocation } from "@/lib/i18n";

/** Per-day permalinks for every non-current trip. Each entry gets a real,
 * shareable, indexable URL that renders the same scrolling story, opened at
 * that day. */
export function generateStaticParams() {
  return getUsernames().flatMap((user) => {
    const current = getCurrentTrip(user)?.id;
    return getTrips(user)
      .filter((t) => t.id !== current && t.status !== "upcoming")
      .flatMap((t) =>
        getAllEntries(t.ref).map((e) => ({ user, trip: t.id, slug: e.slug })),
      );
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/[user]/trips/[trip]/day/[slug]">): Promise<Metadata> {
  const { user, trip: id, slug } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) return {};
  // Before the entry is even looked up: the description below is the day's own
  // prose, and the title names the place. Neither may leave a locked trip.
  if (!(await mayReadTrip(trip))) return lockedMetadata();
  const entry = getEntryBySlug(trip.ref, slug);
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
  const url = `/${user}/trips/${trip.id}/day/${entry.slug}`;

  return {
    title,
    description,
    // The day's own source, one URL along from the page — B879. The twin
    // exists for both of a day's paths (app/api/md/[user]/[...path]), and an
    // agent handed the HTML had no way to learn that until this link.
    alternates: { canonical: url, types: { "text/markdown": `${url}.md` } },
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

export default async function TripDayPage({
  params,
}: PageProps<"/[user]/trips/[trip]/day/[slug]">) {
  const { user, trip: id, slug } = await params;
  const site = siteSummary(user, getDefaultUsername() === user);
  if (!site) notFound();
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  if (trip.status === "current") redirect(`/${user}/day/${slug}`);

  // The layout draws the gate; this stops the page from *running*.
  // See lib/tripGate.ts — a layout gate leaks the page's data into the RSC
  // payload and the document head even when it renders something else.
  if (!(await mayReadTrip(trip))) return null;

  // The owner, or somebody on the trip, may open the permalink of a day
  // nobody has published yet; for everybody else a draft slug is simply not a
  // page. B327 — before it, a buddy could not reach a day they had written.
  const { read, canPublish, owner } = await readFor(trip);
  const entry = getEntryBySlug(trip.ref, slug, read);
  if (!entry) notFound();

  const { index, days, windowStart, initialDate, stats, basemap } = buildStoryProps(trip.ref, {
    openAt: entry.date,
    showCosts: await mayViewCosts(trip),
    ...read,
  });

  const userConfig = getUser(user);
  if (!userConfig) notFound();

  // Not `isOwner` inline: see the note beside the equivalent call in the
  // gallery page.
  const photobook = await photobookEntryFor(trip);

  return (
    <TripProvider trip={trip} isCurrent={false} canPublish={canPublish} reader={read.reader} owner={owner}>
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
        photobook={photobook}
      />
    </TripProvider>
  );
}
