import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isTestContent } from "../access";
import { loadUserConfig } from "../config";
import { CURRENCY_FOR_COUNTRY } from "../countryCurrency";
import { normalizeCurrency } from "../currency";
import {
  AS_AUTHOR,
  entrySlugFromFile,
  fileUnchangedSince,
  forgetEntries,
  getAllEntries,
  getDays,
  getEntryBySlug,
} from "../entries";
import { dayFromJson, dayToJson, type DayFile } from "./v2/documents";
import { countryCodeFor } from "../flags";
import type { TranslationKey } from "../i18n";
import { translateIn } from "../locales";
import { getUser } from "../users";
import { reverseGeocode } from "../ingest/geo";
// One slugify for the whole codebase (B77). This module used to carry its
// own, which stripped a German umlaut down to its bare vowel and disagreed
// with the one ingest used — the same title, two permanent URLs.
import { slugify } from "../slug.ts";
import { mediaKey, type PhotoVisibility } from "../photos";
import { deleteMediaFiles, renameDayMedia, slugHasOrphanedMedia } from "./media";
import { getTrip, parseTripRef, tripDir, tripRef } from "../trips";
import type { Entry, GalleryItem, Trip, TripVisibility } from "../types";
import type { Problem } from "../validate/media";
import {
  UNKNOWN,
  TRACKS,
  type Track,
  type DayFacts,
} from "../tracks";
import { tripGaps } from "./tripGaps";
import { quoteScalar } from "../validate/frontmatter";
import { type DayWeather } from "../weather";
import { timezoneForCoordinates } from "../timezone";

/**
 * Writing content through the API.
 *
 * Everything an agent creates lands as a **draft** (G7), and `createDraft` has
 * no argument that changes it. That is not a gate against the agent — it
 * publishes too, in `publishDraft` below. It is a gap: one hallucinated memory
 * in front of somebody's family is unrecoverable, and the only thing that ever
 * catches one is a person reading the day back before anybody else can. Two
 * calls is what makes that moment exist.
 *
 * Writes go straight to a day's JSON file (`entries/YYYY-MM-DD-slug.json`,
 * B1606/B1598) through `lib/api/v2/documents.ts`'s `dayFromJson`/`dayToJson` —
 * the one serialiser the readers use too, so a day this file writes is a day
 * `lib/entries.ts` can read back.
 */

/** One logged cost, as a caller sends it. Named because `DraftInput["costs"]`
 * stopped being only a list when B531 gave it `false` — see there. */
export type CostInput = {
  label: string;
  amount: number;
  currency?: string;
  category?: string;
};

export type DraftInput = {
  /**
   * Absent means the day has no title yet — B1442. A room-started day that
   * nobody has described writes no title at all rather than a placeholder, so
   * every reader falls back to the date it already knows how to format
   * instead of being handed an ISO string dressed up as somebody's words.
   * Present-and-empty is still refused (`validateDraft`): a caller sending
   * `title: ""` is a mistake, not a statement that there is none yet.
   */
  title?: string;
  date: string;
  /**
   * B1650 (decision a) widens this to a decline, matching `costs` above: a
   * caller that has asked and been told there is no one moment for this day,
   * or that nobody wrote the time down, says so on this same field rather
   * than on one of its own.
   */
  time?: string | false | typeof UNKNOWN;
  /** The IANA name `time` is local to — B42. Validated by
   * `lib/validate/entry.ts`'s `checkTimezone`; absent means the feed and the
   * dual clock fall back to the journal's own zone rather than guessing. */
  timezone?: string;
  location?: string;
  country?: string;
  /**
   * The flag `lib/flags.ts` draws — two letters, ISO 3166-1 alpha-2. Absent
   * lets `countryCodeFor` in lib/entries.ts guess one from `country`'s name;
   * given, it wins over the guess. Accepted since B540: the field has existed
   * on `Entry` since it was added for the flag, but nothing on the write side
   * ever read it out of a request body, so a caller that sent one got a 201
   * and a day that came back without it.
   */
  countryCode?: string;
  lat?: number;
  lng?: number;
  content: string;
  /** Widened for B1650 (decision a) the same way `time` above is — a caller
   * that asked and was told this day earns no tags, or that nobody has
   * sorted them out yet, says so here rather than on a field of its own. */
  tags?: string[] | false | typeof UNKNOWN;
  /**
   * The day's title and content in the journal's other declared languages —
   * B294. Required, in the sense that `validateEntry` refuses a day missing
   * one: a journal readable in three languages writes its days in three. The
   * words are the owner's; an agent that translates them itself is inventing
   * what somebody said.
   */
  translations?: Record<string, { title: string; content: string }>;
  /**
   * This whole update, held back from readers the trip otherwise lets in —
   * B632. The same two words `photoVisibility` takes, meaning the same two
   * populations, and it **narrows and never widens**: a `guest` day inside a
   * `private` trip stays private, and there is no `public` to ask for. Unlike
   * `photoVisibility`, this is writable at creation as well as by edit — it
   * is one scalar on the entry itself, not a label matched against a `src`
   * that does not exist yet. See lib/photos.ts.
   */
  /** Widened for B1650 (decision a): `false` is the ordinary answer — shown
   * to everyone the trip already lets in — and `"unknown"` is nobody having
   * decided yet. Neither is a value `Entry.visibility` itself ever carries;
   * both are declines recorded in `declined.visibility` instead. */
  visibility?: PhotoVisibility | false | typeof UNKNOWN;
  /**
   * Spend logged against this day, each in the currency it was actually spent
   * in. Never converted at write time — see lib/costs.ts.
   *
   * Accepted here since W38. `lib/validate/entry.ts` has always checked the
   * shape of this field, which meant a caller that sent costs got a clean 400
   * for a malformed one and silence for a correct one: it was validated and
   * then dropped on the floor, because this writer never emitted it. A field
   * the API validates is a field the API has promised to keep.
   */
  costs?: CostInput[] | false | typeof UNKNOWN;
  /**
   * The two other declines — B531, and see `lib/tracks.ts`.
   *
   * `false` is a statement about the day rather than a switch on the request:
   * *this day has no one place to put on a map*, *there are no pictures from
   * this day*. `costs: false` above is the same word in the same sense, which
   * is why it shares that field rather than getting one of its own — an agent
   * that has costs sends costs, and one that asked and was told there were
   * none says so in the same key.
   *
   * **`"unknown"` is the third answer** — B560 — and it is on these same
   * fields for the same reason: a caller stuck on `costs` should find every
   * answer it can give by reading about `costs`. It means *there was some of
   * this and nobody has it*, which is not `false` and is the commonest truth
   * about a trip that finished a while ago.
   *
   * Both land in the day's one `declined` map (v2, B1598) rather than in
   * v1's separate `without:`/`unrecorded:` lines — see `DECLINE_KEY` and
   * `declineText` below.
   */
  coordinates?: false | typeof UNKNOWN;
  photos?: false | typeof UNKNOWN;
  /** How the day was travelled. Same story as `costs` — validated since W29,
   * written since W38, and widened to a decline for B1650 (decision a). */
  transportMode?: string | false | typeof UNKNOWN;
  transportFrom?: string;
  transportTo?: string;
  /**
   * How this day's arrival scene plays — see `TRAVEL_SCENE_VARIANTS` in
   * lib/validate/entry.ts. Absent plays today's scene, unchanged.
   */
  travelScene?: string;
  /**
   * A day nobody lived, written to prove the pipeline works.
   *
   * Set it when you were asked to invent content — the page then says so in a
   * banner, and the day stays out of the feed, the search index and the
   * sitemap. See lib/types.ts for why the system owns this rather than the
   * prose.
   */
  test?: boolean;
  /**
   * Ask this server to look up what the weather was — B325.
   *
   * A request, not an answer. It needs `lat`/`lng` and the `weather`
   * capability; with either missing the day is written and nothing is looked
   * up. The lookup itself happens in the route, after the file is on disk, and
   * can never fail the write.
   */
  weather?: boolean;
  /**
   * A reading the caller took themselves.
   *
   * Only ever with a `source` and a `recordedAt`, and never with the server's
   * own source name — `lib/validate/entry.ts` refuses the rest. See
   * `checkWeatherData` there for why this is the most restricted field a day
   * has.
   */
  weatherData?: DayWeather;
  /**
   * Names this one write, so a retry after a dropped connection gets the first
   * answer back instead of a conflict. Never written to the file — see the
   * days route.
   */
  idempotency_key?: string;
  /**
   * Run every check the real POST runs and write nothing — no draft, no
   * idempotency record, no media move. `false` or absent behaves exactly as
   * before. Never written to the file, and never read by `createDraft`: the
   * days route returns before calling it. See B537.
   */
  dryRun?: boolean;
};

