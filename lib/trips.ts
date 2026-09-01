import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { contentRoot } from "./contentRoot";
import { getUsernames } from "./users";
import { parseRateTable, type RateTable } from "./currency";
import type { CostsVisibility, Trip, TripAccent, TripPerson, TripStatus, TripTranslations, TripVisibility } from "./types";

const ACCENTS: readonly TripAccent[] = ["sky", "yellow", "green", "coral", "navy"];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keyed by content root, so pointing CONTENT_DIR somewhere else in a test
 * doesn't hand back the previous directory's trips. */
const cache = new Map<string, { signature: string; trips: Trip[] }>();

/**
 * A trip's fully-qualified key: `<username>/<tripId>`.
 *
 * Trip ids are unique within a user, not across the instance, so everything
 * that addresses content keys on the pair. Carrying it as one string keeps the
 * twenty-odd content functions to a single parameter, and — more usefully —
 * makes it impossible to hold a trip id without also holding whose it is.
 */
export type TripRef = string;

export function tripRef(username: string, tripId: string): TripRef {
  return `${username}/${tripId}`;
}

/** Splits a ref, or null if it is not one. Never throws: refs arrive from URLs. */
export function parseTripRef(ref: TripRef): { username: string; tripId: string } | null {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  const username = ref.slice(0, slash);
  const tripId = ref.slice(slash + 1);
  if (tripId.includes("/") || !ID_RE.test(tripId) || !ID_RE.test(username)) return null;
  return { username, tripId };
}

export function tripsDir(username: string): string {
  return path.join(contentRoot(), username, "trips");
}

/** The folder holding one trip's content, or null for an unusable ref. */
export function tripDir(ref: TripRef): string {
  const parsed = parseTripRef(ref);
  if (!parsed) {
    // Callers treat a missing directory as "no such trip", which is the right
    // answer for a malformed ref too.
    return path.join(contentRoot(), "\u0000nonexistent");
  }
  return path.join(tripsDir(parsed.username), parsed.tripId);
}

/**
 * A trip-relative media path with the journal's owner on the front.
 *
 * Frontmatter keeps media at "/media/<trip>/…" so that a trip folder is
 * self-contained and can be copied to another journal unchanged — which is
 * exactly what `npm run seed:example` does. The username is known from the ref
 * and added here instead. Anything already absolute is left alone.
 *
 * Lives here rather than in lib/entries.ts because trip.md needs it too: a
 * `cover:` written trip-relative was handed to the browser unprefixed, so the
 * demo journal's own cover 404'd the moment anybody seeded it under a
 * different name.
 */
export function mediaWithOwner(src: unknown, owner: string | undefined): string {
  if (typeof src !== "string") return "";
  return owner && src.startsWith("/media/") ? `/${owner}${src}` : src;
}

/**
 * How many people a trip may name.
 *
 * Ten is the stated ceiling and it is enforced rather than assumed: a trip
 * with fifty "people" on it is a mailing list, and everyone on this list can
 * write to the whole journal. The floor is zero — a solo trip names nobody and
 * the owner is implicit.
 */
export const MAX_TRIP_PEOPLE = 10;

/** Deliberately loose. The address has to survive a round trip through a mail
 * server, not satisfy RFC 5322; anything stricter rejects real addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The `people:` block — who took this trip.
 *
 * Fails **closed**: any malformed entry drops the whole list rather than a
 * single line, because a half-parsed list of people is a half-parsed list of
 * who may write to the journal. An empty result means "just the owner", which
 * is the behaviour every trip had before this existed.
 */
function parsePeople(raw: unknown, folder: string): TripPerson[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    console.warn(`[trips] ${folder}/trip.md has a people: block that is not a list — ignoring it.`);
    return [];
  }
  if (raw.length > MAX_TRIP_PEOPLE) {
    console.warn(
      `[trips] ${folder}/trip.md names ${raw.length} people; the most a trip may have is ` +
        `${MAX_TRIP_PEOPLE} — ignoring the whole list.`,
    );
    return [];
  }

  const people: TripPerson[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      console.warn(`[trips] ${folder}/trip.md has a people: entry that is not a mapping.`);
      return [];
    }
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? "").trim();
    const email = String(entry.email ?? "").trim().toLowerCase();
    if (!name || !EMAIL_RE.test(email)) {
      console.warn(
        `[trips] ${folder}/trip.md has a people: entry needing a name and a valid email ` +
          `(got name "${name}", email "${email}") — ignoring the whole list.`,
      );
      return [];
    }
    if (seen.has(email)) {
      console.warn(`[trips] ${folder}/trip.md lists ${email} twice — ignoring the whole list.`);
      return [];
    }
    seen.add(email);
    const rawNickname = entry.nickname;
    if (rawNickname !== undefined && typeof rawNickname !== "string") {
      console.warn(
        `[trips] ${folder}/trip.md has a people: entry whose nickname is not text — ` +
          `ignoring the whole list.`,
      );
      return [];
    }
    const nickname = rawNickname?.trim() || undefined;
    people.push({ name, email, ...(nickname ? { nickname } : {}) });
  }
  return people;
}

