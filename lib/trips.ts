import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { calendarStatus, earliestTodayISO } from "./tripTime";
import { getUsernames } from "./users";
import { loadUserConfig } from "./config";
import { crossRate, normalizeCurrency, type RateTable } from "./currency";
import { loadEcbRates } from "./rates";
import { parseTracks } from "./tracks";
import { tripFromJson, type TripFile } from "./api/v2/documents";
import type { FigureDoc } from "./api/v2/schemas/figures";
import { parseFigure } from "./travellers/parse";
import type { Figure } from "./travellers/vocabulary";
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
  | "old-format"
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

function tripsDir(username: string): string {
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

/**
 * Deliberately loose. The address has to survive a round trip through a mail
 * server, not satisfy RFC 5322; anything stricter rejects real addresses.
 *
 * `isEmail`, re-exported from `lib/auth` — B247. This used to be its own
 * regex, one segment looser than the one `isEmail` and `lib/config.ts` used,
 * so an address that was a usable `people:` entry could be refused the token
 * that entry is supposed to unlock. Kept exported because `createTrip` and
 * `lib/tripWrite.ts` refuse a `people:` entry the reader would drop, and have
 * to use the reader's own idea of an address to do that honestly — the shape
 * B204 cost us one file over, where two copies of the same quoting helper
 * were both wrong in the same way.
 */
export { isEmail as isPersonEmail } from "./auth";
import { isEmail } from "./auth";

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
    console.warn(`[trips] ${folder}/trip.json has a people: block that is not a list — ignoring it.`);
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
      console.warn(`[trips] ${folder}/trip.json has a people: entry that is not a mapping.`);
      return [];
    }
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? "").trim();
    const email = String(entry.email ?? "").trim().toLowerCase();
    if (!name || !isEmail(email)) {
      console.warn(
        `[trips] ${folder}/trip.json has a people: entry needing a name and a valid email ` +
          `(got name "${name}", email "${email}") — ignoring the whole list.`,
      );
      return [];
    }
    if (seen.has(email)) {
      console.warn(`[trips] ${folder}/trip.json lists ${email} twice — ignoring the whole list.`);
      return [];
    }
    seen.add(email);
    const rawNickname = entry.nickname;
    if (rawNickname !== undefined && typeof rawNickname !== "string") {
      console.warn(
        `[trips] ${folder}/trip.json has a people: entry whose nickname is not text — ` +
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
 * A trip's status, purely from its own dates — v2 retired the manual
 * `status: current` override (`docs/v2-migration/00-decisions.md`, decision
 * "status/tracks retired"): `trip.json` carries no status at all any more,
 * so there is no declared word for the calendar to defer to. `current` is
 * therefore a calendar fact now, not an editorial one — today falling
 * within `[start, end]` — where it used to be the one thing an author chose
 * outright. `loadTrips` below still resolves two trips that both land on
 * `current` down to one, the same way it always did.
 */
function deriveStatus(start: string, end: string, now: Date = new Date()): TripStatus {
  const today = earliestTodayISO(now);
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "current";
}

/**
 * The colour the owner chose, or `undefined` for "no preference" — which is
 * a different answer from any colour and has to stay that way (B346).
 *
 * It used to fall back to `"sky"`, and `lib/tripWrite.ts` wrote `accent: sky`
 * into every scaffolded trip, so a trip nobody had coloured and a trip
 * deliberately set to sky were identical on disk. Nothing could then assign
 * distinct colours without overriding real choices, and every journal whose
 * trips came from the API was uniformly blue — which only became visible when
 * B344 removed the route lines and left colour as the sole thing telling one
 * trip's pins from another's.
 *
 * An unrecognised value reads as no-preference rather than throwing: a typo in
 * a colour is not worth a broken page, and the caller picks a colour anyway.
 */
function parseAccent(raw: unknown): TripAccent | undefined {
  const v = String(raw ?? "").toLowerCase() as TripAccent;
  return ACCENTS.includes(v) ? v : undefined;
}

/**
 * One colour per trip, keyed by ref: the owner's where they chose one, and an
 * assigned one everywhere else.
 *
 * Resolved for the whole journal at once rather than per trip, because the
 * answer depends on the others — a colour somebody deliberately picked is not
 * handed out again while it is claimed. Callers must use this for *every*
 * surface on a page, not just the one they are drawing: the trips index shows
 * the same trip as a map pin, a legend swatch and a card dot, and three
 * independent fallbacks are three chances for them to disagree about what
 * colour a trip is.
 *
 * The palette is five, so a journal with more than five uncoloured trips
 * repeats rather than inventing a colour. Deliberate: the accents are the
 * brand's, and a sixth mixed at runtime would not be.
 */
export function accentsFor(trips: readonly Trip[]): Map<string, TripAccent> {
  const claimed = new Set(trips.map((t) => t.accent).filter(Boolean));
  // Everything nobody claimed, in palette order — and the whole palette when
  // every colour is spoken for, so there is always something to hand out.
  const unclaimed = ACCENTS.filter((a) => !claimed.has(a));
  const pool = unclaimed.length > 0 ? unclaimed : ACCENTS;

  let next = 0;
  const out = new Map<string, TripAccent>();
  for (const trip of trips) {
    out.set(trip.ref, trip.accent ?? pool[next++ % pool.length]);
  }
  return out;
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
        `[trips] ${folder}/trip.json has visibility "${raw}", which is not one of ` +
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
      `[trips] ${folder}/trip.json has listed "${raw}", which is not true or false — ` +
        `ignoring it and reading the trip as ${derived ? "advertised" : "not advertised"}.`,
    );
    return derived;
  }

  if (raw && !derived) {
    const word = visibility === undefined || visibility === null ? "public" : String(visibility);
    console.warn(
      `[trips] ${folder}/trip.json says listed: true, but visibility "${word}" does not ` +
        `advertise the trip — ignoring it. listed: can only narrow; write ` +
        `visibility: public to advertise a trip.`,
    );
    return false;
  }

  return raw;
}

