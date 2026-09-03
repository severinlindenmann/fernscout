import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { contentRoot } from "./contentRoot";
import { calendarStatus, earliestTodayISO, effectiveStatus } from "./tripTime";
import { getUsernames } from "./users";
import { parseRateTable, type RateTable } from "./currency";
import type { CostsVisibility, Trip, TripAccent, TripPerson, TripStatus, TripTranslations, TripVisibility } from "./types";

const ACCENTS: readonly TripAccent[] = ["sky", "yellow", "green", "coral", "navy"];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keyed by content root, so pointing CONTENT_DIR somewhere else in a test
 * doesn't hand back the previous directory's trips. */
const cache = new Map<string, { signature: string; trips: Trip[]; malformed: MalformedTrip[] }>();

/**
 * A trip folder whose `trip.md` is present but cannot be trusted — the id does
 * not match the folder, a date is not a date, the frontmatter will not parse.
 * `readTrip` drops these from `getTrips` (a typo in one must not take the rest
 * down), and until B83 the only trace was a `[trips]` line on the server's
 * stdout, which is not where the owner is. This carries the *why* to a surface
 * they can read.
 */
export type MalformedTripReason =
  | "no-file"
  | "unparseable"
  | "missing-id"
  | "id-mismatch"
  | "invalid-id"
  | "missing-fields";

export type MalformedTrip = {
  /** The folder under `content/<user>/trips/`. */
  folder: string;
  /**
   * Which way it failed, as a code the caller can translate.
   *
   * Two audiences read the same refusal and they do not want the same thing
   * from it. The owner is reading a web page in whatever language their
   * journal is written in; an operator tailing stdout and an agent reading the
   * API want English. A sentence built here can only serve one of them, and
   * the owner is the one who cannot change which — so the code travels and
   * `trips.malformed<Reason>` in the locale files is what they see.
   */
  reason: MalformedTripReason;
  /** The same thing in one English sentence, for the log and the API. */
  problem: string;
};

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

/**
 * The word the file declares, before the calendar has its say.
 *
 * Only `current` survives `effectiveStatus` unchanged, so this is really
 * asking one question — is this trip the one the bare `/<user>` URLs serve? —
 * and everything else, including a missing field and a typo, is "no". See
 * `readTrip` for where the other two words come from.
 */
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
 * than to public: a typo in "private" must not publish a private trip.
 */
/**
 * `visibility:`, and whether the trip is advertised.
 *
 * Two axes out of one field, because the two older words were answering
 * different questions. `password` said *how* somebody gets in, which is no
 * longer a question the software asks anybody — trip passwords are gone (B39)
 * — so it reads as `guest`: the people the owner has let into this journal.
 * **That is wider than the word promised**, since a password reached only
 * whoever was sent it; `instrumentation.ts` refuses to boot on a trip that
 * still carries the frontmatter line the password lived on, so the widening is
 * a decision somebody makes rather than one that happens to them. `unlisted`
 * said the trip is not advertised; that is `listed: false` on a public trip.
 *
 * An unrecognised value reads as the **most private** option — a typo must
 * never be the thing that publishes somebody's trip.
 */
