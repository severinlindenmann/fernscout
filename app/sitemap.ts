import type { MetadataRoute } from "next";
import { getAllEntries, getDays } from "@/lib/entries";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { isIndexable } from "@/lib/access";
import { serverSite } from "@/lib/site";
import { listedUsernames } from "@/lib/users";
import { defaultLocaleFor, localesFor } from "@/lib/locales";

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

      for (const page of ["/gallery", "/map", "/costs"]) {
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
