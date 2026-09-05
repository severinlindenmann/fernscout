import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { countryCodeFor } from "./flags";
import { parseCostItems } from "./costFormat";
import { loadUserConfig } from "./config";
import { normalizeCurrency } from "./currency";
import { mediaWithOwner, parseTripRef, tripDir } from "./trips";
import { hasHappened } from "./tripTime";
import type { Day, Entry, EntryTranslations, GalleryItem, MediaTile, TravelSceneVariant } from "./types";
import { TRAVEL_SCENE_VARIANTS } from "./validate/entry";

/**
 * Forgets gray-matter's own parse cache — not this module's, gray-matter's.
 *
 * `matter()` memoizes a parse *by raw content*, globally, for the life of the
 * process, and it writes that cache entry before it parses rather than after
 * — so a call that throws leaves a half-built, non-throwing result sitting
 * under the failing text's key. The next caller to hand it the same bytes
 * (the same broken entry, read again after some other file in the trip
 * changed and forced a re-read) gets that stale result back instead of the
 * same failure repeating, which is exactly the silent success this guard
 * exists to prevent. Every catch around a `matter()` call in this file and in
 * lib/api/entries.ts clears it for that reason. B236.
 *
 * Not in gray-matter's own `.d.ts` — `clearCache` exists on the runtime
 * export but is absent from its published types — hence the cast.
 */
export function clearMatterCache(): void {
  (matter as unknown as { clearCache: () => void }).clearCache();
}

/**
 * Forgets one trip's parsed entries.
 *
 * The cache is keyed by directory and lives for the life of the process, which
 * is right for a site whose content only changes when somebody edits a file —
 * and wrong the moment the application itself writes one. It did: a day
 * deleted through the API left the disk but stayed in this map, so its
 * permalink went on answering 200 until the server restarted. An owner who
 * deleted something *because it should not be public* was told it was gone
 * while it was still being served.
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

/**
 * `2026-01-11-da-lat.md` → `da-lat`.
 *
 * The file name carries the date so a directory listing sorts chronologically;
 * the slug is what is left, and it is a day's address inside its trip. This is
 * the one place that rule is written down. It had been three — here, in
 * `publishDraft`, and in the collision check that did not exist yet — and a
 * rule about identity that disagrees with itself in one file is how a day ends
 * up reachable by one code path and not another.
 */
export function entrySlugFromFile(file: string): string {
  return file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/**
 * `2026-01-11-da-lat.md` → `2026-01-11`, and `about.md` → `null`.
 *
 * The other half of the same rule, and it lives here for the same reason: the
 * two are one convention read from opposite ends, and splitting them across
 * files is how they come to disagree. Null rather than a guess for a name that
 * carries no date — a caller deciding whether two entries collide needs to
 * know it does not know, not be handed a plausible date.
 *
 * The date in the *name* is deliberately what this reads, not the `date:` in
 * the frontmatter. The name is what decides which file a write lands in; the
 * frontmatter is what the page displays. Ingest joins an existing day by
 * building the filename, so the name is the question it is asking.
 */
export function entryDateFromFile(file: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})-/.exec(file)?.[1] ?? null;
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
 * `travelScene:` read back — the same fallback `visibility:` gets on a trip.
 * A value outside `TRAVEL_SCENE_VARIANTS` is not refused at write time (see
 * `checkTravelScene`), so this is the one place that has to cope with a typo:
 * it reads as `undefined`, which the page plays as the default, rather than
 * throwing or drawing a scene nothing asked for.
 */
function parseTravelSceneVariant(raw: unknown): TravelSceneVariant | undefined {
  return typeof raw === "string" && (TRAVEL_SCENE_VARIANTS as readonly string[]).includes(raw)
    ? (raw as TravelSceneVariant)
    : undefined;
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

    // One file that will not parse must not take the rest of the trip down
    // with it — the same failure `readTrip` in lib/trips.ts guards against
    // for a malformed `trip.md`. Skipped and logged rather than thrown, so
    // `getAllEntries` and everything built on it (the trip page, the feed,
    // the sitemap, the search index) keep serving every other day. B236.
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(raw);
    } catch (err) {
      // See `clearMatterCache` above for why this call is here too.
      clearMatterCache();
      // First line only: gray-matter quotes the offending source at length,
      // and a server log is not a terminal either.
      const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(`[entries] ${ref}/entries/${file}: its frontmatter could not be parsed: ${why}`);
      return [];
    }
    const { data, content } = parsed;

    const slug = entrySlugFromFile(file);
    const country = data.country ?? "";

    return [{
      slug,
      title: data.title ?? slug,
      date: String(data.date),
      time: data.time ? String(data.time) : undefined,
      location: data.location ?? "",
      country,
      countryCode: countryCodeFor(country, data.countryCode),
      // Missing stays missing rather than becoming `Number(undefined)` —
      // `NaN`, which is what B265 actually found reaching the page: not the
      // `undefined` a missing field ought to produce, but a number that
      // fails every `typeof` check meant to catch "not written", and that
      // serialises into the page's own hydration payload as the literal
      // text "NaN" no SVG-level guard can catch. `Entry.lat` stays typed
      // `number` regardless — this file has always been the one place that
      // type is a promise rather than a guarantee, and every reader of it
      // already has to cope with a coordinate that quietly isn't one.
      lat: (data.lat === undefined ? undefined : Number(data.lat)) as number,
      lng: (data.lng === undefined ? undefined : Number(data.lng)) as number,
      transport: data.transportMode
        ? {
            mode: data.transportMode,
            from: data.transportFrom ?? "",
            to: data.transportTo ?? "",
          }
        : undefined,
      travelScene: parseTravelSceneVariant(data.travelScene),
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
      // `true` and nothing else — see the note on `Entry.test`. A day that
      // records something that happened must not be able to acquire a banner
      // saying it did not because somebody wrote `test: no`.
      test: data.test === true || undefined,
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
 * An agent writes a day as a draft and publishes it in a second call once the
 * person has said so (ROADMAP G7, and decision 28 for why publishing is not a
 * file edit any more). This is the line between "an agent wrote something" and
 * "it is on the site". It
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
    // A day with no coordinates at all cannot be drawn, so it is not a place
    // — the day somebody spends on a train with nothing to report (B381).
    // Distinct from B339 below: that is a day that *has* coordinates and an
    // empty name. This is a day with nothing to plot, full stop.
    if (!Number.isFinite(lead.lat) || !Number.isFinite(lead.lng)) continue;
    const last = places.at(-1);
    // Merged only when the day actually names where it was. `location:` is
    // optional, so an unnamed day arrives as `""` — and `"" === ""` held, which
    // made every unnamed day "the same place as yesterday" and collapsed a
    // whole trip into one marker carrying the first day's coordinates. Fifteen
    // days from Bangkok to Hanoi drew a single dot on Bangkok (B339). An empty
    // location means *unknown*, not *unchanged*: it starts its own place.
    if (last && lead.location && last.location === lead.location && last.country === lead.country) {
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

/**
 * Every gallery item across the trip, newest first, projected to a
 * `MediaTile` — the entry's location, country and date, not the entry
 * itself. See the type's docblock (B87).
 */
export function getAllMedia(ref: string, options?: ReadOptions): MediaTile[] {
  return getAllEntries(ref, options)
    .flatMap((entry) =>
      entry.gallery.map((item) => ({
        src: item.src,
        slug: entry.slug,
        type: item.type,
        caption: item.caption,
        width: item.width,
        height: item.height,
        poster: item.poster,
        location: entry.location,
        country: entry.country,
        countryCode: entry.countryCode,
        date: entry.date,
      })),
    )
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