function deriveVisibility(
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

/**
 * `listed:`, which may only ever **narrow** what `visibility:` already implied.
 *
 * The key was documented in three places and read in none: `visibility:` alone
 * decided both axes, so `visibility: public` plus `listed: false` was a trip in
 * the sitemap, and the only spelling that produced an unlisted public trip was
 * the legacy `unlisted` the same documentation calls an older word. Worse, the
 * write path *emits* the key — `createTrip` puts a `listed:` line in every
 * trip.md it writes and `POST /api/v1/<user>/trips` takes one in the body — so
 * an agent could ask for an unadvertised trip, be told 201, and read its own
 * file back saying `listed: false` while the crawler had it. B51.
 *
 * One direction only, and that is the whole of the design. `listed: false` is
 * honoured wherever it appears. `listed: true` is honoured only where the
 * visibility already advertises the trip, where it is a harmless restatement;
 * on a `private`, `guest` or `unlisted` trip it is refused and logged. Three
 * consumers key off this field — `isIndexable`, `listableTrips` and
 * `resolveViewer` — and each currently pairs it with `visibility === "public"`,
 * so a `listed: true` that survived on a closed trip would be inert *today* and
 * a leak the first time somebody read the field on its own. Making the parser
 * the choke point means the invariant in `Trip.listed` ("this only narrows") is
 * true of the value rather than of the four places that happen to consume it,
 * which is the same reason an unrecognised `visibility:` reads as private here
 * rather than being fixed up downstream.
 *
 * Refused, never silent: a key that is quietly dropped is the bug this closes.
 */
function parseListed(
  raw: unknown,
  visibility: unknown,
  derived: boolean,
  folder: string,
): boolean {
  if (raw === undefined || raw === null) return derived;

  // `true`/`false` and nothing else. YAML reads `listed: no` as the *string*
  // "no", which is truthy, so a loose check would advertise the trip its
  // author was trying to hide.
  if (typeof raw !== "boolean") {
    console.warn(
      `[trips] ${folder}/trip.md has listed "${raw}", which is not true or false — ` +
        `ignoring it and reading the trip as ${derived ? "advertised" : "not advertised"}.`,
    );
    return derived;
  }

  if (raw && !derived) {
    const word = visibility === undefined || visibility === null ? "public" : String(visibility);
    console.warn(
      `[trips] ${folder}/trip.md says listed: true, but visibility "${word}" does not ` +
        `advertise the trip — ignoring it. listed: can only narrow; write ` +
        `visibility: public to advertise a trip.`,
    );
    return false;
  }

  return raw;
}

function parseVisibility(
  rawVisibility: unknown,
  rawListed: unknown,
  folder: string,
): { visibility: TripVisibility; listed: boolean } {
  const derived = deriveVisibility(rawVisibility, folder);
  return {
    visibility: derived.visibility,
    listed: parseListed(rawListed, rawVisibility, derived.listed, folder),
  };
}

/**
 * The frontmatter keys `parseTrip` above consumes. Anything else in a trip.md
 * is reported on the trip as `unknownFields` — see the note on that field.
 *
 * A typo is the common case and is harmless here; a key the project has
 * *withdrawn* is not, and the boot check is what catches those.
 */
const KNOWN_TRIP_FIELDS = new Set([
  "id",
  "title",
  "tagline",
  "start",
  "end",
  "status",
  "cover",
  "accent",
  "rates",
  "translations",
  "people",
  "test",
  "visibility",
  "listed",
  "costsVisibility",
]);

function unknownFields(data: Record<string, unknown>): string[] | undefined {
  const extra = Object.keys(data).filter((k) => !KNOWN_TRIP_FIELDS.has(k));
  return extra.length > 0 ? extra : undefined;
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

/** Refuses one folder, warns the server log, and carries the reason back. */
function refuse(folder: string, reason: MalformedTripReason, problem: string): MalformedTrip {
  console.warn(`[trips] ${folder}/: ${problem}`);
  return { folder, reason, problem };
}

/**
 * One trip.md → a Trip, or a MalformedTrip saying why not.
 *
 * - `Trip` — it parsed and is trustworthy.
 * - `MalformedTrip` — the folder would silently vanish, and this is what to
 *   tell whoever put it there. Returned rather than thrown so a typo in one
 *   trip does not take every other trip down with it (matching lib/plan.ts),
 *   and returned rather than dropped so the reason reaches the owner and the
 *   agent that wrote the file, not just the server log (B83).
 *
 * A folder with **no `trip.md` at all** is one of those, not a null. It was
 * first read as "a folder that never claimed to be a trip is nothing to
 * report" — but nothing else lives directly under `trips/`, so the only way to
 * make one is to be halfway through creating a trip. That is exactly the agent
 * this task is about: it made the directory, its write of the file failed, and
 * every read afterwards is indistinguishable from never having tried.
 *
 * The `[trips]` warnings stay. The server log is still the right place for an
 * operator tailing stdout; it was only ever wrong as the *sole* place.
 */
function readTrip(username: string, dir: string, folder: string): Trip | MalformedTrip {
  const file = path.join(dir, "trip.md");
  if (!fs.existsSync(file)) {
    return refuse(folder, "no-file", "there is no trip.md in it");
  }

  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(fs.readFileSync(file, "utf8"));
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch (err) {
    // First line only: gray-matter quotes the offending source at length, and
    // a web page is not a terminal.
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return refuse(folder, "unparseable", `its frontmatter could not be parsed: ${why}`);
  }

  const id = String(data.id ?? "").trim();
  const title = String(data.title ?? "").trim();
  const start = String(data.start ?? "").trim();
  const end = String(data.end ?? "").trim();

  if (!id) {
    return refuse(folder, "missing-id", `it has no id (add \`id: ${folder}\`, matching the folder)`);
  }
  if (id !== folder) {
    return refuse(
      folder,
      "id-mismatch",
      `its id is "${id}", but the folder is named "${folder}" — the two must match`,
    );
  }
  if (!ID_RE.test(id)) {
    return refuse(
      folder,
      "invalid-id",
      `its id "${id}" is not valid — lowercase letters, numbers and dashes only`,
    );
  }
  if (!title || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    // Which of the three, not merely that one of them is wrong: an agent
    // fixing its own file should not have to resubmit to find the next fault.
    // Same reason lib/validate/entry.ts collects every problem rather than the
    // first.
    const missing = [
      title ? null : "title",
      DATE_RE.test(start) ? null : "start",
      DATE_RE.test(end) ? null : "end",
    ].filter((f): f is string => f !== null);
    return refuse(
      folder,
      "missing-fields",
      `it needs a title and ISO start and end dates (YYYY-MM-DD); ` +
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or malformed`,
    );
  }

  return {
    id,
    username,
    ref: tripRef(username, id),
    title,
    tagline: data.tagline ? String(data.tagline) : undefined,
    start,
    end,
    // Declared or derived, and which is which matters: `current` is the
    // author's choice and is honoured as written; `past` and `upcoming` are
    // facts about `start` and today, so they are read off the calendar rather
    // than off a field nobody has edited since the trip was created. B72.
    status: effectiveStatus({ start, status: parseStatus(data.status) }),
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
    ...parseVisibility(data.visibility, data.listed, folder),
    costsVisibility: parseCostsVisibility(data.costsVisibility, folder),
    unknownFields: unknownFields(data),
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

/**
 * The parsed trips of a journal, good and bad, computed once and cached
 * together. `getTrips` and `getMalformedTrips` are both views onto this, so a
 * malformed trip is discovered on the same parse that builds the good ones
 * rather than re-reading every file a second time to find it.
 */
function loadTrips(username: string): { trips: Trip[]; malformed: MalformedTrip[] } {
  const root = tripsDir(username);

  let folders: string[] = [];
  try {
    folders = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // No content/trips yet — an empty site, not an error.
    const empty = { signature: "", trips: [], malformed: [] };
    cache.set(root, empty);
    return empty;
  }

  // The date is part of the fingerprint because `status` is derived from it:
  // without this, a trip that starts at midnight would go on reading as
  // `upcoming` until somebody touched trip.md or restarted the server, which
  // is the same "a change that needs a restart" the file signature exists to
  // stop. One string comparison a call, and the cache turns over once a day.
  const signature = `${earliestTodayISO()}|${tripsSignature(root, folders)}`;
  const hit = cache.get(root);
  if (hit && hit.signature === signature) return { trips: hit.trips, malformed: hit.malformed };

  const parsed = folders.map((folder) => readTrip(username, path.join(root, folder), folder));
  const malformed = parsed.filter((t): t is MalformedTrip => "reason" in t);
  const trips = parsed.filter((t): t is Trip => !("reason" in t));

  // Exactly one trip may be current. If several declare it — easy to do when
  // you flip the new one before demoting the old — the one that started most
  // recently wins and the others read as past, rather than the site picking
  // arbitrarily.
  const claiming = trips.filter((t) => t.status === "current");
  if (claiming.length > 1) {
    const winner = claiming.reduce((a, b) => (b.start > a.start ? b : a));
    for (const t of claiming) if (t !== winner) t.status = calendarStatus(t);
  }

  const rank: Record<TripStatus, number> = { current: 0, upcoming: 1, past: 2 };
  trips.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    // Upcoming: soonest first. Past: most recent first.
    return a.status === "upcoming" ? a.start.localeCompare(b.start) : b.end.localeCompare(a.end);
  });

  // Named so a broken trip stays put whatever order the filesystem hands the
  // folders back in — the owner's notice should not reshuffle on every call.
  malformed.sort((a, b) => a.folder.localeCompare(b.folder));

  cache.set(root, { signature, trips, malformed });
  return { trips, malformed };
}

export function getTrips(username: string): Trip[] {
  return loadTrips(username).trips;
}

/**
 * The trips that are on disk but too broken to render, with the reason for each.
 *
 * Owner-facing: the caller is responsible for showing this only to somebody who
 * may see the journal's insides. A stranger is told nothing — to them a
 * malformed trip is simply not there, the same as it was before B83, because
 * the parse error of somebody's `trip.md` and the folder names in their journal
 * are not a visitor's business.
 */
export function getMalformedTrips(username: string): MalformedTrip[] {
  return loadTrips(username).malformed;
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