/**
 * `teaser:` — a closed trip saying that it exists. B587.
 *
 * Refused on a public trip rather than ignored, and for the same reason
 * `parseListed` refuses the widening direction: a key that is quietly dropped
 * is a key its author believes is working. On a public trip there is nothing
 * to tease — `listed: true` already advertises the whole trip, and `listed:
 * false` is a deliberate "reachable by link, never advertised", which a teaser
 * card would contradict.
 */
function parseTeaser(raw: unknown, visibility: TripVisibility, folder: string): boolean {
  if (raw === undefined || raw === null) return false;

  if (typeof raw !== "boolean") {
    console.warn(
      `[trips] ${folder}/trip.json has teaser "${raw}", which is not true or false — ignoring it.`,
    );
    return false;
  }

  if (raw && visibility === "public") {
    console.warn(
      `[trips] ${folder}/trip.json says teaser: true, but the trip is public — there is ` +
        `nothing to tease. teaser: advertises a guest or private trip as a locked card; ` +
        `use listed: to decide whether a public trip is advertised.`,
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
 * The top-level keys `readTrip` below consumes. Anything else in a
 * `trip.json` is reported on the trip as `unknownFields` — see the note on
 * that field.
 *
 * A typo is the common case and is harmless here; a key the project has
 * *withdrawn* is not, and the boot check is what catches those.
 *
 * v2's own vocabulary (`lib/api/v2/schemas/trip.ts`'s `tripBase`), not v1's
 * — `start`/`end` are `dates`, `costsVisibility` is inside `costs`,
 * `travellers` is `figures`, and `tracks`/`reminder`/`reminderChannel` have
 * no v2 home at all (retired outright — see `deriveStatus` above for
 * `status`, dropped the same way).
 */
/**
 * The top-level keys `readTrip` below consumes. Anything else in a
 * `trip.json` is reported on the trip as `unknownFields` — see the note on
 * that field.
 *
 * Deriving this from `tripDoc` (schemas/trip.ts) rather than hand-listing it
 * was tried and reverted: `schemas/trip.ts` already imports
 * `MAX_TRIP_PEOPLE` from this file, so importing the schema back here makes
 * a cycle, and whichever side of it evaluates first sees the other's
 * constants as `undefined` mid-construction — a broken `tripCreate` that
 * `PUT`/`PATCH` crash on for every request, not just one carrying an
 * unrecognised field. `test/journals.test.ts`'s "every field the reader
 * knows" is the guard instead: it fails whenever this set and `createTrip`'s
 * own fields (lib/tripWrite.ts) drift apart, which is the drift B1642 found.
 *
 * v2's own vocabulary (`lib/api/v2/schemas/trip.ts`'s `tripBase`), not v1's
 * — `start`/`end` are `dates`, `costsVisibility` is inside `costs`,
 * `travellers` is `figures`, and `tracks`/`status` have no v2 home at all
 * (retired outright — see `deriveStatus` above for `status`, dropped the
 * same way). `reminder` (D18/D46) is the field this set was missing until
 * B1642: a real v2 field with no `createTrip` input, so a trip carrying it
 * read as though it had a field this reader had never heard of.
 */
export const KNOWN_TRIP_FIELDS = new Set([
  "id",
  "title",
  "tagline",
  "dates",
  "visibility",
  "listed",
  "teaser",
  "reminder",
  "people",
  "rates",
  "costs",
  "plan",
  "translations",
  "accent",
  "cover",
  "figures",
  "intro",
  "test",
  "declined",
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
    `[trips] ${folder}/trip.json has costs.visibility "${raw}" — treating it as guests-only.`,
  );
  return "guests";
}

/**
 * This trip's frozen local→base rates, resolved from `rates:` — B1606/V2.
 *
 * The wire no longer states the rate itself for every currency the way v1's
 * flat `rates: {EUR: 0.94}` did: `rates.currencies` only *names* which
 * currencies the trip may use, and `rates.manual` carries a number only for
 * the ones the ECB does not publish or that the owner wants to override —
 * both in the ECB's own convention (units of the currency per one euro, the
 * same as `loadEcbRates()`'s table). So getting to "units of base currency
 * per one unit of THB" is two hops now rather than one stored number:
 * `manual` (or the cached ECB snapshot) for THB→EUR, then `crossRate` for
 * EUR→base. Nothing here fetches anything — `loadEcbRates` only ever reads
 * the cached file `npm run rates:update` (or the nightly refresh) already
 * wrote, so a currency the cache does not cover, or a fresh checkout with no
 * cache at all, drops out of the table exactly the way an unconvertible
 * currency always has: reported as unconverted rather than counted at face
 * value (`lib/costs.ts`).
 */
function resolveTripRates(
  raw: TripFile["rates"],
  base: string,
): { rates: RateTable; ratesFrom: Record<string, string> } {
  if (!raw) return { rates: {}, ratesFrom: {} };
  const ecb = loadEcbRates();
  const eurRates: Record<string, number> = { ...(ecb?.rates ?? {}), ...(raw.manual ?? {}) };
  // The base currency's own EUR rate has to be *somewhere* in this table for
  // `crossRate` to convert anything at all — it divides every other currency
  // through it (lib/currency.ts). When the ECB archive does not track this
  // journal's base currency and nobody wrote a `manual` entry for it either
  // (an instance with no fetched rates table yet, or a base the archive has
  // never priced), the table has a hole at exactly the entry every
  // conversion needs, and every currency the trip names vanishes from
  // `rates` at once — not just the untracked one. `eurManualRates`
  // (lib/tripWrite.ts) already accepts this same approximation on the write
  // side for the same reason; ponytail: 1 rather than a refusal, so a trip
  // still converts *something* until an owner corrects the base or the
  // archive learns it. Upgrade path: refuse instead, once this is worth an
  // owner's attention rather than a silently empty rates block.
  if (base !== "EUR" && !(typeof eurRates[base] === "number" && Number.isFinite(eurRates[base]) && eurRates[base] > 0)) {
    eurRates[base] = 1;
  }
  const rates: Record<string, number> = {};
  const ratesFrom: Record<string, string> = {};
  for (const rawCode of raw.currencies) {
    const code = normalizeCurrency(rawCode);
    if (!code) continue;
    const rate = crossRate(code, base, eurRates);
    if (rate === undefined) continue;
    rates[code] = rate;
    ratesFrom[code] =
      raw.manual?.[code] !== undefined
        ? "the trip's own rate"
        : ecb?.date
          ? `European Central Bank, ${ecb.date}`
          : "European Central Bank";
  }
  return { rates, ratesFrom };
}

/**
 * `figures:` resolved into the render layer's own `Figure[]` — B1609. The
 * wire names a *mode* and, for `custom`, a list of figure-library ids
 * (`content/<user>/figures/<id>.json`); this trip's own vocabulary only
 * knows how to draw a party, not how to look one up by id, so this is the
 * one place that translation happens.
 *
 * ponytail: `{mode: "off"}` and `{mode: "journal"}` both read as `[]` here,
 * same as an absent `figures:` — `partyFor` (lib/travellers/parse.ts) then
 * falls back to the journal's own default party for all three, which is
 * correct for "journal" but means "off" cannot yet ask for *no one drawn at
 * all*. `Trip.travellers` has no third state to say that in. Upgrade path:
 * give it one, the day an owner actually wants a party-less trip.
 */
function resolveTripFigures(raw: TripFile["figures"], username: string): Figure[] {
  if (!raw || raw.mode !== "custom") return [];
  return raw.figures
    .map((id) => readFigureDoc(username, id))
    .filter((doc): doc is FigureDoc => doc !== null)
    .map(figureDocToFigure);
}

/**
 * `content/<user>/figures/<id>.json`, read directly rather than through
 * `lib/figures.ts`'s own `getFigureDoc` — that module imports `tripDir`
 * from this one (for `figureReferences`), so importing it back here would
 * be a cycle. Both are a plain `JSON.parse` of one small file; duplicating
 * that is cheaper than restructuring either module to share it.
 */
function readFigureDoc(username: string, id: string): FigureDoc | null {
  const file = path.join(contentRoot(), username, "figures", `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FigureDoc;
  } catch {
    return null;
  }
}

/**
 * Routed through `parseFigure` — the same enum filter an inline
 * `travellers:` block always ran through (`lib/travellers/parse.ts`) —
 * rather than copying every field straight off the document. `travellersBlock`
 * already refuses a bad `hairStyle`/`outfit`/`build`/`age`/`accessories` at
 * write time, but a figure file is not only ever produced by that path: it
 * can be hand-edited, carried over from an older vocabulary, or written by
 * something else entirely, and `figureFromJson` does no shape-checking of
 * its own. Skipping the filter here would hand the renderer a value from
 * outside its fixed set of SVG paths with nothing left to catch it — the
 * same failure `parseFigure`'s docblock describes for hand-edited
 * frontmatter, one layer further out.
 */
function figureDocToFigure(doc: FigureDoc): Figure {
  return parseFigure({ ...doc, for: doc.person }) ?? {};
}

/**
 * Exported since B1496 so `patchTripDetails` can predict what the file it is
 * about to write will read back as, using the reader itself rather than a
 * second normaliser that would disagree about a trimmed or emptied entry.
 */
function parseTranslations(raw: unknown): TripTranslations | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, { title?: string; tagline?: string; intro?: string } | undefined>;
  const out: TripTranslations = {};
  // Every locale the file offers, not a fixed pair: a journal may be
  // written in a language this project ships no chrome for.
  for (const loc of Object.keys(src)) {
    const v = src[loc];
    if (v && (v.title || v.tagline || v.intro)) {
      out[loc] = { title: v.title, tagline: v.tagline, intro: v.intro };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Refuses one folder, warns the server log, and carries the reason back. */
function refuse(folder: string, reason: MalformedTripReason, problem: string): MalformedTrip {
  console.warn(`[trips] ${folder}/: ${problem}`);
  return { folder, reason, problem };
}

/**
 * One `trip.json` → a Trip, or a MalformedTrip saying why not.
 *
 * - `Trip` — it parsed and is trustworthy.
 * - `MalformedTrip` — the folder would silently vanish, and this is what to
 *   tell whoever put it there. Returned rather than thrown so a typo in one
 *   trip does not take every other trip down with it (matching lib/plan.ts),
 *   and returned rather than dropped so the reason reaches the owner and the
 *   agent that wrote the file, not just the server log (B83).
 *
 * A folder with **no `trip.json` at all** is one of those, not a null. It was
 * first read as "a folder that never claimed to be a trip is nothing to
 * report" — but nothing else lives directly under `trips/`, so the only way to
 * make one is to be halfway through creating a trip. That is exactly the agent
 * this task is about: it made the directory, its write of the file failed, and
 * every read afterwards is indistinguishable from never having tried.
 *
 * `dayFromJson`/`tripFromJson` (`lib/api/v2/documents.ts`) are the one place
 * that turns a document's bytes into typed fields — this function's own job
 * is everything downstream of that: validity of `id`/`title`/`dates`, and the
 * mapping from the wire's `TripFile` onto this render layer's own `Trip`
 * (B1598). That mapping is deliberate rather than 1:1 — `figures` resolves
 * against the figure library, `rates` resolves against the cached ECB
 * table, `costs`/`plan` pass through whole for `lib/costs.ts`/`lib/plan.ts`
 * to read (see the note on `Trip.costsSection`) — and it happens here, once,
 * rather than once per reader.
 *
 * The `[trips]` warnings stay. The server log is still the right place for an
 * operator tailing stdout; it was only ever wrong as the *sole* place.
 */
/** `plan` with its `private` section removed outright — see the comment on
 * `Trip.planSection`'s assignment below for why this runs unconditionally
 * rather than by reader level. */
function dropPlanPrivate(plan: TripFile["plan"]): TripFile["plan"] {
  if (!plan || plan.private === undefined) return plan;
  const { private: _private, ...rest } = plan;
  return rest;
}

function readTrip(username: string, dir: string, folder: string): Trip | MalformedTrip {
  const file = path.join(dir, "trip.json");
  if (!fs.existsSync(file)) {
    // B1598 moved the format from trip.md to trip.json with no reader
    // fallback (deliberately — see B1680). A folder still carrying trip.md is
    // not "never written"; it is a real trip waiting on its owner's own
    // migration, and telling them "there is no trip.json" while their content
    // sits right there in the old file would be false. Distinguishing it here
    // means an operator who upgrades across B1598 gets an honest reason
    // rather than the same silence a half-made trip gets.
    if (fs.existsSync(path.join(dir, "trip.md"))) {
      return refuse(folder, "old-format", "it is still trip.md — convert it to trip.json");
    }
    return refuse(folder, "no-file", "there is no trip.json in it");
  }

  const raw = fs.readFileSync(file, "utf8");
  let data: Record<string, unknown>;
  let tripFile: TripFile;
  try {
    // Parsed twice — once by `tripFromJson` for the typed fields, once here
    // for `unknownFields` — because `tripFromJson` only ever returns the
    // keys it knows about, and a key it does not know about is exactly what
    // `unknownFields` exists to notice. Both are one cheap `JSON.parse` of a
    // small file; a second field-by-field parser would be the thing AGENTS.md
    // warns against, this is not that.
    data = JSON.parse(raw) as Record<string, unknown>;
    tripFile = tripFromJson(raw);
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return refuse(folder, "unparseable", `it could not be parsed: ${why}`);
  }

  const id = String(tripFile.id ?? "").trim();
  const title = String(tripFile.title ?? "").trim();
  const start = String(tripFile.dates?.from ?? "").trim();
  const end = String(tripFile.dates?.to ?? "").trim();

  if (!id) {
    return refuse(folder, "missing-id", `it has no id (add \`"id": "${folder}"\`, matching the folder)`);
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
      `it needs a title and ISO dates.from and dates.to (YYYY-MM-DD); ` +
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or malformed`,
    );
  }

  // Read before the object below because `teaser:` is only meaningful against
  // the visibility this file ended up with — not against the word it wrote.
  const visibility = parseVisibility(tripFile.visibility, tripFile.listed, folder);
  const configured = loadUserConfig(username).baseCurrency;
  const base = normalizeCurrency(configured, configured.toUpperCase());

  return {
    id,
    username,
    ref: tripRef(username, id),
    title,
    tagline: tripFile.tagline ? String(tripFile.tagline) : undefined,
    start,
    end,
    status: deriveStatus(start, end),
    cover: tripFile.cover ? mediaWithOwner(String(tripFile.cover), username) : undefined,
    accent: parseAccent(tripFile.accent),
    ...resolveTripRates(tripFile.rates, base),
    intro: (tripFile.intro ?? "").trim(),
    translations: parseTranslations(tripFile.translations),
    people: parsePeople(tripFile.people, folder),
    travellers: resolveTripFigures(tripFile.figures, username),
    // `true` and nothing else. Absent is the overwhelming case, and a flag
    // that quietly accepted "no" or "false" as truthy would put a banner on
    // somebody's actual holiday.
    test: tripFile.test === true || undefined,
    ...visibility,
    teaser: parseTeaser(tripFile.teaser, visibility.visibility, folder) || undefined,
    costsVisibility: parseCostsVisibility(tripFile.costs?.visibility, folder),
    // v2 retired `tracks:` — every day answers every declinable directly now
    // (`DAY_DECLINABLES`), so there is no trip-level "what to ask for" any
    // more. `parseTracks(undefined)` is "all of it", which nothing under
    // `lib/` still enforces against but nothing reads for rendering either.
    tracks: parseTracks(undefined),
    /**
     * The evening nudge, D18. Presence is the switch, so there is no second
     * scalar to disagree with this one — which is why this reads the field
     * straight through rather than reconciling two the way v1 had to.
     */
    reminder: tripFile.reminder ? { channel: tripFile.reminder.channel } : undefined,
    unknownFields: unknownFields(data),
    costsSection: tripFile.costs,
    // B2009 — `plan.private` dropped here, unconditionally, rather than
    // carried through and trusted to every later reader. `Trip` has no
    // reader-level plumbing of its own (unlike `getAllEntries`'s
    // `ReadOptions.reader`) and is handed whole into `TripProvider`, a
    // client component — whatever survives onto `planSection` is therefore
    // serialised to *every* visitor of a trip page, not only its owner.
    // `lib/api/v2/trips.ts`'s `buildTripDoc` is the one reader-aware door
    // onto `plan.private` (the v2 GET route, gated on `mayActAsOwner`); nothing
    // under `lib/plan.ts` or the pages it feeds has ever needed the private
    // half, so there is nothing here to thread a reader level through yet.
    planSection: dropPlanPrivate(tripFile.plan),
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
        const { mtimeMs, size } = fs.statSync(path.join(root, folder, "trip.json"));
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
