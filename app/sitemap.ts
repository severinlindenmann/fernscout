import type { MetadataRoute } from "next";
import { getAllEntries, getDays } from "@/lib/entries";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { isIndexable } from "@/lib/access";
import { analyticsCardsFor } from "@/lib/analytics";
import { serverSite } from "@/lib/site";
import { listedUsernames } from "@/lib/users";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { DOCS_PAGES } from "@/lib/docs";

/**
 * Per request, for the same reason as feed.xml and search-index.json: a
 * prerendered sitemap keeps listing a trip somebody has just made private.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = serverSite().url;
  const out: MetadataRoute.Sitemap = [];

  /**
   * The same page in each language this journal offers.
   *
   * Language is a `?lang=` parameter rather than a path segment (see
   * middleware.ts), so hreflang is how a crawler learns that these are
   * translations of one another rather than duplicates. Emitted here because
   * the sitemap is the one place that already names every URL — putting it in
   * per-page metadata would mean touching every route for the same result.
   */
  const languages = (username: string, url: string) => {
    const offered = localesFor(username);
    if (offered.length < 2) return undefined;
    const fallback = defaultLocaleFor(username);
    const map: Record<string, string> = { "x-default": url };
    for (const code of offered) {
      map[code] = code === fallback ? url : `${url}?lang=${code}`;
    }
    return map;
  };

  /**
   * The instance's own pages, ahead of anybody's journey — B879.
   *
   * Everything below this is somebody's trip, and until this block existed
   * that was the whole sitemap: a crawler was offered eighty-four days and
   * nothing that says what the software is. The list is `DOCS_PAGES` rather
   * than a copy of it, because that constant is already what the hub and the
   * inner nav render, so a page added there is a page this gains for free.
   *
   * `/agent` is deliberately absent: it sets `robots: { index: false }` of its
   * own, since signed in it names the reader's journal. A sitemap entry for a
   * page that asks not to be indexed is a sitemap that argues with itself.
   */
  out.push({ url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 });
  out.push({ url: `${base}/docs`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 });
  for (const page of DOCS_PAGES) {
    out.push({
      url: `${base}${page.href}`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }

  // Per user, and only their public trips. Building this from getAllTrips()
  // would be one filter away from listing somebody else's private journal.
  // `listedUsernames()` drops the journals that asked not to be advertised at
  // all: a sitemap is a list handed to crawlers, which is what advertising is.
  for (const username of listedUsernames()) {
    const trips = getTrips(username).filter(isIndexable);
    if (trips.length === 0) continue;

    const currentId = getCurrentTrip(username)?.id;
    out.push({
      url: `${base}/${username}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
      alternates: { languages: languages(username, `${base}/${username}`) },
    });
    out.push({
      url: `${base}/${username}/trips`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    });

    for (const trip of trips) {
      const isCurrent = trip.id === currentId;
      const tripBase = isCurrent ? `${base}/${username}` : `${base}/${username}/trips/${trip.id}`;
      const days = getDays(trip.ref);
      const latest = days.at(-1)?.date;
      const lastModified = latest
        ? new Date(`${latest}T00:00:00Z`)
        : new Date(`${trip.end}T00:00:00Z`);

      if (!isCurrent) {
        out.push({ url: tripBase, lastModified, changeFrequency: "yearly", priority: 0.6 });
      }
      // A trip that has not begun has no gallery, map, costs or days worth
      // offering a crawler. `upcoming` is derived from `start` (B72), so this
      // cannot hide a trip that is under way.
      if (trip.status === "upcoming") continue;

      /**
       * A journal with spending switched off has no costs page, so nothing
       * offers a crawler one. B165 — absent, not a 404 in the sitemap. Nor
       * does a trip that never got its own `costs.md` (B267): the capability
       * being on says nothing about this one trip. B557 added the weather
       * page and the hub above them, each on the same terms — the pages the
       * crawler is offered are exactly the pages that answer 200.
       *
       * Drafts are not asked for anywhere here: a sitemap is served to
       * everyone, and a day only the owner can see must not put a URL in it.
       */
      const cards = analyticsCardsFor(username, trip.ref);
      const pages = ["/gallery", "/map"];
      if (cards.costs || cards.weather) pages.push("/analytics");
      if (cards.costs) pages.push("/costs");
      if (cards.weather) pages.push("/weather");
      for (const page of pages) {
        out.push({
          url: `${tripBase}${page}`,
          lastModified,
          changeFrequency: isCurrent ? "weekly" : "yearly",
          priority: isCurrent ? 0.7 : 0.5,
        });
      }
      for (const entry of getAllEntries(trip.ref)) {
        // A test day inside a real trip is not offered to a crawler. A whole
        // test trip never reached here — `isIndexable` above.
        if (entry.test) continue;
        const url = `${tripBase}/day/${entry.slug}`;
        out.push({
          url,
          lastModified: new Date(`${entry.date}T00:00:00Z`),
          changeFrequency: "monthly",
          priority: isCurrent ? 0.8 : 0.5,
          alternates: { languages: languages(username, url) },
        });
      }
    }
  }

  return out;
}
