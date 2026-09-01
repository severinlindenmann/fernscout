import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { countryCodeFor } from "./flags";
import { parseCostItems } from "./costFormat";
import { loadUserConfig } from "./config";
import { normalizeCurrency } from "./currency";
import { mediaWithOwner, parseTripRef, tripDir } from "./trips";
import { hasHappened } from "./tripTime";
import type { Day, Entry, EntryTranslations, GalleryItem } from "./types";

/**
 * Forgets one trip's parsed entries.
 *
 * The cache is keyed by directory and lives for the life of the process, which
 * is right for a site whose content only changes when somebody edits a file —
 * and wrong the moment the application itself writes one. It did: a day
 * deleted through the API left the disk but stayed in this map, so its
 * permalink went on answering 200 and MCP went on returning its full text
 * until the server restarted. An owner who deleted something *because it
 * should not be public* was told it was gone while it was still being served.
 *
 * Every write path calls this. See lib/api/entries.ts.
 */
export function forgetEntries(ref: string): void {
  cache.delete(entriesDir(ref));
}

/** Keyed by the resolved entries directory (which already contains the
 * content root), so a test pointing CONTENT_DIR elsewhere never gets the
 * previous directory's entries back. */
const cache = new Map<string, { signature: string; entries: Entry[] }>();

function entriesDir(ref: string) {
  return path.join(tripDir(ref), "entries");
}