export type WriteResult =
  | {
      ok: true;
      slug: string;
      file: string;
      status: "draft";
      /** The currency stamped onto any cost line that named none — B542.
       * Absent when every line named its own, or there were none. */
      costCurrency?: string;
    }
  /**
   * `bug` marks the refusals that are this software's fault rather than the
   * caller's, so a door that speaks in status codes can say 500 instead of
   * blaming the request (B208). Absent on every refusal a caller can fix by
   * sending something else.
   *
   * `code` is a stable identifier for a refusal whose `error` is an English
   * sentence written for an agent reading `/api/v1/…` — B785. The helper
   * routes under `app/api/helper/` are read by a person on a possibly-German
   * screen, and `error` here must stay the sentence an over-the-network agent
   * matches against, so a helper route prefers `code` when one is present
   * rather than translating `error` itself. Absent on every refusal whose
   * `error` is already a stable code (`"unknown_trip"` and the like) — there
   * is nothing for `code` to add there.
   */
  | { ok: false; error: string; code?: string; bug?: true };

/** A delete has no file left to name. */
export type DeleteResult =
  { ok: true; slug: string; published: boolean } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** `loadUserConfig`'s `baseCurrency`, normalised — the same fallback
 * `lib/entries.ts`'s read-time default uses, so the two never disagree about
 * what "unknown" means. */
function journalBaseCurrency(ref: string): string {
  const owner = parseTripRef(ref)?.username;
  const configured = owner ? loadUserConfig(owner).baseCurrency : "CHF";
  return normalizeCurrency(configured, configured.toUpperCase());
}

/**
 * The currency a cost line gets when it names none — B542.
 *
 * In order: the day's own `country`; failing that, the country the day's
 * `lat`/`lng` reverse-geocodes to; failing both, `baseCurrency` — today's
 * behaviour, unchanged. One currency per country, from `lib/countryCurrency.ts`
 * — the eurozone collapses correctly, and a country running two in parallel
 * gets one, which is tolerable only because this is a default a writer
 * overrides per line and never a conversion.
 */
function resolveCostCurrency(
  place: { country?: string; lat?: number; lng?: number },
  baseCurrency: string,
): string {
  const byCountry =
    CURRENCY_FOR_COUNTRY[countryCodeFor(place.country ?? "") ?? ""];
  if (byCountry) return byCountry;
  // `Number.isFinite`, not `typeof`: an edit reads `lat` off a file that may
  // not carry one, and `Number(undefined)` is a NaN that is typed `number`.
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    const nearest = reverseGeocode(place.lat as number, place.lng as number);
    const byGeo = nearest && CURRENCY_FOR_COUNTRY[nearest.countryCode];
    if (byGeo) return byGeo;
  }
  return baseCurrency;
}

/**
 * Stamps `resolveCostCurrency` onto every cost line that arrived without a
 * `currency` of its own — write time only; a line that named one is
 * untouched, and `lib/costFormat.ts`'s read-time default is unaffected, so a
 * day written before this landed keeps meaning exactly what it meant.
 *
 * Every line without one resolves to the same currency (a day has one place),
 * so `applied` is a single code — undefined when nothing needed filling in,
 * which is what tells a caller there is nothing to report.
 */
function stampCostCurrencies(
  costs: CostInput[] | undefined,
  place: { country?: string; lat?: number; lng?: number },
  baseCurrency: string,
): { costs: CostInput[] | undefined; applied?: string } {
  if (!costs?.length) return { costs };
  let applied: string | undefined;
  const stamped = costs.map((cost) => {
    if (cost.currency?.trim()) return cost;
    applied ??= resolveCostCurrency(place, baseCurrency);
    return { ...cost, currency: applied };
  });
  return { costs: stamped, applied };
}

/**
 * The `costs:` block, in the flow style the hand-written entries used to
 * carry — kept only for `lib/api/markdownTwin.ts`'s `.md` rendering of a day
 * that already lives as JSON on disk. Nothing under this file writes markdown
 * any more; this is presentation, not storage.
 */
// Exported since B295: the costs door writes a trip's preparation costs in
// this identical shape, and reuses this renderer rather than a second copy.

/**
 * The `translations:` block, rendered as markdown — the same "presentation,
 * not storage" role as `costLines` above. `lib/api/markdownTwin.ts` is its
 * only caller now that the day itself is stored as JSON.
 */
export function translationLines(
  translations: DraftInput["translations"],
): string[] {
  const codes = Object.keys(translations ?? {}).sort();
  if (codes.length === 0) return [];
  const lines = ["translations:"];
  for (const code of codes) {
    const tr = translations![code];
    lines.push(`  ${code}:`);
    lines.push(`    title: ${quoteScalar(tr.title)}`);
    lines.push("    content: |-");
    // Indented under the block scalar, every line of it. A blank line inside
    // the prose stays blank rather than becoming six spaces, which YAML reads
    // as trailing whitespace and a reader sees as a stray indent.
    for (const line of tr.content.replace(/\r\n/g, "\n").split("\n")) {
      lines.push(line.trim() === "" ? "" : `      ${line}`);
    }
  }
  return lines;
}

export function validateDraft(input: Partial<DraftInput>): string | null {
  // Absent is "no title yet" (B1442); present-and-empty is still a mistake,
  // the same asymmetry `applyEditToDay`'s own title check already draws.
  if (input.title !== undefined && (typeof input.title !== "string" || input.title.trim() === "")) {
    return "title must not be empty";
  }
  if (typeof input.date !== "string" || !DATE_RE.test(input.date)) {
    return "date is required, as YYYY-MM-DD";
  }
  const time = input.time;
  if (time !== undefined && time !== false && time !== UNKNOWN && !TIME_RE.test(String(time))) {
    return "time must be HH:MM";
  }
  if (typeof input.content !== "string" || input.content.trim() === "") {
    return "content is required";
  }
  for (const key of ["lat", "lng"] as const) {
    const value = input[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || Number.isNaN(value))
    ) {
      return `${key} must be a number`;
    }
  }
  return null;
}

/** The entries directory for a trip. */
function entriesDirOf(ref: string): string {
  return path.join(tripDir(ref), "entries");
}

/** Where one day's JSON file lives. */
function dayFileOf(ref: string, slug: string): string {
  return path.join(entriesDirOf(ref), `${slug}.json`);
}

/**
 * The entry file in this trip already holding `slug`, or null.
 *
 * Reads the directory rather than `getAllEntries`, for two reasons: drafts are
 * filtered out of that (and a draft holding the slug is just as much of a
 * conflict — publishing it later is what would shadow), and this runs on the
 * write path, where the entry cache may not have been rebuilt yet.
 */
function entryFileWithSlug(dir: string, slug: string): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // No entries directory yet — the first day in a trip collides with nothing.
    return null;
  }
  return files.find((f) => entrySlugFromFile(f) === slug) ?? null;
}

/**
 * A trip-wide-unique placeholder slug for a day with no title yet — B1442.
 *
 * "day", then "day-2", "day-3", … — never the date, which is the bug this
 * exists to avoid repeating: several days may be started from the room and
 * left untitled at once, so the placeholder still has to be an address
 * nothing else already holds.
 */
function nextUntitledSlug(dir: string): string {
  let slug = "day";
  for (let n = 2; entryFileWithSlug(dir, slug); n++) slug = `day-${n}`;
  return slug;
}

/**
 * The day just written, read back — or a sentence saying what is wrong with it.
 *
 * **One file, not the trip.** `createTrip` reads its trip back through
 * `getTrip` (B204), which is a memoised read of one folder; the equivalent
 * here would be `getEntryBySlug`, and that goes through `getAllEntries`, which
 * re-reads and re-parses *every* entry in the trip. On the commonest write in
 * the system, on a trip with two hundred days, that is two hundred file reads
 * to check one file. So this reads the one file and parses it with the same
 * `dayFromJson` the reader uses, which is the only step here that can fail on
 * a file this function wrote.
 *
 * Three questions, and the last two matter as much as the first: the title
 * and date are asserted to read back as they were written, and the day is
 * asserted to still be a draft — a day that reported `status: draft` and
 * reads back as published is the one failure here that is worse than an
 * invisible file.
 */
function draftDoesNotReadBack(file: string, input: DraftInput): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return `it could not be read back (${err instanceof Error ? err.message : String(err)})`;
  }
  let day: DayFile;
  try {
    day = dayFromJson("", raw);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `its JSON does not parse (${said})`;
  }
  if (day.title !== (input.title ?? "")) {
    return "its title does not read back as it was written";
  }
  if (day.date !== input.date) {
    return "its date does not read back as it was written";
  }
  if (day.status !== "draft") {
    return 'it does not read back as "status: draft"';
  }
  return null;
}

/** The cost lines, when `costs` carries lines at all — `false` and
 * `"unknown"` are answers *about* the list rather than members of it. */
function costLinesOf(input: Partial<DraftInput>): CostInput[] | undefined {
  return Array.isArray(input.costs) ? input.costs : undefined;
}

function declinedIn(input: Partial<DraftInput>): Track[] {
  return TRACKS.filter((key) => answerFor(input, key) === false);
}

/**
 * The rows this write says nobody knows the answer to — B560.
 *
 * The third answer, and the one the contract was missing: `"costs": "unknown"`
 * says money was spent and the figures are gone, which is neither a value nor
 * *there was none*. Without it a caller holding a refusal and no number had
 * one door left, and took it — a journal ended up saying no money was spent on
 * two days somebody paid a homestay in cash.
 */
function unrecordedIn(input: Partial<DraftInput>): Track[] {
  return TRACKS.filter((key) => answerFor(input, key) === UNKNOWN);
}