function parseStatus(raw: unknown): TripStatus {
  const v = String(raw ?? "past").toLowerCase();
  return v === "current" || v === "upcoming" ? v : "past";
}

function parseAccent(raw: unknown): TripAccent {
  const v = String(raw ?? "").toLowerCase() as TripAccent;
  return ACCENTS.includes(v) ? v : "sky";
}

/**
 * Visibility, defaulting to public.
 *
 * An unrecognised value falls back to the *most* restrictive reading rather
 * than to public: a typo in "password" must not publish a private trip.
 */
/**
 * `visibility:`, and whether the trip is advertised.
 *
 * Two axes out of one field, because the two older words were answering
 * different questions. `password` said *how* somebody gets in; it is a `guest`
 * trip now, and the password is still how a guest proves it. `unlisted` said
 * the trip is not advertised; that is `listed: false` on a public trip.
 *
 * An unrecognised value reads as the **most private** option. It used to read
 * as `password`, which was already the right instinct; `private` is stricter
 * and a typo must never be the thing that publishes somebody's trip.
 */
function parseVisibility(
  raw: unknown,
  folder: string,
): { visibility: TripVisibility; listed: boolean } {
  if (raw === undefined || raw === null) return { visibility: "public", listed: true };

  switch (String(raw).toLowerCase()) {
    case "public":
      return { visibility: "public", listed: true };
    case "private":
      return { visibility: "private", listed: false };
    case "guest":
      return { visibility: "guest", listed: false };
    // The two older words, still accepted so nobody's trip.md breaks.
    case "unlisted":
      return { visibility: "public", listed: false };
    case "password":
      return { visibility: "guest", listed: false };
    default:
      console.warn(
        `[trips] ${folder}/trip.md has visibility "${raw}", which is not one of ` +
          `private/public/guest — treating it as private.`,
      );
      return { visibility: "private", listed: false };
  }
}

function parseCostsVisibility(raw: unknown, folder: string): CostsVisibility {
  if (raw === undefined || raw === null) return "public";
  const v = String(raw).toLowerCase();
  if (v === "public" || v === "guests") return v;
  console.warn(
    `[trips] ${folder}/trip.md has costsVisibility "${raw}" — treating it as guests-only.`,
  );
  return "guests";
}

/**
 * The `rates:` block — this trip's frozen local→base rates.
 *
 * ```yaml
 * rates:
 *   THB: 0.0245   # 1 THB = 0.0245 CHF, as it was on this trip
 *   VND: 0.000034
 * ```
 *
 * Kept in `trip.md` rather than a sibling `rates.json` so that a trip stays
 * one metadata file: the "clone it and edit markdown" story gets worse with
 * every extra file a trip needs, and rates are trip metadata in exactly the
 * way `start` and `accent` are. A bad entry is dropped and logged rather than
 * throwing, matching how every other field here behaves — the amounts it
 * would have converted then show up as explicitly unconverted (lib/costs.ts)
 * instead of being counted at face value.
 */
function parseRates(raw: unknown, folder: string): RateTable {
  return parseRateTable(raw, (message) =>
    console.warn(`[trips] ${folder}/trip.md rates: ${message}`),
  );
}

