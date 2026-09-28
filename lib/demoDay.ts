import "server-only";
import { isIndexable, isTestContent } from "./access";
import { getAllEntries } from "./entries";
import { publicJournals } from "./home";
import { stripMarkdown } from "./markdownText";
import { getTrips } from "./trips";
import type { Entry } from "./types";

import { journalPath } from "./journalPath";
/**
 * One real, published day for the signed-out landing's hero — B2506.
 *
 * The design puts a day card beside the headline. It is read from the public
 * journals, never typed into the page: the prose, the title, the place and
 * the photograph are the author's own, and when this instance has nothing
 * public the card is simply absent. The shipped demo journal (`example`) is
 * preferred because it is the one written to be shown to strangers; any other
 * listed journal stands in on an instance without it.
 *
 * A second photograph from another day of the same trip dresses the prints
 * block (a book cover and a postcard), so both drawings show that journal's
 * real pictures rather than a stock image.
 */
type DemoPhoto = { src: string; alt: string };

export type DemoDay = {
  journalHref: string;
  href: string;
  title: string;
  /** Long date in the page's language, formatted here so server and browser
   * cannot disagree about it during hydration. */
  date: string;
  location: string;
  tripTitle: string;
  excerpt: string;
  photo: DemoPhoto;
  /** The trip's cover, for the book drawing. */
  cover: DemoPhoto;
  /** Another day of the trip, for the postcard drawing, when there is one. */
  postcard?: DemoPhoto & { title: string };
};

/** A photograph every reader of a public trip may see. */
function openPhoto(entry: Entry): DemoPhoto | undefined {
  const item = entry.gallery.find((g) => g.type === "image" && !g.visibility);
  return item ? { src: item.src, alt: item.alt ?? item.caption ?? "" } : undefined;
}

/** The first paragraph, cut at a sentence end once it is long enough. */
export function excerptOf(content: string, max = 220): string {
  const first = stripMarkdown(content.split(/\n\s*\n/)[0] ?? "");
  if (first.length <= max) return first;
  const sentences = first.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    if (out && (out + sentence).length > max) break;
    out += sentence;
  }
  return (out || first.slice(0, max)).trim();
}

export function demoDay(locale: string): DemoDay | null {
  const journals = publicJournals();
  const journal = journals.find((j) => j.username === "example") ?? journals[0];
  if (!journal) return null;
  for (const trip of getTrips(journal.username).filter(isIndexable)) {
    const days = getAllEntries(trip.ref).filter(
      (e) => !e.draft && !e.visibility && !isTestContent(trip, e) && e.content.trim(),
    );
    const day = days.find(openPhoto);
    if (!day) continue;
    const photo = openPhoto(day)!;
    const other = days.find((e) => e !== day && openPhoto(e));
    return {
      journalHref: journalPath(journal.username),
      // The current trip's own day answers at the bare `/day/<slug>` address
      // (`app/at/[user]/trips/[trip]/day/[slug]/page.tsx` 307s a
      // `/trips/<id>/day/<slug>` tap there) — matched here for the same
      // reason `lib/viewer.ts`'s own `detailFor` does (B2550).
      href:
        trip.status === "current"
          ? `${journalPath(journal.username)}/day/${day.slug}`
          : `${journalPath(journal.username)}/trips/${trip.id}/day/${day.slug}`,
      title: day.title,
      date: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${day.date}T00:00:00Z`)),
      location: day.location,
      tripTitle: trip.title,
      excerpt: excerptOf(day.content),
      photo,
      cover: trip.cover ? { src: trip.cover, alt: "" } : photo,
      postcard: other ? { ...openPhoto(other)!, title: other.title } : undefined,
    };
  }
  return null;
}