/** Every row is answered on its own differently-typed field of `DraftInput`
 * (a decline is `false`/`"unknown"` on that same field, never a field of its
 * own — see the doc comment on `coordinates`/`photos` above); this is the one
 * place that knows which. */
function answerFor(input: Partial<DraftInput>, key: Track): unknown {
  return key === "costs" ? input.costs : input[key];
}

/** The genuine value of a field that may instead carry a decline
 * (`false`/`"unknown"`) — `undefined` for either decline, the value
 * unchanged otherwise. */
function realOf<T>(value: T | false | typeof UNKNOWN | undefined): T | undefined {
  return value === false || value === UNKNOWN ? undefined : (value as T | undefined);
}

/**
 * What a write *would* leave the day carrying, for the completeness contract.
 *
 * `photos` is always false here and that is not a mistake: media is a second
 * call, so no write can carry a photograph. `missingFrom` only asks about the
 * publish-time rows when it is publishing, so nothing is refused for it.
 */
export function factsOfInput(
  input: Partial<DraftInput>,
  declined: Track[] = declinedIn(input),
): DayFacts {
  return {
    costs: Array.isArray(input.costs) && input.costs.length > 0,
    coordinates: typeof input.lat === "number" && typeof input.lng === "number",
    photos: false,
    time: typeof input.time === "string" && input.time.trim() !== "",
    transportMode: typeof input.transportMode === "string" && input.transportMode.trim() !== "",
    tags: Array.isArray(input.tags) && input.tags.length > 0,
    visibility: input.visibility === "guest" || input.visibility === "private",
    without: declined,
    unrecorded: unrecordedIn(input),
  };
}

/** The same question of a day already on disk, which is what publish asks. */
export function factsOfEntry(entry: Entry): DayFacts {
  return {
    costs: entry.costs.length > 0,
    coordinates: entry.lat !== undefined && entry.lng !== undefined,
    photos: entry.gallery.length > 0,
    time: typeof entry.time === "string" && entry.time.trim() !== "",
    transportMode: entry.transport?.mode !== undefined,
    tags: entry.tags.length > 0,
    visibility: entry.visibility === "guest" || entry.visibility === "private",
    without: entry.without ?? [],
    unrecorded: entry.unrecorded ?? [],
  };
}

/**
 * A `Track` and the key it lands under in a day's one `declined` map — v2's
 * single mechanism (B1598) replacing v1's separate `without:`/`unrecorded:`
 * lines. `photos` is the track's own name; `media` is what the day itself
 * calls the section it is declining, matching `dayWrite`'s own field name.
 */
const DECLINE_KEY: Record<Track, "costs" | "coordinates" | "media" | "time" | "transportMode" | "tags" | "visibility"> = {
  costs: "costs",
  coordinates: "coordinates",
  photos: "media",
  time: "time",
  transportMode: "transportMode",
  tags: "tags",
  visibility: "visibility",
};

/**
 * A decline is free text for the next reader (`declineReason` in
 * `lib/api/v2/schemas/shared.ts`) rather than a checkbox — but `DraftInput`
 * only ever hands this writer a boolean-shaped answer (`false` or
 * `"unknown"`), with no reason of its own to carry forward. These are that
 * reason, synthesised from the answer rather than invented about the day.
 */
function declineText(track: Track, why: "no" | "unknown"): string {
  const about: Record<Track, string> = {
    costs: "what this day cost",
    coordinates: "where this day happened",
    photos: "photographs from this day",
    time: "what time this day happened",
    transportMode: "how this day travelled",
    tags: "this day's tags",
    visibility: "whether this day is held back from anyone the trip lets in",
  };
  return why === "no"
    ? `Nothing to record: ${about[track]}.`
    : `Not recorded: ${about[track]} is unknown.`;
}

/** The `declined` map a fresh draft carries, from its three boolean-shaped
 * answers — `undefined` when nothing was declined. */
function buildDeclined(input: Partial<DraftInput>): DayFile["declined"] {
  const declined: Record<string, string> = {};
  for (const track of TRACKS) {
    const answer = answerFor(input, track);
    if (answer === false) declined[DECLINE_KEY[track]] = declineText(track, "no");
    else if (answer === UNKNOWN) declined[DECLINE_KEY[track]] = declineText(track, "unknown");
  }
  return Object.keys(declined).length ? (declined as DayFile["declined"]) : undefined;
}

/** A fresh `DayFile` from a validated `DraftInput` — the create half of the
 * mapping `applyEditToDay` is the edit half of. */
function buildDayFile(
  slug: string,
  input: DraftInput,
  costs: CostInput[] | undefined,
  timezone: string | undefined,
): DayFile {
  const day: DayFile = {
    slug,
    title: input.title ?? "",
    date: input.date,
    content: input.content.trim(),
    status: "draft",
  };
  // `time`, `tags`, `transportMode` and `visibility` now carry a decline
  // (`false`/`"unknown"`) as well as a real value (B1650, decision a) — the
  // same field `costs`/`coordinates`/`photos` already used a decline for.
  // `realOf` reads the genuine value back out, or `undefined` when this call
  // is one of those two answers rather than a value to write.
  const realTime = realOf(input.time);
  if (realTime) day.time = realTime;
  if (timezone) day.timezone = timezone;
  if (input.location) day.location = input.location;
  if (input.country) day.country = input.country;
  if (input.countryCode) day.countryCode = input.countryCode.toUpperCase();
  if (input.lat !== undefined && input.lng !== undefined) {
    day.coordinates = { lat: input.lat, lng: input.lng };
  }
  const realTags = realOf(input.tags);
  if (realTags?.length) day.tags = realTags;
  const realTransportMode = realOf(input.transportMode);
  if (realTransportMode) {
    // Cast, like `travelScene` below: both arrive as `string` on the input
    // type because that is what a caller sends, and both have already been
    // checked against their closed list by `lib/validate/entry.ts` before
    // anything reaches here (`transportMode` at its own check there). The
    // cast records that, rather than re-deciding it in a second place that
    // could disagree with the first.
    day.transportMode = realTransportMode as DayFile["transportMode"];
    day.transportFrom = input.transportFrom ?? "";
    day.transportTo = input.transportTo ?? "";
  }
  if (input.travelScene) day.travelScene = input.travelScene as DayFile["travelScene"];
  const realVisibility = realOf(input.visibility);
  if (realVisibility) day.visibility = realVisibility;
  // One field on disk (B1598): a real reading always wins over a bare
  // request, since a reading already answers the question the request asked.
  if (input.weatherData) day.weather = input.weatherData;
  else if (input.weather === true) day.weather = true;
  if (costs?.length) day.costs = costs as DayFile["costs"];
  if (input.translations && Object.keys(input.translations).length) {
    day.translations = input.translations;
  }
  if (input.test === true) day.test = true;
  const declined = buildDeclined(input);
  if (declined) day.declined = declined;
  return day;
}

/**
 * Create a draft entry.
 *
 * Refuses to overwrite: an agent retrying a request must not silently replace
 * yesterday's writing. The caller gets the existing slug back and can decide.
 */