function parseTranslations(raw: unknown): TripTranslations | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, { title?: string; tagline?: string } | undefined>;
  const out: TripTranslations = {};
  // Every locale the file offers, not a fixed pair: a journal may be
  // written in a language this project ships no chrome for.
  for (const loc of Object.keys(src)) {
    const v = src[loc];
    if (v && (v.title || v.tagline)) out[loc] = { title: v.title, tagline: v.tagline };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * One trip.md → a Trip, or null if it can't be trusted.
 *
 * Returning null rather than throwing is deliberate and matches lib/plan.ts:
 * a typo in one trip's frontmatter must not take every other trip down with
 * it. The reason is logged so it isn't silent.
 */
function readTrip(username: string, dir: string, folder: string): Trip | null {
  const file = path.join(dir, "trip.md");
  if (!fs.existsSync(file)) return null;

  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(fs.readFileSync(file, "utf8"));
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch (err) {
    console.warn(`[trips] ${folder}/trip.md is unparseable, skipping:`, err);
    return null;
  }

  const id = String(data.id ?? "").trim();
  const title = String(data.title ?? "").trim();
  const start = String(data.start ?? "").trim();
  const end = String(data.end ?? "").trim();

  if (id !== folder) {
    console.warn(`[trips] ${folder}/trip.md has id "${id}", expected "${folder}" — skipping.`);
    return null;
  }
  if (!ID_RE.test(id)) {
    console.warn(`[trips] "${id}" is not a valid trip id (a-z, 0-9, dashes) — skipping.`);
    return null;
  }
  if (!title || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    console.warn(`[trips] ${folder}/trip.md needs a title and ISO start/end dates — skipping.`);
    return null;
  }

  return {
    id,
    username,
    ref: tripRef(username, id),
    title,
    tagline: data.tagline ? String(data.tagline) : undefined,
    start,
    end,
    status: parseStatus(data.status),
    cover: data.cover ? mediaWithOwner(String(data.cover), username) : undefined,
    accent: parseAccent(data.accent),
    rates: parseRates(data.rates, folder),
    intro: content.trim(),
    translations: parseTranslations(data.translations),
    people: parsePeople(data.people, folder),
    // `true` and nothing else. Absent is the overwhelming case, and a flag
    // that quietly accepted "no" or "false" as truthy would put a banner on
    // somebody's actual holiday.
    test: data.test === true || undefined,
    ...parseVisibility(data.visibility, folder),
    costsVisibility: parseCostsVisibility(data.costsVisibility, folder),
    passwordHash: data.passwordHash ? String(data.passwordHash) : undefined,
  };
}

/**
 * Every trip, ordered the way they're listed everywhere: the one under way
 * first, then what's coming up soonest, then the past most-recent-first.
 */
/**
 * A cheap fingerprint of what the trip files currently say.
 *
 * The cache exists because `getTrips` is called several times per request and
 * parsing frontmatter is not free. But it made `visibility` a setting that did
 * not take effect: a person set `private`, saw the page lock, and the feed went
 * on publishing that trip's days until somebody restarted the server. A
 * privacy control that needs a restart is not a privacy control.
 *
 * One `stat` per trip — a handful of syscalls, against re-parsing every file on
 * every call. Names are included so a trip appearing or disappearing counts as
 * a change too.
 */
function tripsSignature(root: string, folders: string[]): string {
  return folders
    .map((folder) => {
      try {
        const { mtimeMs, size } = fs.statSync(path.join(root, folder, "trip.md"));
        return `${folder}:${mtimeMs}:${size}`;
      } catch {
        return `${folder}:-`;
      }
    })
    .join("|");
}

export function getTrips(username: string): Trip[] {
  const root = tripsDir(username);

  let folders: string[] = [];
  try {
    folders = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // No content/trips yet — an empty site, not an error.
    cache.set(root, { signature: "", trips: [] });
    return [];
  }

  const signature = tripsSignature(root, folders);
  const hit = cache.get(root);
  if (hit && hit.signature === signature) return hit.trips;

  const trips = folders
    .map((folder) => readTrip(username, path.join(root, folder), folder))
    .filter((t): t is Trip => t !== null);

  // Exactly one trip may be current. If several declare it — easy to do when
  // you flip the new one before demoting the old — the one that started most
  // recently wins and the others read as past, rather than the site picking
  // arbitrarily.
  const claiming = trips.filter((t) => t.status === "current");
  if (claiming.length > 1) {
    const winner = claiming.reduce((a, b) => (b.start > a.start ? b : a));
    for (const t of claiming) if (t !== winner) t.status = "past";
  }

  const rank: Record<TripStatus, number> = { current: 0, upcoming: 1, past: 2 };
  trips.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    // Upcoming: soonest first. Past: most recent first.
    return a.status === "upcoming" ? a.start.localeCompare(b.start) : b.end.localeCompare(a.end);
  });

  cache.set(root, { signature, trips });
  return trips;
}

export function getTripIds(username: string): string[] {
  return getTrips(username).map((t) => t.id);
}

/** One trip, by fully-qualified ref. */
export function getTrip(ref: TripRef): Trip | undefined {
  const parsed = parseTripRef(ref);
  if (!parsed) return undefined;
  return getTrips(parsed.username).find((t) => t.id === parsed.tripId);
}

/**
 * Every trip on the instance, across all users.
 *
 * Only for surfaces that are genuinely instance-wide — the sitemap, the landing
 * page. Anything showing one person's site wants `getTrips(username)`, so that
 * a bug there cannot leak somebody else's trip into somebody else's page.
 */
export function getAllTrips(): Trip[] {
  return getUsernames().flatMap((username) => getTrips(username));
}

/**
 * The trip the bare URLs (`/`, `/map`, …) show.
 *
 * Normally the one declaring `status: current`. When none does — the trip
 * ended and nobody has started the next — the most recently finished trip
 * stands in, so `/` is never blank.
 */
export function getCurrentTrip(username: string): Trip | undefined {
  const trips = getTrips(username);
  return trips.find((t) => t.status === "current") ?? trips.find((t) => t.status === "past");
}

/** Throws when there is no content at all — callers are page components that
 * cannot render anything useful without a trip, and a clear message beats a
 * cascade of undefined. */
export function currentTripRef(username: string): TripRef | undefined {
  return getCurrentTrip(username)?.ref;
}
