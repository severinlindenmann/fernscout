import "server-only";
import { isIndexable } from "./access";
import { getAllEntries } from "./entries";
import { stripMarkdown } from "./markdownText";
import { serverSite } from "./site";
import { getCurrentTrip, getTrips } from "./trips";
import { getUser } from "./users";
import type { Entry, Trip } from "./types";

/**
 * RSS for one user's public journal.
 *
 * The highest-risk surface in this package: a feed is the easiest place to
 * leak content the HTML pages correctly hide, because it is built by walking
 * every trip rather than rendering the one page a visitor asked for. The
 * discipline is the same as `app/sitemap.ts` — filter with `isIndexable`,
 * which is exactly `trip.visibility === "public"` (see lib/access.ts) — so
 * this file and the sitemap cannot silently drift apart on what "public"
 * means. `unlisted` is deliberately excluded too: it promises "reachable by
 * a link I chose to share," not "syndicated to whatever aggregates feeds."
 */

const MAX_ITEMS = 60;
const SNIPPET_LENGTH = 400;

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** CDATA cannot contain the literal sequence "]]>" — split it across two
 * sections rather than reject or mangle a rare entry that happens to use it. */
function safeCdata(content: string): string {
  return content.replace(/]]>/g, "]]]]><![CDATA[>");
}

function snippetOf(entry: Entry): string {
  const text = stripMarkdown(entry.content);
  if (text.length <= SNIPPET_LENGTH) return text;
  return `${text.slice(0, SNIPPET_LENGTH).trimEnd()}…`;
}

/** RFC 822, as RSS `pubDate` requires. */
function rfc822(date: string, time?: string): string {
  const iso = time ? `${date}T${time}:00Z` : `${date}T00:00:00Z`;
  return new Date(iso).toUTCString();
}

type FeedItem = { entry: Entry; trip: Trip; url: string };

/** Every syndicatable item for one user, newest first, capped so a long-running
 * journal doesn't ship its entire history in one response. */
function feedItems(username: string, trips: Trip[]): FeedItem[] {
  const base = serverSite().url;
  const currentId = getCurrentTrip(username)?.id;

  const items: FeedItem[] = [];
  for (const trip of trips) {
    if (!isIndexable(trip)) continue; // the one line that matters
    // "Nothing written yet" — and since B72 that is what the word means:
    // `upcoming` is derived from `start` (lib/tripTime.ts), so a trip that has
    // begun cannot carry it and cannot be skipped here on the strength of it.
    if (trip.status === "upcoming") continue;

    const isCurrent = trip.id === currentId;
    const tripBase = isCurrent ? `${base}/${username}` : `${base}/${username}/trips/${trip.id}`;

    for (const entry of getAllEntries(trip.ref)) {
      // A day marked `test` inside a real trip. `isIndexable` above already
      // dropped a whole test trip; this is the other half — a fabricated day
      // in somebody's feed reader is indistinguishable from a real one.
      if (entry.test) continue;
      items.push({ entry, trip, url: `${tripBase}/day/${entry.slug}` });
    }
  }

  items.sort((a, b) => {
    const byDate = b.entry.date.localeCompare(a.entry.date);
    if (byDate !== 0) return byDate;
    return (b.entry.time ?? "").localeCompare(a.entry.time ?? "");
  });

  return items.slice(0, MAX_ITEMS);
}

/**
 * RSS 2.0 XML for one user's public journal, or null when there is no such
 * user. Callers turn null into a 404.
 */
export function buildFeedXml(username: string): string | null {
  const user = getUser(username);
  if (!user) return null;

  const items = feedItems(username, getTrips(username));
  const base = serverSite().url;
  const siteUrl = `${base}/${username}`;
  const feedUrl = `${siteUrl}/feed.xml`;
  const now = new Date().toUTCString();

  const itemsXml = items
    .map(({ entry, trip, url }) => {
      const title = `${entry.title} — ${entry.location}`;
      const categoriesXml = [trip.title, ...entry.tags]
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");
      return [
        "    <item>",
        `      <title>${escapeXml(title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${rfc822(entry.date, entry.time)}</pubDate>`,
        `      <description>${escapeXml(snippetOf(entry))}</description>`,
        `      <content:encoded><![CDATA[${safeCdata(entry.content)}]]></content:encoded>`,
        categoriesXml,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(user.title)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeXml(user.tagline)}</description>`,
    `    <language>${escapeXml(user.defaultLocale)}</language>`,
    `    <lastBuildDate>${now}</lastBuildDate>`,
    "    <generator>Fernscout</generator>",
    itemsXml,
    "  </channel>",
    "</rss>",
  ]
    .filter(Boolean)
    .join("\n");
}