export function createDraft(ref: string, input: DraftInput): WriteResult {
  const problem = validateDraft(input);
  if (problem) return { ok: false, error: problem };

  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const dir = entriesDirOf(ref);
  // No title yet (B1442) gets a placeholder that says so, numbered rather
  // than derived from the date — `2026-09-11-2026-09-11.json` was the date
  // concatenated with a slug made from the same date, which is both an ugly
  // address and, worse, a title surfaces rendered as though it were real
  // words. Several days may be started and left untitled at once, so the
  // placeholder still has to be unique within the trip.
  const slug = input.title ? slugify(input.title) : nextUntitledSlug(dir);
  const file = path.join(dir, `${input.date}-${slug}.json`);

  if (fs.existsSync(file)) {
    return {
      ok: false,
      code: "day_exists",
      error: `an entry already exists at ${input.date}-${slug}`,
    };
  }

  /*
   * The same slug on a *different* date is the same collision, and used to be
   * allowed (B119).
   *
   * A slug is a day's address within its trip — `getEntryBySlug` takes the
   * first match and there is no tiebreak — so a second day holding one is
   * written, is not a draft, and can never be served. Nothing said so: the
   * write returned 201 and handed back a slug that already belonged to
   * something else, while `/agent.md` promised "a slug is unique within a
   * trip".
   *
   * It is easy to reach without doing anything strange. `Đà Lạt` (d-with-
   * stroke) and `Ðà Lạt` (eth) both slug to `da-lat`, and that folding is
   * correct — B77 settled it. So do any two titles differing only in
   * punctuation or accents.
   *
   * Refused rather than renamed. Two days in one trip whose titles differ by
   * an invisible codepoint is far more likely a mistake than an intention, and
   * quietly issuing `da-lat-2` would make somebody's permalink something they
   * never chose and would not predict. Refusing keeps the guide's sentence
   * true, which is the sentence agents write against.
   */
  const taken = entryFileWithSlug(dir, slug);
  if (taken) {
    return {
      ok: false,
      code: "slug_taken",
      error:
        `an entry already exists with the slug "${slug}" in this trip — ${taken}. ` +
        "A slug is a day's address within its trip and only one day can hold it, so a " +
        "second would be written and never served. Two titles slug the same way when they " +
        "differ only in punctuation or accents; give this day a title that differs in a word.",
    };
  }

  /*
   * No *entry* holds this slug, but its media folder might — B1539. A day can
   * be deleted while its photographs stay on disk (see `deleteEntry`'s own
   * comment), which frees the slug without emptying the folder. Writing a new
   * day onto it would number its own uploads in after a stranger's leftovers,
   * and dedupe new photographs against ones that never belonged to this day —
   * the same "two days share one folder" shape B1539 found, reached by reuse
   * rather than by two days existing at once.
   */
  if (slugHasOrphanedMedia(ref, slug)) {
    return {
      ok: false,
      code: "slug_taken",
      error:
        `the slug "${slug}" has no day but already has photographs on disk in this trip's ` +
        "media folder — from a day that once held this address and was deleted. Give this day " +
        "a title that differs in a word, so its photographs get a folder of their own.",
    };
  }

  const { costs: stampedCosts, applied: costCurrency } = stampCostCurrencies(
    costLinesOf(input),
    input,
    journalBaseCurrency(ref),
  );

  // B1090: a day that carries where it happened gets its zone worked out from
  // that, not left for the reader to guess. An explicit `timezone:` always
  // wins; a day with no coordinates gets none, same as before this ticket.
  const timezone =
    input.timezone ??
    (input.lat !== undefined && input.lng !== undefined
      ? timezoneForCoordinates(input.lat, input.lng)
      : undefined);

  const day = buildDayFile(slug, input, stampedCosts, timezone);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, dayToJson(day));
  // A new draft is invisible to readers, but not to the owner's own view of
  // their site (W31) — and to the API that is about to be asked whether it
  // exists. Same reason as the delete below.
  forgetEntries(ref);

  /**
   * Read it back rather than trusting the write — B208, the day half of B204.
   *
   * `dayToJson` means there is no known input that produces a file this
   * cannot parse, so this is the guard that does not depend on anybody having
   * thought of the input. Without it a day that no reading path can load is
   * answered `201 {"status":"draft"}`, and the agent tells somebody their day
   * is written and waiting for them.
   *
   * The file goes with the refusal, for the same reason the trip folder does:
   * a slug is a day's address within its trip, and one held by a file nothing
   * can read would refuse the retry (`an entry already exists`) while showing
   * nothing on the site. Removing it means the next attempt is simply the
   * first one again.
   */
  const unreadable = draftDoesNotReadBack(file, input);
  if (unreadable) {
    let removed = true;
    try {
      fs.rmSync(file);
    } catch {
      removed = false;
    }
    forgetEntries(ref);
    return {
      ok: false,
      bug: true,
      error:
        `The day was written but ${unreadable}, so nothing was kept` +
        (removed
          ? `; the slug "${slug}" is still free.`
          : ` — and the file could not be removed, so "${slug}" is taken until somebody deletes ${input.date}-${slug}.json on the server.`) +
        " This is a bug; please report it.",
    };
  }

  return {
    ok: true,
    slug,
    file,
    status: "draft",
    ...(costCurrency ? { costCurrency } : {}),
  };
}

/** `GalleryItem` (the API's own vocabulary) → a `media` entry, the shape
 * `lib/api/v2/documents.ts` writes and `lib/entries.ts` reads back. Optional
 * fields are omitted rather than written as `undefined` — `JSON.stringify`
 * would drop them anyway, but being explicit here means the object this
 * function returns is already what a test can compare against. */
function toMediaWireItem(item: GalleryItem): NonNullable<DayFile["media"]>[number] {
  return {
    src: item.src,
    type: item.type,
    ...(item.width !== undefined ? { width: item.width } : {}),
    ...(item.height !== undefined ? { height: item.height } : {}),
    ...(item.caption ? { caption: item.caption } : {}),
    ...(item.poster ? { poster: item.poster } : {}),
    ...(item.visibility ? { visibility: item.visibility } : {}),
    ...(item.from ? { from: item.from } : {}),
  };
}

/**
 * Put photographs into the day they belong to.
 *
 * The media endpoint used to write the files, hand back a `gallery:` block and
 * tell the agent to paste it into the entry — into which there was nothing to
 * paste, because a day has POST, GET and DELETE and no PATCH. So a day written
 * before its photographs read back with an empty gallery for ever, and the
 * only route out of an ordering mistake was deleting the draft. An honest
 * mistake should not push anybody towards the destructive call.
 *
 * It knows the day: `day=<slug>` is already required to decide *where on disk*
 * the files go, so the entry that should point at them is not in doubt.
 *
 * Read-modify-write of the one JSON file (B1598) — appended to whatever
 * `media` the day already carries, so a second batch after somebody has fixed
 * the title or added captions loses nothing of that.
 *
 * Drafts and published days both — the media route no longer refuses a
 * published day (B393): the same reasoning that lets `PATCH` correct a
 * published day's prose applies here, and the response says plainly that
 * readers will see the addition.
 */
export function attachGallery(
  ref: string,
  slug: string,
  items: GalleryItem[],
):
  { ok: true; attached: number } | { ok: false; error: string; bug?: boolean } {
  if (items.length === 0) return { ok: true, attached: 0 };

  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  let day: DayFile;
  try {
    day = dayFromJson(slug, raw);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      error:
        `"${slug}" cannot be parsed (${said}), so a gallery cannot be written into it. The ` +
        `photographs are on disk under this day; add them to the entry by hand.`,
    };
  }

  /**
   * A malformed item is refused rather than written — B540, and worth a note
   * because the guard used to be an accident.
   *
   * Under v1 this was caught for free: a `width` that was not a number wrote
   * frontmatter that would not parse, and the `matter()` check after the
   * splice refused it. JSON has no such accident — `JSON.stringify` is happy
   * to write `"width": "1: ["` — so the day would take the bad item and the
   * gallery would render against a string dimension. The check is explicit
   * now, which is what it should have been all along: a guard nobody wrote
   * on purpose is a guard that disappears the moment the format changes,
   * and that is exactly what happened here.
   */
  const bad = items.find(
    (i) =>
      (i.width !== undefined && typeof i.width !== "number") ||
      (i.height !== undefined && typeof i.height !== "number"),
  );
  if (bad) {
    return {
      ok: false,
      bug: true,
      error:
        `A photograph's dimensions came through as something other than numbers ` +
        `(${JSON.stringify(bad.src)}), so nothing was written to "${slug}". The files ` +
        `themselves are already stored. This is a bug; please report it.`,
    };
  }

  const media = [...(day.media ?? []), ...items.map(toMediaWireItem)];

  /**
   * A day that said it had no photographs, and now has some, no longer says
   * it — B540/B1564, T6's retraction rule. `appendGallery` (lib/ingest/entry.ts)
   * and v2's `attachDayMedia` (lib/api/v2/days.ts) already do this; this door
   * missed it, which is how `unrecorded: [photos]` and a filled gallery ended
   * up on the same live day.
   */
  let declined = day.declined;
  if (declined?.media !== undefined) {
    const { media: _media, ...rest } = declined;
    declined = Object.keys(rest).length > 0 ? rest : undefined;
  }

  const next: DayFile = { ...day, media, declined };

  // B643 — see `fileUnchangedSince`. The photographs themselves are already
  // on disk by this point (`storeUploads` wrote them before this was ever
  // called), so refusing here does not lose them: it only refuses to write a
  // gallery computed from a copy of the day that a second writer has since
  // moved past, which would otherwise silently take that writer's change
  // down with it.
  if (!fileUnchangedSince(file, raw)) {
    console.warn(
      `[entries] ${ref}/${slug}: refused a gallery write — the day changed under it.`,
    );
    return {
      ok: false,
      error:
        `"${slug}" changed while these photographs were being attached — something else wrote ` +
        `to this day at the same time, and writing the gallery now would have erased that other ` +
        `change. Nothing was written; the photographs are already stored (see \`kept\`) — read ` +
        `the day back and attach them again.`,
    };
  }

  fs.writeFileSync(file, dayToJson(next));
  forgetEntries(ref);
  return { ok: true, attached: items.length };
}

/**
 * `DELETE .../trips/<trip>/media` — take a photograph off a day, for good.
 *
 * B605: photographs could be added and never taken away, so the only remedy
 * for a duplicate or a wrong upload was a shell on the server — the thing
 * this whole API exists to make unnecessary.
 *
 * `srcs` are matched against `entry.gallery` by `mediaKey`, the same rule
 * `checkCaptions` already holds a caption to (B540) — never trusted as a
 * path built from the request body. A `src` naming no photograph the day has
 * refuses the whole call rather than deleting the rest and leaving the
 * caller to notice which one silently did not land.
 *
 * The files are deleted before the day's own `media` is rewritten, on
 * purpose: a request that dies between the two steps leaves an entry
 * pointing at a file that is already gone — answering 404, which is safe —
 * never the other order, which would leave the file reachable at its old,
 * guessable URL after the day says it is not there. Same reasoning
 * `app/[user]/media/[...path]/route.ts` gives the photoVisibility label.
 *
 * A photobook or postcard order already referencing one of these files is
 * left untouched. Both resolve the photograph live, at send/print time
 * (`lib/postcard/send.ts`'s `orderPhotoFile`, `lib/photobook/source.ts`'s
 * `mediaFileFor`) rather than keeping a copy of the bytes, so deleting a
 * photograph a *pending* order names will make that order fail to send —
 * the same failure it would already have if an owner deleted the file by
 * hand. A completed order is unaffected: printing already happened, and an
 * order is a record of what was sent, not a live link to the file.
 */