function parseTranslations(raw: unknown): EntryTranslations | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, { title?: string; content?: string } | undefined>;
  const out: EntryTranslations = {};
  // Every locale the file offers, not a fixed pair: a journal may be
  // written in a language this project ships no chrome for.
  for (const loc of Object.keys(src)) {
    const v = src[loc];
    if (v && (v.title || v.content)) {
      out[loc] = {
        title: v.title,
        content: typeof v.content === "string" ? v.content.trim() : undefined,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * How much of a trip a caller may see.
 *
 * `includeDrafts` is for the owner reading their own journal, and nothing
 * else: it is resolved from a session by the page, and every public path
 * leaves it alone. Threaded as an argument rather than kept as request state
 * because a module-level flag on a server that handles concurrent requests is
 * how one reader ends up seeing another's answer.
 */
export type ReadOptions = { includeDrafts?: boolean };

/** Drops drafts unless the caller has asked for them. */
function visible(entries: Entry[], options?: ReadOptions): Entry[] {
  return options?.includeDrafts ? entries : entries.filter((e) => !e.draft);
}

export function getAllEntries(ref: string, options?: ReadOptions): Entry[] {
  return visible(readAllEntries(ref), options);
}

/**
 * A cheap fingerprint of the entry files, for the same reason as
 * `tripsSignature` in lib/trips.ts.
 *
 * Publishing is a person deleting one line from one file, and the feed, the
 * sitemap and the search index are built from these entries — so a cache that
 * outlives the edit means the day a person just published does not appear
 * until somebody restarts the server. One `stat` per entry.
 */
function entriesSignature(dir: string, files: string[]): string {
  return files
    .map((file) => {
      try {
        const { mtimeMs, size } = fs.statSync(path.join(dir, file));
        return `${file}:${mtimeMs}:${size}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
}

/** Every entry on disk, drafts included. Cached; callers filter. */
function readAllEntries(ref: string): Entry[] {
  const dir = entriesDir(ref);

  if (!fs.existsSync(dir)) {
    cache.set(dir, { signature: "", entries: [] });
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const signature = entriesSignature(dir, files);
  const hit = cache.get(dir);
  if (hit && hit.signature === signature) return hit.entries;

  // A cost with no `currency:` was spent in the site's base currency. Every
  // entry written before multi-currency existed therefore reads unchanged.
  const owner = parseTripRef(ref)?.username;
  const configured = owner ? loadUserConfig(owner).baseCurrency : "CHF";
  const defaultCurrency = normalizeCurrency(configured, configured.toUpperCase());

  const entries = files.flatMap((file) => {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const { data, content } = matter(raw);

    const slug = file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
    const country = data.country ?? "";

    return [{
      slug,
      title: data.title ?? slug,
      date: String(data.date),
      time: data.time ? String(data.time) : undefined,
      location: data.location ?? "",
      country,
      countryCode: countryCodeFor(country, data.countryCode),
      lat: Number(data.lat),
      lng: Number(data.lng),
      transport: data.transportMode
        ? {
            mode: data.transportMode,
            from: data.transportFrom ?? "",
            to: data.transportTo ?? "",
          }
        : undefined,
      // Trip-relative like everything else under media/ — see mediaWithOwner
      // in lib/trips.ts for why frontmatter keeps it that way.
      cover: data.cover ? mediaWithOwner(data.cover, owner) : undefined,
      gallery: Array.isArray(data.gallery)
        ? (data.gallery as GalleryItem[]).map((item) => ({
            ...item,
            src: mediaWithOwner(item.src, owner),
            // A video's poster is trip-relative too, and used to be left that
            // way — the one media path in the file that never got the owner
            // prefixed onto it, so every ingested clip's still was a 404.
            poster: item.poster ? mediaWithOwner(item.poster, owner) : undefined,
          }))
        : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      costs: parseCostItems(data.costs, defaultCurrency),
      content: content.trim(),
      translations: parseTranslations(data.translations),
      // Kept rather than dropped: `getAllEntries` filters on the way out, so
      // one cache serves both the public site and the owner's own view.
      draft: isDraft(data) || undefined,
    } satisfies Entry];
  });

  // Date first, then time — so several updates within one day stay in order.
  entries.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });

  cache.set(dir, { signature, entries });
  return entries;
}

/**
 * Whether an entry is a draft.
 *
 * Agents write drafts and only a person publishes them (ROADMAP G7), so this
 * is the line between "an agent wrote something" and "it is on the site". It
 * is enforced in `getAllEntries`, which every reading path goes through, so a
 * new page cannot accidentally render one.
 */
export function isDraft(data: Record<string, unknown>): boolean {
  return String(data.status ?? "").toLowerCase() === "draft";
}

/** Entries grouped into calendar days. A day may hold several updates. */
export function getDays(ref: string, options?: ReadOptions): Day[] {
  const days: Day[] = [];
  for (const entry of getAllEntries(ref, options)) {
    const last = days.at(-1);
    if (last && last.date === entry.date) {
      last.entries.push(entry);
      continue;
    }
    days.push({ date: entry.date, entries: [entry], lead: entry });
  }
  return days;
}

export function getEntryBySlug(
  ref: string,
  slug: string,
  options?: ReadOptions,
): Entry | undefined {
  return getAllEntries(ref, options).find((e) => e.slug === slug);
}

/**
 * The day to land on when no specific day is requested: the most recent one
 * that isn't in the future.
 *
 * "In the future" is judged in the earliest calendar in use anywhere, not in
 * UTC. Entry dates are the author's local dates, so an author east of UTC —
 * which is most of Asia, i.e. most of this trip — publishes on a date UTC has
 * not reached yet, and a UTC comparison hid their newest day for up to seven
 * hours after they wrote it. See lib/tripTime.ts for why erring early is the
 * cheap direction here.
 */
export function getDefaultDay(ref: string, options?: ReadOptions): Day | undefined {
  const days = getDays(ref, options);
  if (days.length === 0) return undefined;
  const notFuture = days.filter((d) => hasHappened(d.date));
  return notFuture.at(-1) ?? days[0];
}

/** A place visited on the trip: consecutive days in the same location, with
 * all their media collected together. Used by the world map. */
export type Place = {
  key: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  entries: Entry[];
  firstDate: string;
  lastDate: string;
  nights: number;
  mediaCount: number;
};

export function getPlaces(ref: string, options?: ReadOptions): Place[] {
  const places: Place[] = [];

  for (const day of getDays(ref, options)) {
    const lead = day.lead;
    const last = places.at(-1);
    if (last && last.location === lead.location && last.country === lead.country) {
      last.entries.push(...day.entries);
      last.lastDate = day.date;
      last.mediaCount += day.entries.reduce((n, e) => n + e.gallery.length, 0);
      continue;
    }
    places.push({
      key: `${lead.location}-${day.date}`,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      lat: lead.lat,
      lng: lead.lng,
      entries: [...day.entries],
      firstDate: day.date,
      lastDate: day.date,
      nights: 0,
      mediaCount: day.entries.reduce((n, e) => n + e.gallery.length, 0),
    });
  }

  // Nights = days until the next place begins (or this place's own span).
  places.forEach((place, i) => {
    const next = places[i + 1];
    const endDate = next ? next.firstDate : place.lastDate;
    const ms =
      new Date(`${endDate}T00:00:00Z`).getTime() -
      new Date(`${place.firstDate}T00:00:00Z`).getTime();
    place.nights = Math.max(0, Math.round(ms / 86_400_000));
  });

  return places;
}

/** Every gallery item across the trip, newest first, with its entry attached. */
export function getAllMedia(ref: string, options?: ReadOptions) {
  return getAllEntries(ref, options)
    .flatMap((entry) => entry.gallery.map((item) => ({ item, entry })))
    .reverse();
}

/** Headline numbers for the hero and the map page. */
export function getTripStats(ref: string, options?: ReadOptions) {
  const entries = getAllEntries(ref, options);
  const days = getDays(ref, options);
  const places = getPlaces(ref, options);

  const tripDays =
    days.length > 1
      ? Math.round(
          (new Date(`${days.at(-1)!.date}T00:00:00Z`).getTime() -
            new Date(`${days[0].date}T00:00:00Z`).getTime()) /
            86_400_000,
        ) + 1
      : days.length;

  return {
    tripDays,
    dayCount: days.length,
    places: places.length,
    countries: new Set(places.map((p) => p.country)).size,
    totalMedia: entries.reduce((n, e) => n + e.gallery.length, 0),
    firstDate: days[0]?.date,
    lastDate: days.at(-1)?.date,
  };
}