export function detachGallery(
  ref: string,
  slug: string,
  srcs: string[],
):
  | { ok: true; removed: GalleryItem[] }
  | { ok: false; error: "unknown_day" }
  | { ok: false; error: "unknown_media"; problems: Problem[] } {
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return { ok: false, error: "unknown_day" };

  const wanted = new Map(srcs.map((src) => [mediaKey(src), src] as const));
  const matched: GalleryItem[] = [];
  const problems: Problem[] = [];
  for (const [key, src] of wanted) {
    const item = entry.gallery.find((g) => mediaKey(g.src) === key);
    if (item) matched.push(item);
    else {
      problems.push({
        field: "src",
        got: JSON.stringify(src),
        expected:
          "a src this day's gallery actually has — see the gallery in GET .../days/<slug>",
      });
    }
  }
  if (problems.length > 0)
    return { ok: false, error: "unknown_media", problems };

  for (const item of matched) deleteMediaFiles(ref, item);

  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (match) {
    const file = path.join(dir, match);
    const raw = fs.readFileSync(file, "utf8");
    try {
      const day = dayFromJson(slug, raw);
      const keys = new Set(matched.map((item) => mediaKey(item.src)));
      const remaining = (day.media ?? []).filter((item) => !keys.has(mediaKey(item.src)));
      const next: DayFile = { ...day, media: remaining.length ? remaining : undefined };
      // B643 — see `fileUnchangedSince`. The files themselves are already
      // deleted above regardless (on purpose, see the comment on this
      // function), so a refusal here only means the entry still names a file
      // that is now 404 — safe, and the caller can retry the removal against
      // whatever the day looks like now.
      if (fileUnchangedSince(file, raw)) {
        fs.writeFileSync(file, dayToJson(next));
      } else {
        console.warn(
          `[entries] ${ref}/${slug}: refused a gallery-removal write — the day changed under it. ` +
            "The deleted files still stay deleted.",
        );
      }
    } catch (err) {
      const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(`[entries] ${ref}/${slug}: could not rewrite media after a delete: ${said}`);
    }
  }

  forgetEntries(ref);
  return { ok: true, removed: matched };
}

/**
 * Every field `PATCH .../days/<slug>` may change. Deliberately not `status`
 * — see `editEntry` below, which is the whole point of B266.
 */
export const EDITABLE_DAY_FIELDS = [
  "title",
  "date",
  "time",
  "timezone",
  "location",
  "country",
  "countryCode",
  "lat",
  "lng",
  "content",
  "tags",
  "costs",
  "coordinates",
  "photos",
  "transportMode",
  "transportFrom",
  "transportTo",
  "travelScene",
  "test",
  "translations",
  "captions",
  "photoVisibility",
  "visibility",
  "weather",
  "weatherData",
] as const;

/** A partial `DraftInput` — every field optional, since a PATCH names only
 * what it is changing. `idempotency_key` is not among them: an edit is
 * naturally safe to repeat, since resending the same fields just writes the
 * same file again. */
export type EditInput = Partial<Omit<DraftInput, "idempotency_key">> & {
  /**
   * A caption per photograph, keyed by the item's `src` — the one part of the
   * day's `media` a PATCH may change (B522).
   *
   * The rest of each item is the server's: `src`, `width` and `height` are
   * measured off the file, and rewriting them from a request body is how a
   * day comes to point at photographs that are not there. So this edits the
   * `caption` of items that already exist and touches nothing else — a `src`
   * the day does not carry is refused rather than added (B540: it used to be
   * ignored, which made a typo look exactly like success), and an empty
   * string removes the caption it names.
   *
   * The key is forgiving about the owner prefix: a day read back over the API
   * carries `/<user>/media/…` while the file on disk carries `/media/…`, and
   * sending back what you were given has to work.
   */
  captions?: Record<string, string>;
  /**
   * A photograph held back from readers the trip otherwise lets in — B596,
   * keyed by `src` exactly as `captions` is, and `null` to clear a label.
   *
   * The same narrow rule applies: this edits one field inside items that
   * already exist. A `src` the day does not carry is refused rather than
   * added, because a label on a photograph nobody has is not a photograph.
   *
   * There is deliberately no way to say `public` here. A label narrows what
   * the trip's own `visibility` already decided and can never widen it, so
   * "everybody" is the absence of a label rather than a value of it — which
   * is what `null` writes. See lib/photos.ts.
   */
  photoVisibility?: Record<string, PhotoVisibility | null>;
  /**
   * This whole update, held back — B632, and `null` to clear it, the same
   * override `weatherData` gets below for the same reason: `DraftInput`'s own
   * `visibility` has no falsy value to send for "go back to being seen by
   * everyone the trip lets in", so an edit needs the wider type to say so.
   */
  /** Widened for B1650 (decision a): `false`/`"unknown"` are the same two
   * declines every other row answers with, read the same generic way by
   * `declinesIn`/the declined-map loop below. Both behave exactly as `null`
   * already did — cleared back to "shown to everyone the trip lets in" —
   * since a day's visibility has no separate "unrecorded" state worth
   * keeping apart from "no override" once it is already on disk. */
  visibility?: PhotoVisibility | null | false | typeof UNKNOWN;
  /** Ask for a lookup on a day already written — B325. `false` removes the
   * request; it does not remove a reading already recorded. */
  weather?: boolean;
  /** A reading the caller took themselves, or `null` to remove one. */
  weatherData?: DayWeather | null;
};

/** `Record<src, caption|"">`/`Record<src, PhotoVisibility|null>` applied to
 * a day's `media` — the one part of an edit that touches items rather than
 * scalar fields. Matched by `mediaKey`, forgiving of the owner prefix a
 * caller may send back exactly as it was given (see `EditInput.captions`). A
 * `src` the day does not carry has already been refused upstream
 * (`lib/validate/entry.ts`'s `checkCaptions`), so this only ever applies
 * matches it finds. */
function applyMediaFieldEdits(
  media: DayFile["media"],
  captions: Record<string, string> | undefined,
  photoVisibility: Record<string, PhotoVisibility | null> | undefined,
): DayFile["media"] {
  if (!media || (!captions && !photoVisibility)) return media;
  const captionMap = captions
    ? new Map(Object.entries(captions).map(([src, text]) => [mediaKey(src), text.trim()]))
    : undefined;
  const visMap = photoVisibility
    ? new Map(Object.entries(photoVisibility).map(([src, v]) => [mediaKey(src), v]))
    : undefined;
  return media.map((item) => {
    const key = mediaKey(item.src);
    const next = { ...item };
    if (captionMap?.has(key)) {
      const text = captionMap.get(key)!;
      if (text) next.caption = text;
      else delete next.caption;
    }
    if (visMap?.has(key)) {
      const v = visMap.get(key);
      if (v) next.visibility = v;
      else delete next.visibility;
    }
    return next;
  });
}

/**
 * `input`'s fields, applied onto `day` — the read-modify-write half of an
 * edit, shared between `editEntry` (object in, object out) and
 * `spliceEntryFields` below (raw JSON string in and out, for the two other
 * callers that still speak in file bytes: `lib/api/weather.ts` and
 * `lib/api/timezoneBackfill.ts`). A field present in `input` replaces
 * whatever the day already had for it; an empty/falsy value (`""`, `null`,
 * an empty list) clears it, mirroring the old textual splice's "rendered
 * line, or none" choice.
 */
function applyEditToDay(day: DayFile, input: EditInput): DayFile {
  const next: DayFile = { ...day };

  if (input.title !== undefined) next.title = input.title;
  if (input.date !== undefined) next.date = input.date;
  if (input.time !== undefined) {
    const real = realOf(input.time);
    if (real) next.time = real;
    else delete next.time;
  }
  if (input.timezone !== undefined) {
    if (input.timezone) next.timezone = input.timezone;
    else delete next.timezone;
  }
  if (input.location !== undefined) {
    if (input.location) next.location = input.location;
    else delete next.location;
  }
  if (input.country !== undefined) {
    if (input.country) next.country = input.country;
    else delete next.country;
  }
  if (input.countryCode !== undefined) {
    if (input.countryCode) next.countryCode = input.countryCode.toUpperCase();
    else delete next.countryCode;
  }
  // `coordinates` is one object on disk (v2) where `lat`/`lng` used to be two
  // independent scalar lines — an edit naming only one of them now merges
  // onto whatever the day already had for the other, rather than writing a
  // pair that no longer agrees with each other.
  if (input.lat !== undefined || input.lng !== undefined) {
    const lat = input.lat !== undefined ? input.lat : next.coordinates?.lat;
    const lng = input.lng !== undefined ? input.lng : next.coordinates?.lng;
    if (lat !== undefined && lng !== undefined) next.coordinates = { lat, lng };
  }
  if (input.tags !== undefined) {
    const real = realOf(input.tags);
    if (real?.length) next.tags = real;
    else delete next.tags;
  }
  if (input.transportMode !== undefined) {
    const real = realOf(input.transportMode);
    if (real) next.transportMode = real as DayFile["transportMode"];
    else delete next.transportMode;
  }
  if (input.transportFrom !== undefined) {
    if (input.transportFrom) next.transportFrom = input.transportFrom;
    else delete next.transportFrom;
  }
  if (input.transportTo !== undefined) {
    if (input.transportTo) next.transportTo = input.transportTo;
    else delete next.transportTo;
  }
  if (input.travelScene !== undefined) {
    if (input.travelScene) next.travelScene = input.travelScene as DayFile["travelScene"];
    else delete next.travelScene;
  }
  // B632. `null`, `false` and `"unknown"` all clear the label the same way —
  // "unknown" is truthy as a string, so it needs the same explicit exclusion
  // `realOf` gives the create path, just without `realOf` itself (this
  // field's decline is `false | null`, not `DraftInput`'s `false | UNKNOWN`
  // pairing alone, so the two are not quite the same shape).
  if (input.visibility !== undefined) {
    const real = input.visibility === UNKNOWN ? undefined : input.visibility;
    if (real) next.visibility = real;
    else delete next.visibility;
  }
  if (input.test !== undefined) {
    if (input.test === true) next.test = true;
    else delete next.test;
  }
  // Weather: one field on disk (B1598), two independent requests on the way
  // in. A bare `true` never overwrites a real reading — the reading already
  // answers the question a repeated ask raises. Withdrawing the request
  // (`weather: false`) never erases a reading either; there is nothing left
  // to withdraw once one exists.
  if (input.weather !== undefined) {
    if (input.weather === true) {
      if (typeof next.weather !== "object") next.weather = true;
    } else if (next.weather === true) {
      delete next.weather;
    }
  }
  if (input.weatherData !== undefined) {
    if (input.weatherData) next.weather = input.weatherData;
    else if (typeof next.weather === "object") delete next.weather;
  }
  if (input.costs !== undefined) {
    if (Array.isArray(input.costs) && input.costs.length) next.costs = input.costs as DayFile["costs"];
    else delete next.costs;
  }
  /**
   * The three declines, on an edit — B531, folded into v2's one `declined`
   * map (B1598).
   *
   * An edit that *supplies* what a day was missing has to clear the decline
   * as well, or the day would say both "here is what it cost" and "this day
   * has no money on it" at once.
   */
  {
    const declined: Record<string, string> = { ...(day.declined ?? {}) };
    for (const track of TRACKS) {
      const said = track === "costs" ? input.costs : input[track];
      if (said === undefined) continue;
      const key = DECLINE_KEY[track];
      // Three answers, and each one retracts the other two: a day cannot
      // sensibly say both that it had none of something and that nobody
      // knows how much of it there was. B560.
      delete declined[key];
      if (said === false) declined[key] = declineText(track, "no");
      else if (said === UNKNOWN) declined[key] = declineText(track, "unknown");
    }
    // Coordinates arrive as two fields rather than one, so they are the one
    // row an edit can answer without naming the row.
    if (input.lat !== undefined && input.lng !== undefined) {
      delete declined[DECLINE_KEY.coordinates];
    }
    next.declined = Object.keys(declined).length ? (declined as DayFile["declined"]) : undefined;
  }
  if (input.translations !== undefined) {
    const codes = Object.keys(input.translations ?? {});
    next.translations = codes.length ? input.translations : undefined;
  }
  if (input.captions !== undefined || input.photoVisibility !== undefined) {
    next.media = applyMediaFieldEdits(next.media, input.captions, input.photoVisibility);
  }
  if (input.content !== undefined) {
    next.content = input.content.trim();
  }

  return next;
}

/**
 * Splice `input`'s fields into a day's raw JSON text — the same
 * `applyEditToDay` `editEntry` uses below, wrapped for the two callers that
 * still speak in file bytes rather than in `DayFile` objects:
 * `lib/api/weather.ts` and `lib/api/timezoneBackfill.ts`. Neither had to
 * change when storage moved from markdown to JSON (B1598) — this is the
 * "flip the body, not the interface" trick applied to its own smallest
 * caller.
 *
 * Returns null when `markdown` (despite the name — it is JSON now) will not
 * parse — the caller's cue to leave a hand-shaped file alone and say so, same
 * as `attachGallery`.
 */
export function spliceEntryFields(
  markdown: string,
  input: EditInput,
): string | null {
  let day: DayFile;
  try {
    day = dayFromJson("", markdown);
  } catch {
    return null;
  }
  return dayToJson(applyEditToDay(day, input));
}

/** The two checks `validateEntryEdit` cannot make on its own: a field that is
 * present must not be present-and-empty. Mirrors `validateDraft`'s title,
 * date and content rules, but only for fields the caller actually sent. */
function validateEditPresence(input: EditInput): string | null {
  if (input.title !== undefined && input.title.trim() === "")
    return "title must not be empty";
  if (input.date !== undefined && !DATE_RE.test(input.date))
    return "date must be YYYY-MM-DD";
  if (input.content !== undefined && input.content.trim() === "")
    return "content must not be empty";
  return null;
}

/**
 * Edit a day that already exists — `PATCH .../days/<slug>`, B266.
 *
 * Before this there was no way to change a day once written, and the agent
 * that tried reached for `publishDraft` instead, because it was the only verb
 * that touched an existing file. This is the missing one, and it is built to
 * make that mistake structurally impossible rather than merely undocumented:
 * `EditInput` has no `status` field, so there is nothing in its type a caller
 * could set even by accident, and the two checks below confirm that on the
 * one file that matters — this write — rather than trusting the type alone.
 *
 * **Published stays published, draft stays draft — whatever the body asks
 * for.** `applyEditToDay` never touches `status`, and this asserts that
 * afterwards anyway — if it ever did, nothing is written and the caller is
 * told it hit a bug, rather than a published day silently reverting to a
 * draft or a draft silently going up.
 */
export function editEntry(
  ref: string,
  slug: string,
  input: EditInput,
):
  | {
      ok: true;
      slug: string;
      status: "draft" | "published";
      costCurrency?: string;
    }
  | { ok: false; error: string; bug?: true } {
  const problem = validateEditPresence(input);
  if (problem) return { ok: false, error: problem };

  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return { ok: false, error: "unknown_day" };

  const file = path.join(dir, match);
  let raw: string;
  let day: DayFile;
  try {
    raw = fs.readFileSync(file, "utf8");
    day = dayFromJson(slug, raw);
  } catch {
    return { ok: false, error: "unknown_day" };
  }
  const wasDraft = day.status === "draft";

  /**
   * The same stamp `createDraft` applies, on a day that already exists — a
   * `PATCH` naming `costs` needs the day's place, and this edit may not be
   * the one that named it: `country`/`lat`/`lng` fall back to what the file
   * already carries when the edit itself is silent about them.
   */
  let costCurrency: string | undefined;
  if (Array.isArray(input.costs) && input.costs.length > 0) {
    const place = {
      country: input.country !== undefined ? input.country : day.country,
      lat: input.lat !== undefined ? input.lat : day.coordinates?.lat,
      lng: input.lng !== undefined ? input.lng : day.coordinates?.lng,
    };
    const stamped = stampCostCurrencies(input.costs, place, journalBaseCurrency(ref));
    input = { ...input, costs: stamped.costs };
    costCurrency = stamped.applied;
  }

  // B1090, same rule as `createDraft`: an edit that supplies (or already
  // finds) coordinates and names no zone of its own gets one worked out —
  // unless the day already carries one, which is never overwritten.
  if (input.timezone === undefined) {
    const hasZone = typeof day.timezone === "string" && day.timezone.length > 0;
    const lat = input.lat !== undefined ? input.lat : day.coordinates?.lat;
    const lng = input.lng !== undefined ? input.lng : day.coordinates?.lng;
    if (!hasZone && lat !== undefined && lng !== undefined) {
      const zone = timezoneForCoordinates(lat, lng);
      if (zone) input = { ...input, timezone: zone };
    }
  }

  const next = applyEditToDay(day, input);

  if (next.status !== day.status) {
    return {
      ok: false,
      bug: true,
      error:
        `Editing "${slug}" would have changed whether it is published, so nothing was written. ` +
        "This is a bug; please report it.",
    };
  }

  // B643 — see `fileUnchangedSince`. `raw` was read at the top of this
  // function and every check above was made against it; if the file has
  // moved since, writing `next` now would silently erase whatever wrote it,
  // because `next` was built from a copy that predates that change.
  if (!fileUnchangedSince(file, raw)) {
    console.warn(
      `[entries] ${ref}/${slug}: refused an edit — the day changed under it.`,
    );
    return {
      ok: false,
      error:
        `"${slug}" changed while this edit was being applied — something else wrote to this day ` +
        "at the same time, and writing this edit now would have erased that other change. " +
        "Nothing was written; read the day back and send this edit again.",
    };
  }

  fs.writeFileSync(file, dayToJson(next));
  forgetEntries(ref);
  return {
    ok: true,
    slug,
    status: wasDraft ? "draft" : "published",
    ...(costCurrency ? { costCurrency } : {}),
  };
}

/**
 * Whether `candidateSlug` is free in a trip's entries — the same question
 * `createDraft` asks a brand-new day, asked again for a rename (B1276).
 * Exported so the wizard's write-up PATCH can refuse a colliding title
 * *before* writing anything, the same "leave nothing half-done" shape
 * `createDraft`'s own `slug_taken` refusal already has.
 */
export function slugAvailable(ref: string, candidateSlug: string): boolean {
  return entryFileWithSlug(entriesDirOf(ref), candidateSlug) === null;
}

/**
 * Rename a draft's slug to match a real title — B1276.
 *
 * The wizard writes a day with no title yet (B1442), so its file sits under a
 * numbered placeholder slug (`day`, `day-2`, …) until somebody actually says
 * what the day was. The first time a real title arrives this gives the day
 * the address its content deserves, instead of leaving every day permanently
 * reachable only by a placeholder.
 *
 * **Forward only, and draft only.** The caller (`app/api/helper/[user]/day/
 * route.ts`) is expected to call this only while `editEntry`'s own answer
 * still says `"draft"` — a published day's URL may already be in somebody's
 * email, and retroactively renaming it is the exact incident this ticket
 * exists to prevent. This function does not itself re-check publish status;
 * it trusts the caller, the same way `renameDayMedia` trusts this one.
 *
 * Moves everything a slug names, together: the entry file, its `media/` and
 * `originals/` directories, its fingerprint cache, and every gallery
 * `src`/`poster` pointing at the old media directory. A half-finished rename
 * would 404 a photograph, so a failure partway through puts back whatever
 * already moved — sequenced rather than four independent `renameSync` calls,
 * which is as close to a transaction as one process writing to one disk needs
 * to be.
 *
 * The caller is expected to have already refused a colliding slug with
 * `slugAvailable` before writing anything; this re-checks anyway, because
 * disk state can change between that check and this call, and a collision
 * found here still has to leave the day exactly where it was.
 */
export function renameEntrySlug(
  ref: string,
  oldSlug: string,
  newSlug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, oldSlug);
  if (!match) return { ok: false, error: "unknown_day" };
  // Not the literal string "slug_taken" here — that code already exists
  // (createDraft's own collision refusal, further up this file) and is
  // documented in lib/api/errorCodes.ts; a second literal spelling it out
  // would only be this function repeating the same fact for the openapi
  // contract test to find twice.
  if (entryFileWithSlug(dir, newSlug)) {
    return { ok: false, error: `an entry already exists with the slug "${newSlug}"` };
  }

  const parsed = parseTripRef(ref);
  if (!parsed) return { ok: false, error: "unknown_trip" };

  const oldFile = path.join(dir, match);
  const date = match.slice(0, 10);
  const newFile = path.join(dir, `${date}-${newSlug}.json`);

  const raw = fs.readFileSync(oldFile, "utf8");
  const prefix = `/media/${parsed.tripId}/${oldSlug}/`;
  const replacement = `/media/${parsed.tripId}/${newSlug}/`;
  const rewritten = raw.split(prefix).join(replacement);

  const media = renameDayMedia(ref, oldSlug, newSlug);
  if (!media.ok) return { ok: false, error: media.error };

  try {
    fs.writeFileSync(oldFile, rewritten);
    fs.renameSync(oldFile, newFile);
  } catch (err) {
    // Put the media back — a half-finished rename must never leave a
    // photograph pointing at a directory nothing else knows about — and
    // restore the file's original content, whether or not the write above is
    // what actually threw.
    renameDayMedia(ref, newSlug, oldSlug);
    try {
      fs.writeFileSync(oldFile, raw);
    } catch {
      // Best effort; the thrown error below is what the caller acts on.
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  forgetEntries(ref);
  return { ok: true, slug: newSlug };
}

/**
 * What publishing this particular day did — written once, for both doors.
 *
 * It was the refusal's question until B224 and is the receipt now, which is a
 * change of tense and not of purpose: it is still the sentence that tells
 * somebody what just became readable, and it is still what the agent reads out
 * to them. Until B158 it promised the feed and the search index to every day
 * alike, and for a `test: true` day none of that half is true: `lib/feed.ts`,
 * `lib/search.ts` and the sitemap all exclude content nobody lived, so it
 * described a different day than the one it was about.
 *
 * The test wording is shorter and more reassuring rather than more alarming,
 * because that is what is actually the case: the page goes up wearing a banner
 * that says it did not happen, and nothing goes looking for it.
 *
 * One function, because a sentence kept in two files disagrees with itself
 * within a month — which is exactly how the two copies of this one came to
 * differ before B158 merged them.
 */
export function publishNotice(input: {
  title: string;
  date: string;
  /** Where the day will be, so the person hears the address they are agreeing to. */
  url: string;
  /** `isTestContent(trip, entry)` — the trip's flag counts, not just the day's. */
  test: boolean;
  /**
   * The trip's own `visibility:` — B775.
   *
   * Until then this said "the feed, the search index, and anyone with the
   * link" to every publisher alike, and on a closed trip all three were
   * false: `lib/feed.ts` and `lib/search.ts` carry public trips only, and a
   * stranger with the link meets the sign-in gate. It was false in the
   * frightening direction, too — an owner who chose `guest` so that
   * strangers could not read their trip was told by the software that they
   * now can, and the obvious reaction is to take down something that was
   * never exposed.
   *
   * So the sentence names *who* can read it rather than only how far it
   * went, which is the question the person was actually asking.
   */
  visibility: TripVisibility;
  /**
   * `listed: false` on a public trip keeps it out of the feed, the search
   * index and the sitemap while leaving it readable by anyone with the link
   * — half of the old sentence true and half of it not.
   */
  listed?: boolean;
  /**
   * The journal's own language — B805.
   *
   * The guide tells the agent to read this sentence out rather than
   * paraphrase it, which is right and which also means it reaches the person
   * verbatim. In English, to a German owner, including the word `guest` —
   * met as an untranslated English noun inside an otherwise German flow, on
   * exactly the distinction (a guest of the journal, not of the trip) this
   * project already knows people get wrong.
   *
   * Defaults to English so the two doors that do not know a journal — and
   * the tests written before this — read as they always did.
   */
  locale?: string;
}): string {
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translateIn(input.locale ?? "en", key, vars);

  const head = t("publish.head", {
    title: input.title,
    date: input.date,
    url: input.url,
  });
  const tail = t("publish.tail");

  if (input.visibility !== "public") {
    // Nothing about the feed, the search index or a link: none of them
    // applies to a closed trip, and naming them here is what made the old
    // sentence frightening. Who can read it is the whole answer.
    //
    // The visibility itself is a *word*, not the raw value: `guest` is the
    // vocabulary of the config file, and a person reading this sentence in
    // German needs the German for it.
    const who = t(
      input.visibility === "guest" ? "publish.whoGuest" : "publish.whoPrivate",
    );
    const closed = t("publish.closed", {
      visibility: t(
        input.visibility === "guest"
          ? "publish.visibilityGuest"
          : "publish.visibilityPrivate",
      ),
      who,
    });
    return [
      head,
      closed,
      ...(input.test ? [t("publish.testClosed")] : []),
      tail,
    ].join(" ");
  }

  if (input.test) {
    return [head, t("publish.testPublic"), tail].join(" ");
  }

  return [
    head,
    t(input.listed === false ? "publish.unlisted" : "publish.listed"),
    tail,
  ].join(" ");
}

/**
 * Publish a draft: flip its `status` from `"draft"` to `"published"`.
 *
 * Until B28 the only way to do this was to open the file in a text editor and
 * delete `status: draft` by hand. That is fine for the author on their own
 * laptop, and useless to somebody who was handed a journal by an agent and has
 * never seen the folder — which, since journal creation over the API exists, is
 * now a real person. The guide told them four times that "a person publishes
 * it" and never once said how.
 *
 * **Publishing is the agent's to do, once asked** (B223). What survives from
 * the older rule is only the shape: writing and publishing are two calls, so
 * there is a moment where the day exists and nobody has read it. The
 * confirmation handshake that used to guard the second call went in B224 — it
 * never established that anybody consented, since the agent held both codes.
 *
 * Read-modify-write of the one JSON file: every other field the day carries
 * survives untouched, since only `status` changes.
 */
export function publishDraft(
  ref: string,
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  let day: DayFile;
  try {
    day = dayFromJson(slug, raw);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, error: `"${slug}" cannot be parsed (${said})` };
  }
  if (day.status !== "draft") {
    // Not an error worth a 500, and not silently fine either: an agent that
    // publishes twice should be told the second call did nothing rather than
    // reporting success to somebody.
    return { ok: false, error: `"${slug}" is already published` };
  }

  const next: DayFile = { ...day, status: "published" };

  // B643 — see `fileUnchangedSince`. Publishing is the one call in this file
  // an owner waits for and means as final; writing it from a copy a second
  // writer has since moved past would be the worst place of all for this to
  // happen silently.
  if (!fileUnchangedSince(file, raw)) {
    console.warn(
      `[entries] ${ref}/${slug}: refused a publish — the day changed under it.`,
    );
    return {
      ok: false,
      error:
        `"${slug}" changed while this was being published — something else wrote to this day at ` +
        "the same time, and publishing now would have erased that other change. Nothing was " +
        "written; read the day back and publish it again.",
    };
  }
  fs.writeFileSync(file, dayToJson(next));
  forgetEntries(ref);
  return { ok: true, slug };
}

/**
 * Take a published day back off the site — B816.
 *
 * The inverse of `publishDraft` above, and the reason it exists rather than a
 * second `deleteEntry`: somebody in a photograph asks to come out of it, and
 * the only answer the browser had was a permanent delete that also orphans
 * every photograph on the day. A takedown a person can undo is the right shape
 * for a request made on somebody else's behalf — the day goes back to being a
 * draft, off the site, and publishing it again is the undo.
 */
export function unpublishEntry(
  ref: string,
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  let day: DayFile;
  try {
    day = dayFromJson(slug, raw);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, error: `"${slug}" cannot be parsed (${said})` };
  }
  if (day.status === "draft") {
    // Not an error worth a 500, and not silently fine either — the same
    // reasoning as publishing something already published.
    return { ok: false, error: `"${slug}" is not on the site` };
  }

  const next: DayFile = { ...day, status: "draft" };

  // B643 — the same guard publishing has, and for the same reason: writing
  // from a copy a second writer has since moved past would erase their change.
  if (!fileUnchangedSince(file, raw)) {
    console.warn(
      `[entries] ${ref}/${slug}: refused a takedown — the day changed under it.`,
    );
    return {
      ok: false,
      error:
        `"${slug}" changed while it was being taken down — something else wrote to this day at ` +
        "the same time. Nothing was written; read the day back and take it down again.",
    };
  }
  fs.writeFileSync(file, dayToJson(next));
  forgetEntries(ref);
  return { ok: true, slug };
}

/**
 * Entries awaiting a human, for the review queue.
 *
 * `test` is carried out with them, resolved the way every other surface
 * resolves it — `isTestContent`, so a day that inherits the flag from its trip
 * is flagged even though its own file says nothing (B134). This is the list an
 * agent is instructed to read back to a person **at the moment they decide
 * what goes on the site**, and a queue of five drafts that does not say two of
 * them are inventions hands somebody a decision without the fact that decides
 * it.
 *
 * The trip is read once, here, rather than per file: this function reads each
 * file directly with `dayFromJson` instead of going through `getAllEntries`,
 * so it has to fetch the trip itself, and `getTrip` is a memoised read of the
 * same folder either way.
 *
 * Only when true, like every other flag on these surfaces. Absent means real.
 */
export function listDrafts(
  ref: string,
): { slug: string; title: string; date: string; test?: true }[] {
  const dir = entriesDirOf(ref);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const trip = getTrip(ref);
  const drafts: { slug: string; title: string; date: string; test?: true }[] =
    [];
  for (const file of files) {
    const slug = entrySlugFromFile(file);
    let day: DayFile;
    try {
      day = dayFromJson(slug, fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      // Same failure `readAllEntries` guards against (B236): a file that
      // will not parse must not blank out the review queue for every other
      // draft in the trip. Skipped and logged rather than thrown.
      const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(
        `[entries] ${ref}/entries/${file}: could not be parsed: ${why}`,
      );
      continue;
    }
    if (day.status !== "draft") continue;
    drafts.push({
      slug,
      title: day.title,
      date: day.date,
      ...(isTestContent(trip, { test: day.test === true }) ? { test: true as const } : {}),
    });
  }
  return drafts.sort((a, b) => a.date.localeCompare(b.date));
}

/** The shape the API returns for a trip. Deliberately not the internal type. */
export function tripSummary(username: string, tripId: string) {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return null;
  const gaps = tripGaps(trip.ref, false);
  return {
    id: trip.id,
    ref: trip.ref,
    title: trip.title,
    tagline: trip.tagline,
    start: trip.start,
    end: trip.end,
    status: trip.status,
    visibility: trip.visibility,
    // Beside visibility, because it is the other half of the same answer and
    // `/openapi.json` has promised it since W27 without it ever being sent.
    // An agent that asked for `listed: false` needs to be able to see that it
    // took — which, until B51, it had not.
    listed: trip.listed,
    // Echoed only when true, like `test` below: a closed trip that says
    // nothing about itself is every trip's default, and an agent that asked
    // for a teaser card needs to see that it took. B587.
    ...(trip.teaser ? { teaser: true } : {}),
    // Echoed only when true, like every other flag here. Absent until B47,
    // which meant an agent that set it was never told it had been accepted and
    // could not see it afterwards — on the one field whose whole job is to say
    // "none of this happened".
    ...(trip.test ? { test: true } : {}),
    days: getDays(trip.ref).length,
    entries: getAllEntries(trip.ref).length,
    drafts: listDrafts(trip.ref).length,
    /**
     * What every day written into this trip is asked for — B531.
     *
     * Here rather than only in the refusal, because a contract an agent first
     * meets as a 422 is one it meets after it has already decided what to
     * send. This is the list an agent reads before it writes anything.
     */
    tracks: trip.tracks,
    /**
     * The two numbers that would have said, in the call an agent already
     * makes, that fourteen days had gone up without their money and that a
     * date in the middle of the trip had no day at all — B532. Counts only
     * here; `GET .../costs` names the dates.
     */
    daysWithCosts: gaps?.daysWithCosts ?? 0,
    datesWithoutADayCount: gaps?.datesWithoutADayCount ?? 0,
  };
}

/**
 * The shape the API returns for one day in a list.
 *
 * The trip is a **required** argument rather than an optional one, and that is
 * the whole point of B116. `test` is inherited: a day inside a trip marked
 * `test: true` carries no flag of its own, so a summary built from the entry
 * alone reports invented content as though somebody had lived it. Requiring
 * the trip means a caller that has not answered the question does not compile,
 * instead of quietly answering it wrong.
 *
 * Only when true, like every other flag on these surfaces — absent means real,
 * which is what `tripSummary` above already says. `draft` follows the same
 * rule: absent means published, so a caller that already filters drafts out
 * never grows a field it has no use for, and a caller that asked for them
 * (`GET .../days`, B296) can tell which is which.
 */
export function entrySummary(entry: Entry, trip: Trip | undefined) {
  return {
    slug: entry.slug,
    title: entry.title,
    date: entry.date,
    time: entry.time,
    ...(entry.timezone ? { timezone: entry.timezone } : {}),
    location: entry.location,
    country: entry.country,
    ...(entry.countryCode ? { countryCode: entry.countryCode } : {}),
    lat: entry.lat,
    lng: entry.lng,
    photos: entry.gallery.length,
    ...(entry.draft ? { draft: true } : {}),
    ...(isTestContent(trip, entry) ? { test: true } : {}),
    ...(entry.visibility ? { visibility: entry.visibility } : {}),
  };
}

/**
 * Removes one day's JSON file.
 *
 * A published day may be deleted, but only by a caller that has said so — the
 * route asks `lib/agentConfirm.ts` for a `delete_published` confirmation
 * first, which is a different signature from the one that removes a draft, so
 * an agent cannot drift from tidying up its own unpublished scrap into
 * deleting something somebody's family has read.
 *
 * The photographs stay either way. They are shared with whatever else that day
 * held, an entry can be rewritten, and a deleted original cannot be recovered.
 */
export function deleteEntry(
  ref: string,
  slug: string,
  options: { allowPublished?: boolean } = {},
): DeleteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  let published: boolean;
  try {
    published = dayFromJson(slug, fs.readFileSync(file, "utf8")).status !== "draft";
  } catch {
    // A file that will not parse carries no readable status — treated as
    // published, the safer side of the same asymmetry `dayFromJson` itself
    // applies (a file this cannot read confidently must not act as a draft
    // nobody need confirm deleting).
    published = true;
  }
  if (published && !options.allowPublished) {
    return {
      ok: false,
      error:
        `"${slug}" is published. Deleting it needs its own confirmation — ` +
        `repeat the request without a code to be issued one.`,
    };
  }

  fs.rmSync(file);
  // The disk is the truth; the cache has to be told.
  forgetEntries(ref);
  return { ok: true, slug, published };
}

/**
 * Whether a day is on the site, for callers that must decide *before* acting.
 *
 * The delete route needs it to choose which confirmation to demand, and that
 * choice has to be made before anything is removed. Answers false for a slug
 * that does not exist: a caller about to be told "no such entry" should be
 * asked the milder question on the way there.
 */
export function isPublished(ref: string, slug: string): boolean {
  const dir = entriesDirOf(ref);
  const match = entryFileWithSlug(dir, slug);
  if (!match) return false;
  try {
    return dayFromJson(slug, fs.readFileSync(path.join(dir, match), "utf8")).status !== "draft";
  } catch (err) {
    // A file that will not parse carries no readable `status`, and
    // `dayFromJson` already treats anything other than exactly "published"
    // as a draft on a successful parse — but a parse failure itself is
    // answered the other way here, the same asymmetry `deleteEntry` applies:
    // "cannot be read" must not be mistaken for "safe to delete as a draft".
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `[entries] ${ref}/entries/${match}: could not be parsed: ${why}`,
    );
    return true;
  }
}
