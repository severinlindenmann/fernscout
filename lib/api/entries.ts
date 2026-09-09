import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isTestContent } from "../access";
import { loadUserConfig } from "../config";
import { CURRENCY_FOR_COUNTRY } from "../countryCurrency";
import { normalizeCurrency } from "../currency";
import {
  AS_AUTHOR,
  clearMatterCache,
  entrySlugFromFile,
  fileUnchangedSince,
  forgetEntries,
  getAllEntries,
  getDays,
  getEntryBySlug,
  isDraft,
} from "../entries";
import { countryCodeFor } from "../flags";
import type { TranslationKey } from "../i18n";
import { translateIn } from "../locales";
import { getUser } from "../users";
// The same splicer ingest uses. One way of writing a gallery into an entry
// that already exists, so the two doors cannot drift apart in how they format
// it or in what they preserve of a file somebody has since edited.
import { appendGallery } from "../ingest/entry";
import { reverseGeocode } from "../ingest/geo";
// One slugify for the whole codebase (B77). This module used to carry its
// own, which stripped a German umlaut down to its bare vowel and disagreed
// with the one ingest used — the same title, two permanent URLs.
import { slugify } from "../slug.ts";
import { mediaKey, type PhotoVisibility } from "../photos";
import { deleteMediaFiles } from "./media";
import { getTrip, parseTripRef, tripDir, tripRef } from "../trips";
import type { Entry, GalleryItem, Trip, TripVisibility } from "../types";
import type { Problem } from "../validate/media";
import {
  UNKNOWN,
  TRACKS,
  parseUnrecorded,
  parseWithout,
  unrecordedLine,
  withoutLine,
  type DayFacts,
  type Track,
} from "../tracks";
import { tripGaps } from "./tripGaps";
import { quoteScalar } from "../validate/frontmatter";
import { type DayWeather, weatherLine } from "../weather";

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
 * Writes go straight to markdown files, because markdown files are the content
 * model. There is no second representation to keep in step, and anything an
 * agent writes can be read, corrected or reverted with a text editor.
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
  title: string;
  date: string;
  time?: string;
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
  tags?: string[];
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
  visibility?: PhotoVisibility;
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
   * `false` is written to the entry as `without: [...]`, `"unknown"` as
   * `unrecorded: [...]`, and never as the field itself.
   */
  coordinates?: false | typeof UNKNOWN;
  photos?: false | typeof UNKNOWN;
  /** How the day was travelled. Same story as `costs` — validated since W29,
   * written since W38. */
  transportMode?: string;
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

/**
 * YAML-safe double-quoted scalar — shared with the trip writer.
 *
 * It was a private copy of the same two escapes, and neither copy escaped a
 * newline, so a `location` or a `transportFrom` containing one closed the
 * frontmatter block from inside the value and wrote an entry that no reading
 * path could parse. Same bug as B204, one file over; the fix is the one
 * quoter both writers call.
 */
const quote = quoteScalar;

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
 * The `costs:` block, in the flow style the hand-written entries use.
 *
 * `currency` is omitted when absent rather than guessed: a cost with no
 * currency is read as the journal's base currency, which is the right default
 * and not a value this should bake into the file. `category` falls back to
 * "other", which is what `lib/costs.ts` would read anyway — written out so the
 * file says what it means.
 */
// Exported since B295: the costs door writes a trip's preparation costs in
// this identical shape, and reuses this renderer rather than a second copy.
export function costLines(costs: CostInput[] | undefined): string[] {
  if (!costs?.length) return [];
  return [
    "costs:",
    ...costs.map((cost) => {
      const fields = [
        `label: ${quote(cost.label)}`,
        `amount: ${cost.amount}`,
        `category: ${quote(cost.category?.trim() || "other")}`,
        ...(cost.currency?.trim()
          ? [`currency: ${quote(cost.currency.trim().toUpperCase())}`]
          : []),
      ];
      return `  - { ${fields.join(", ")} }`;
    }),
  ];
}

/**
 * The `translations:` block — B294.
 *
 * Block style rather than flow, unlike `costs:` one function up, because the
 * values are prose: a day's content in another language is a paragraph, and
 * `{ title: …, content: … }` on one line would be a line hundreds of
 * characters long that no owner opening the file could read. `content` goes
 * out as a literal block scalar (`|-`) for the same reason and so that a
 * newline inside somebody's writing survives a round trip.
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
    lines.push(`    title: ${quote(tr.title)}`);
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
  if (typeof input.title !== "string" || input.title.trim() === "") {
    return "title is required";
  }
  if (typeof input.date !== "string" || !DATE_RE.test(input.date)) {
    return "date is required, as YYYY-MM-DD";
  }
  if (input.time !== undefined && !TIME_RE.test(String(input.time))) {
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
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    // No entries directory yet — the first day in a trip collides with nothing.
    return null;
  }
  return files.find((f) => entrySlugFromFile(f) === slug) ?? null;
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
 * `matter` the reader uses, which is the only step in `readAllEntries` that
 * can fail on a file this function wrote.
 *
 * Three questions, and the last two matter as much as the first. A frontmatter
 * block that ends early does not always fail to parse — it can parse into
 * something *else*, with the rest of the block landing in the prose. So the
 * title and date are asserted to read back as they were written, and the day
 * is asserted to still be a draft: an entry that reported `status: draft` and
 * reads back as published is the one failure here that is worse than an
 * invisible file.
 */
function draftDoesNotReadBack(file: string, input: DraftInput): string | null {
  let data: Record<string, unknown>;
  try {
    data = matter(fs.readFileSync(file, "utf8")).data;
  } catch (err) {
    const said =
      err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `its frontmatter does not parse (${said})`;
  }
  if (String(data.title ?? "") !== input.title) {
    return "its title does not read back as it was written";
  }
  if (String(data.date ?? "") !== input.date) {
    return "its date does not read back as it was written";
  }
  if (!isDraft(data)) {
    return 'it does not read back as "status: draft"';
  }
  return null;
}

/**
 * Create a draft entry.
 *
 * Refuses to overwrite: an agent retrying a request must not silently replace
 * yesterday's writing. The caller gets the existing slug back and can decide.
 */
/**
 * The rows this call declines — B531.
 *
 * One place, because a write and an edit have to agree about it, and because
 * `costs: false` living in the same field as a list of costs is the sort of
 * thing that is read wrong once per reader otherwise.
 */
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

/** The three rows are answered on three differently-typed fields; this is the
 * one place that knows which. */
function answerFor(input: Partial<DraftInput>, key: Track): unknown {
  return key === "costs" ? input.costs : input[key as "coordinates" | "photos"];
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
    without: entry.without ?? [],
    unrecorded: entry.unrecorded ?? [],
  };
}

export function createDraft(ref: string, input: DraftInput): WriteResult {
  const problem = validateDraft(input);
  if (problem) return { ok: false, error: problem };

  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const slug = slugify(input.title);
  const dir = path.join(tripDir(ref), "entries");
  const file = path.join(dir, `${input.date}-${slug}.md`);

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

  const { costs: stampedCosts, applied: costCurrency } = stampCostCurrencies(
    costLinesOf(input),
    input,
    journalBaseCurrency(ref),
  );

  const lines = [
    "---",
    `title: ${quote(input.title)}`,
    `date: ${quote(input.date)}`,
    ...(input.time ? [`time: ${quote(input.time)}`] : []),
    ...(input.timezone ? [`timezone: ${quote(input.timezone)}`] : []),
    ...(input.location ? [`location: ${quote(input.location)}`] : []),
    ...(input.country ? [`country: ${quote(input.country)}`] : []),
    ...(input.countryCode
      ? [`countryCode: ${quote(input.countryCode.toUpperCase())}`]
      : []),
    ...(input.lat !== undefined ? [`lat: ${input.lat}`] : []),
    ...(input.lng !== undefined ? [`lng: ${input.lng}`] : []),
    ...(input.tags?.length
      ? [`tags: [${input.tags.map(quote).join(", ")}]`]
      : []),
    ...(input.transportMode
      ? [
          `transportMode: ${quote(input.transportMode)}`,
          `transportFrom: ${quote(input.transportFrom ?? "")}`,
          `transportTo: ${quote(input.transportTo ?? "")}`,
        ]
      : []),
    ...(input.travelScene ? [`travelScene: ${quote(input.travelScene)}`] : []),
    // B632, the entry's own label — see the field's doc comment on DraftInput.
    ...(input.visibility ? [`visibility: ${quote(input.visibility)}`] : []),
    // The request, written only when it is one — a `weather: false` line on
    // every day would be noise in a file people read and edit by hand.
    ...(input.weather === true ? ["weather: true"] : []),
    // A hand-supplied reading. The lookup writes this line too, from the
    // route, once the fetch comes back.
    ...(input.weatherData ? [weatherLine(input.weatherData)] : []),
    ...translationLines(input.translations),
    ...costLines(stampedCosts),
    // What this day says it deliberately does not have. B531 — the line that
    // makes "nothing was spent" different from "nobody asked".
    ...withoutLine(declinedIn(input)),
    ...unrecordedLine(unrecordedIn(input)),
    // Written only when true — see the note on NewTrip.test.
    ...(input.test === true ? ["test: true"] : []),
    // The line that keeps a person in the loop. Removing it publishes.
    "status: draft",
    "---",
    "",
    input.content.trim(),
    "",
  ];

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  // A new draft is invisible to readers, but not to the owner's own view of
  // their site (W31) — and to the API that is about to be asked whether it
  // exists. Same reason as the delete below.
  forgetEntries(ref);

  /**
   * Read it back rather than trusting the write — B208, the day half of B204.
   *
   * `quoteScalar` means there is no known input that produces a file this
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
          : ` — and the file could not be removed, so "${slug}" is taken until somebody deletes ${input.date}-${slug}.md on the server.`) +
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
 * The splice is textual, and `appendGallery` is the one ingest uses for the
 * same job — the frontmatter is not parsed and re-emitted, because by the time
 * a second batch arrives somebody may have fixed the title, written the prose
 * and added captions, and a YAML round-trip would restyle all of it.
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

  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: `no entry "${slug}" in this trip` };
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  const spliced = appendGallery(raw, items);
  if (spliced === null) {
    // A file with no frontmatter block is one somebody wrote by hand in a shape
    // this cannot edit safely. Say so; do not guess.
    return {
      ok: false,
      error:
        `"${slug}" has no frontmatter block to write a gallery into. The photographs ` +
        `are on disk under this day; add them to the entry by hand.`,
    };
  }

  // B528 — the same guard `editEntry` runs before every write: a splice that
  // produces text `gray-matter` cannot parse back would be written silently
  // otherwise, and a day written unparseable is invisible at every reading
  // path and undeletable through the API (see B204). The photographs are
  // already on disk by this point, so the refusal below can say so.
  try {
    void matter(spliced).data;
  } catch (err) {
    const said =
      err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error:
        `Attaching these photographs would leave "${slug}" unparseable (${said}), so nothing ` +
        `was written. The photographs are already stored (see \`kept\`) — this is a bug; ` +
        "please report it.",
    };
  }

  // B643 — see `fileUnchangedSince`. The photographs themselves are already
  // on disk by this point (`storeUploads` wrote them before this was ever
  // called), so refusing here does not lose them: it only refuses to write a
  // gallery block computed from a copy of the day that a second writer has
  // since moved past, which would otherwise silently take that writer's
  // change down with it.
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

  fs.writeFileSync(file, spliced);
  forgetEntries(ref);
  return { ok: true, attached: items.length };
}

/**
 * Remove whole items from a `gallery:` block, keyed by `mediaKey` — the
 * removal counterpart to `spliceGalleryField` below, which only ever
 * rewrites one line inside an item that survives. This one drops the item
 * outright: `src`, `width`, `caption` and all.
 *
 * Walked backwards for the same reason `spliceGalleryField` is: each splice
 * moves every line after it, and starting from the end leaves the indices
 * still ahead of the cursor valid. The `gallery:` key itself is dropped too
 * once nothing is left under it — the same rule `spliceCosts` and
 * `spliceTranslations` apply to an emptied block.
 *
 * `null` only for "no frontmatter block at all" or "no gallery: key at all"
 * — `detachGallery` below has already matched `keys` against a gallery this
 * same file's `getEntryBySlug` read back, so reaching either case here would
 * be a bug in that match, not a caller mistake to explain to an agent.
 */
function removeGalleryItems(
  markdown: string,
  keys: Set<string>,
): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const galleryAt = lines.findIndex(
    (line, i) => i > 0 && i < closing && /^gallery:\s*$/.test(line),
  );
  if (galleryAt < 0) return null;

  let end = galleryAt + 1;
  while (end < closing && /^\s+\S/.test(lines[end])) end++;

  const starts: number[] = [];
  for (let i = galleryAt + 1; i < end; i++)
    if (/^\s*-\s/.test(lines[i])) starts.push(i);

  for (let n = starts.length - 1; n >= 0; n--) {
    const from = starts[n];
    const to = n + 1 < starts.length ? starts[n + 1] : end;
    const item = lines.slice(from, to);
    const srcAt = item.findIndex((line) => /^\s*-?\s*src:/.test(line));
    if (srcAt < 0) continue;
    const src = item[srcAt]
      .replace(/^\s*-?\s*src:\s*/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!keys.has(mediaKey(src))) continue;
    lines.splice(from, to - from);
    closing -= to - from;
    end -= to - from;
  }

  // Nothing left under `gallery:` — drop the key line too.
  if (end === galleryAt + 1) lines.splice(galleryAt, 1);

  return lines.join("\n");
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
 * The files are deleted before the frontmatter is rewritten, on purpose: a
 * request that dies between the two steps leaves a `gallery:` line pointing
 * at a file that is already gone — answering 404, which is safe — never the
 * other order, which would leave the file reachable at its old, guessable
 * URL after the day says it is not there. Same reasoning `app/[user]/media/
 * [...path]/route.ts` gives the photoVisibility label.
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

  const dir = path.join(tripDir(ref), "entries");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (match) {
    const file = path.join(dir, match);
    const raw = fs.readFileSync(file, "utf8");
    const spliced = removeGalleryItems(
      raw,
      new Set(matched.map((item) => mediaKey(item.src))),
    );
    // B643 — see `fileUnchangedSince`. The files themselves are already
    // deleted by `deleteMediaFiles` above regardless (on purpose, see the
    // comment on this function), so a refusal here only means the entry
    // still names a file that is now 404 — safe, and the caller can retry
    // the removal against whatever the day looks like now.
    if (spliced !== null) {
      if (fileUnchangedSince(file, raw)) {
        fs.writeFileSync(file, spliced);
      } else {
        console.warn(
          `[entries] ${ref}/${slug}: refused a gallery-removal write — the day changed under it. ` +
            "The deleted files still stay deleted.",
        );
      }
    }
  }

  forgetEntries(ref);
  return { ok: true, removed: matched };
}

/**
 * Every field `PATCH .../days/<slug>` may change. Deliberately not `status`
 * — see `editEntry` below, which is the whole point of B266.
 *
 * `coordinates` and `photos` joined this list in B599, `"unknown"` only —
 * `false` stays create-only, refused by `checkDeclines` in
 * lib/validate/entry.ts with a message that says why, rather than by simply
 * never reaching a validator at all. Before this a day could be told *the
 * money is gone* after the fact and not *the pictures are gone*, though
 * `openapi.json` had documented the second as the whole point of the third
 * answer — "they can be added later; the day does not have to wait" said
 * nothing about a day already written not being allowed to say it.
 */
/**
 * The journal's declared languages, for B294's completeness refusal.
 *
 * `locales` is what a reader may switch into and `writtenLocale` is the
 * language the prose itself is in — so a day owes a translation for every
 * locale except that one. Read per request rather than cached: an owner can
 * change both with one `PATCH .../config` (B220), and a day written a minute
 * later must be judged against what the journal says now.
 *
 * Here rather than in the route that first needed it, because B980 gave the
 * owner's own browser a second door onto `editEntry` and the two must judge a
 * day by the same languages.
 */
export function journalLanguages(
  user: string,
): { locales: readonly string[]; writtenLocale: string } | undefined {
  const journal = getUser(user);
  if (!journal) return undefined;
  return { locales: journal.locales, writtenLocale: journal.defaultLocale };
}

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
   * A caption per photograph, keyed by the item's `src` — the one part of a
   * `gallery:` block a PATCH may change (B522).
   *
   * The rest of the block is the server's: `src`, `width` and `height` are
   * measured off the file, and rewriting them from a request body is how a
   * day comes to point at photographs that are not there. So this edits the
   * `caption:` line inside items that already exist and touches nothing else
   * — a `src` the day does not carry is refused rather than added (B540: it
   * used to be ignored, which made a typo look exactly like success), and an
   * empty string removes the caption it names.
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
   * The same narrow rule applies: this edits one line inside items that
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
  visibility?: PhotoVisibility | null;
  /** Ask for a lookup on a day already written — B325. `false` removes the
   * request; it does not remove a reading already recorded. */
  weather?: boolean;
  /** A reading the caller took themselves, or `null` to remove one. */
  weatherData?: DayWeather | null;
};

/**
 * The line naming `key` inside the frontmatter block (`lines[1..closing)`),
 * or -1. Only scanned inside the block, the same discipline `publishDraft`
 * uses for `status: draft` — a `title:` inside the prose is a day about
 * titles, not a target.
 */
function frontmatterLineOf(
  lines: string[],
  closing: number,
  key: string,
): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex(
    (line, i) => i > 0 && i < closing && pattern.test(line),
  );
}

/**
 * Replace, insert or remove one scalar frontmatter line, leaving every other
 * byte untouched — new fields are appended just above the closing `---`,
 * same as `appendGallery` appends a fresh `gallery:` block. Returns the
 * closing marker's index, which moves when a line is added or removed.
 */
function spliceScalar(
  lines: string[],
  closing: number,
  key: string,
  rendered: string | null,
): number {
  const at = frontmatterLineOf(lines, closing, key);
  if (rendered === null) {
    if (at < 0) return closing;
    lines.splice(at, 1);
    return closing - 1;
  }
  if (at >= 0) {
    lines[at] = rendered;
    return closing;
  }
  lines.splice(closing, 0, rendered);
  return closing + 1;
}

/**
 * `costs:` is a list, not one line — replaced wholesale rather than
 * diffed item by item, the same choice `appendGallery` makes for `gallery:`.
 * An empty array clears it: no manual costs recorded any more.
 */
function spliceCosts(
  lines: string[],
  closing: number,
  costs: CostInput[] | undefined,
): number {
  const at = frontmatterLineOf(lines, closing, "costs");
  let end = closing;
  if (at >= 0) {
    end = at + 1;
    while (end < closing && /^\s+\S/.test(lines[end])) end++;
    lines.splice(at, end - at);
    closing -= end - at;
  }
  const block = costLines(costs);
  if (block.length === 0) return closing;
  lines.splice(at >= 0 ? at : closing, 0, ...block);
  return closing + block.length;
}

/**
 * `translations:` is a nested block, so it is replaced wholesale like
 * `costs:` — the same reasoning, and the same consequence: an edit that
 * names it must carry every language, which is exactly what
 * `validateEntryEdit` already refuses to let through half-done.
 */
function spliceTranslations(
  lines: string[],
  closing: number,
  translations: DraftInput["translations"],
): number {
  const at = frontmatterLineOf(lines, closing, "translations");
  if (at >= 0) {
    let end = at + 1;
    // Anything indented belongs to the block, blank lines inside a literal
    // scalar included — a paragraph break in somebody's prose must not be
    // read as the end of the key.
    while (end < closing && (/^\s+/.test(lines[end]) || lines[end] === ""))
      end++;
    lines.splice(at, end - at);
    closing -= end - at;
  }
  const block = translationLines(translations);
  if (block.length === 0) return closing;
  lines.splice(at >= 0 ? at : closing, 0, ...block);
  return closing + block.length;
}

/**
 * Rewrite one line inside the `gallery:` block, leaving every other byte of it
 * alone — B522 for `caption:`, B596 for `visibility:`.
 *
 * Wholesale replacement (what `spliceCosts` does) is the wrong shape here: an
 * edit carrying the whole gallery would let a partial payload delete
 * photographs, and the `src`, `width` and `height` the server measured off
 * the file are not the caller's to restate. So this walks the block item by
 * item and touches only the one line each item may own.
 *
 * `field` is the name of that line, and there are exactly two: the caption a
 * person wrote, and whether the picture is held back. Parameterised rather
 * than copied, because the walk is the difficult half — finding each item's
 * bounds, matching its `src` past the owner prefix, splicing backwards so the
 * indices ahead of the cursor stay valid. A second copy of that with one word
 * changed is a second copy of every bug in it.
 *
 * An empty string removes the line, which is how a caller clears a label as
 * well as how they clear a caption.
 */
function spliceGalleryField(
  lines: string[],
  closing: number,
  field: "caption" | "visibility",
  values: Record<string, string>,
): number {
  const at = frontmatterLineOf(lines, closing, "gallery");
  if (at < 0) return closing;

  // `/alex/media/trip/day/01.jpg` on the way in, `/media/trip/day/01.jpg` on
  // disk — the owner is prefixed at read time (`mediaWithOwner`), so compare
  // what follows `/media/` and nothing before it. `mediaKey` is that rule,
  // and it is shared now rather than written out here (lib/photos.ts).
  const wanted = new Map(
    Object.entries(values).map(([src, text]) => [mediaKey(src), text.trim()]),
  );

  let end = at + 1;
  while (end < closing && /^\s+\S/.test(lines[end])) end++;

  const starts: number[] = [];
  for (let i = at + 1; i < end; i++)
    if (/^\s*-\s/.test(lines[i])) starts.push(i);

  // Walked backwards: each splice moves everything after it, and going from
  // the end leaves the indices still ahead of the cursor valid.
  for (let n = starts.length - 1; n >= 0; n--) {
    const from = starts[n];
    const to = n + 1 < starts.length ? starts[n + 1] : end;
    const item = lines.slice(from, to);
    const srcAt = item.findIndex((line) => /^\s*-?\s*src:/.test(line));
    if (srcAt < 0) continue;
    const src = item[srcAt]
      .replace(/^\s*-?\s*src:\s*/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const text = wanted.get(mediaKey(src));
    if (text === undefined) continue;

    const fieldAt = item.findIndex((line) =>
      new RegExp(`^\\s+${field}:`).test(line),
    );
    if (text === "") {
      if (fieldAt >= 0) {
        lines.splice(from + fieldAt, 1);
        closing -= 1;
      }
      continue;
    }
    const rendered = `    ${field}: ${quote(text)}`;
    if (fieldAt >= 0) {
      lines[from + fieldAt] = rendered;
    } else {
      lines.splice(to, 0, rendered);
      closing += 1;
    }
  }
  return closing;
}

/**
 * Splice `input`'s fields into `markdown`, textually — parsed and re-emitted
 * for nothing. A field the day already has is replaced in place, so a
 * comment or a hand-chosen key order two lines away survives; a field new to
 * this day is appended just above the closing `---`. `content`, which is not
 * frontmatter, replaces everything from the closing marker to the end of the
 * file.
 *
 * Returns null when there is no frontmatter block to splice into — the
 * caller's cue to leave a hand-shaped file alone and say so, same as
 * `attachGallery`.
 */
export function spliceEntryFields(
  markdown: string,
  input: EditInput,
): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const set = (key: string, rendered: string | null) => {
    closing = spliceScalar(lines, closing, key, rendered);
  };

  if (input.title !== undefined) set("title", `title: ${quote(input.title)}`);
  if (input.date !== undefined) set("date", `date: ${quote(input.date)}`);
  if (input.time !== undefined)
    set("time", input.time ? `time: ${quote(input.time)}` : null);
  if (input.timezone !== undefined)
    set("timezone", input.timezone ? `timezone: ${quote(input.timezone)}` : null);
  if (input.location !== undefined)
    set(
      "location",
      input.location ? `location: ${quote(input.location)}` : null,
    );
  if (input.country !== undefined)
    set("country", input.country ? `country: ${quote(input.country)}` : null);
  if (input.countryCode !== undefined) {
    set(
      "countryCode",
      input.countryCode
        ? `countryCode: ${quote(input.countryCode.toUpperCase())}`
        : null,
    );
  }
  if (input.lat !== undefined) set("lat", `lat: ${input.lat}`);
  if (input.lng !== undefined) set("lng", `lng: ${input.lng}`);
  if (input.tags !== undefined) {
    set(
      "tags",
      input.tags.length ? `tags: [${input.tags.map(quote).join(", ")}]` : null,
    );
  }
  if (input.transportMode !== undefined) {
    set(
      "transportMode",
      input.transportMode
        ? `transportMode: ${quote(input.transportMode)}`
        : null,
    );
  }
  if (input.transportFrom !== undefined) {
    set(
      "transportFrom",
      input.transportFrom
        ? `transportFrom: ${quote(input.transportFrom)}`
        : null,
    );
  }
  if (input.transportTo !== undefined) {
    set(
      "transportTo",
      input.transportTo ? `transportTo: ${quote(input.transportTo)}` : null,
    );
  }
  if (input.travelScene !== undefined) {
    set(
      "travelScene",
      input.travelScene ? `travelScene: ${quote(input.travelScene)}` : null,
    );
  }
  // B632. `null` clears the label, same as `photoVisibility`'s.
  if (input.visibility !== undefined) {
    set(
      "visibility",
      input.visibility ? `visibility: ${quote(input.visibility)}` : null,
    );
  }
  // Written only when true, like every other flag here — see the note on
  // NewTrip.test. `test: false` unsets it rather than writing a line nobody
  // wants to read.
  if (input.test !== undefined)
    set("test", input.test === true ? "test: true" : null);
  // Same "written only when true" rule as `test` above, and for the same
  // reason. `weatherData: null` clears a reading; `weather: false` only
  // withdraws the request.
  if (input.weather !== undefined)
    set("weather", input.weather === true ? "weather: true" : null);
  if (input.weatherData !== undefined) {
    set(
      "weatherData",
      input.weatherData ? weatherLine(input.weatherData) : null,
    );
  }
  if (input.costs !== undefined) {
    closing = spliceCosts(lines, closing, costLinesOf(input));
  }
  /**
   * The declines, on an edit — B531.
   *
   * An edit that *supplies* what a day was missing has to clear the decline
   * as well, or the file would say both "here is what it cost" and "this day
   * has no money on it". So the block is rewritten from what the edit says
   * plus what the file already said, minus anything the edit has now
   * answered.
   */
  {
    const front = matter(markdown).data;
    const declined = new Set<Track>(parseWithout(front.without));
    const unknown = new Set<Track>(parseUnrecorded(front.unrecorded));
    for (const key of TRACKS) {
      const said =
        key === "costs" ? input.costs : input[key as "coordinates" | "photos"];
      if (said === undefined) continue;
      // Three answers, and each one retracts the other two: a day cannot
      // sensibly say both that it had none of something and that nobody knows
      // how much of it there was. B560.
      declined.delete(key);
      unknown.delete(key);
      if (said === false) declined.add(key);
      else if (said === UNKNOWN) unknown.add(key);
    }
    // Coordinates arrive as two fields rather than one, so they are the one
    // row an edit can answer without naming the row.
    if (input.lat !== undefined && input.lng !== undefined) {
      declined.delete("coordinates");
      unknown.delete("coordinates");
    }
    closing = spliceScalar(
      lines,
      closing,
      "without",
      withoutLine([...declined])[0] ?? null,
    );
    closing = spliceScalar(
      lines,
      closing,
      "unrecorded",
      unrecordedLine([...unknown])[0] ?? null,
    );
  }
  if (input.translations !== undefined) {
    closing = spliceTranslations(lines, closing, input.translations);
  }
  if (input.captions !== undefined) {
    closing = spliceGalleryField(lines, closing, "caption", input.captions);
  }
  if (input.photoVisibility !== undefined) {
    closing = spliceGalleryField(
      lines,
      closing,
      "visibility",
      // `null` clears the label, and the splice reads an empty string as
      // "remove the line" — so the two spellings a caller might reach for,
      // `null` and `""`, mean the same thing here rather than one of them
      // writing `visibility: ""` into somebody's file.
      Object.fromEntries(
        Object.entries(input.photoVisibility).map(([src, level]) => [
          src,
          level ?? "",
        ]),
      ),
    );
  }

  if (input.content !== undefined) {
    lines.splice(
      closing + 1,
      lines.length - (closing + 1),
      "",
      input.content.trim(),
      "",
    );
  }

  return lines.join("\n");
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
 * for.** Decided by the file's own `status` line before this function
 * touches anything, and asserted again after: if splicing `input`'s fields
 * ever changed that answer, nothing is written and the caller is told it hit
 * a bug, rather than a published day silently reverting to a draft or a
 * draft silently going up. That is the property this whole ticket is about,
 * so it is checked here even though nothing in `spliceEntryFields` should be
 * able to move it — the same "verify what you just wrote" instinct as
 * `draftDoesNotReadBack` above.
 *
 * The parse-and-check happens on the *string* `spliceEntryFields` returns,
 * before anything reaches disk — an edit that would leave the file unparseable
 * is refused rather than written and then noticed.
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

  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: "unknown_day" };
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return { ok: false, error: "unknown_day" };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  const wasDraft = isDraft(matter(raw).data);

  /**
   * The same stamp `createDraft` applies, on a day that already exists — a
   * `PATCH` naming `costs` needs the day's place, and this edit may not be
   * the one that named it: `country`/`lat`/`lng` fall back to what the file
   * already carries when the edit itself is silent about them.
   */
  let costCurrency: string | undefined;
  if (Array.isArray(input.costs) && input.costs.length > 0) {
    const existing = matter(raw).data;
    const place = {
      country:
        input.country !== undefined
          ? input.country
          : String(existing.country ?? ""),
      lat: input.lat !== undefined ? input.lat : Number(existing.lat),
      lng: input.lng !== undefined ? input.lng : Number(existing.lng),
    };
    const stamped = stampCostCurrencies(
      input.costs,
      place,
      journalBaseCurrency(ref),
    );
    input = { ...input, costs: stamped.costs };
    costCurrency = stamped.applied;
  }

  const spliced = spliceEntryFields(raw, input);
  if (spliced === null) {
    return {
      ok: false,
      error: `"${slug}" has no frontmatter block to edit. Edit the file by hand.`,
    };
  }

  let after: Record<string, unknown>;
  try {
    after = matter(spliced).data;
  } catch (err) {
    const said =
      err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave "${slug}" unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  if (isDraft(after) !== wasDraft) {
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
  // moved since, writing `spliced` now would silently erase whatever wrote
  // it, because `spliced` was built from a copy that predates that change.
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

  fs.writeFileSync(file, spliced);
  forgetEntries(ref);
  return {
    ok: true,
    slug,
    status: wasDraft ? "draft" : "published",
    ...(costCurrency ? { costCurrency } : {}),
  };
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
 * Publish a draft: remove the one line that was holding it back.
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
 * Textual, like `attachGallery`: the file is not parsed and re-emitted, so
 * comments, key order and hand-written formatting survive. Only the status line
 * goes.
 */
export function publishDraft(
  ref: string,
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: `no entry "${slug}" in this trip` };
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  const { data } = matter(raw);
  if (!isDraft(data)) {
    // Not an error worth a 500, and not silently fine either: an agent that
    // publishes twice should be told the second call did nothing rather than
    // reporting success to somebody.
    return { ok: false, error: `"${slug}" is already published` };
  }

  const lines = raw.split("\n");
  if (lines[0].trim() !== "---") {
    return { ok: false, error: `"${slug}" has no frontmatter block to change` };
  }
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0)
    return { ok: false, error: `"${slug}" has no frontmatter block to change` };

  // Only inside the frontmatter, and only the status line. A `status: draft`
  // in the prose is somebody writing about drafts.
  const at = lines.findIndex(
    (line, i) =>
      i > 0 && i < closing && /^status:\s*draft\s*$/i.test(line.trim()),
  );
  if (at < 0)
    return {
      ok: false,
      error: `"${slug}" has no "status: draft" line to remove`,
    };

  lines.splice(at, 1);
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
  fs.writeFileSync(file, lines.join("\n"));
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
 *
 * Textual for the same reason `publishDraft` is: the file is not parsed and
 * re-emitted, so key order, comments and anything hand-written survive. The
 * line goes back where `createDraft` writes it, last inside the frontmatter.
 */
export function unpublishEntry(
  ref: string,
  slug: string,
): { ok: true; slug: string } | { ok: false; error: string } {
  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: `no entry "${slug}" in this trip` };
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const raw = fs.readFileSync(file, "utf8");
  const { data } = matter(raw);
  if (isDraft(data)) {
    // Not an error worth a 500, and not silently fine either — the same
    // reasoning as publishing something already published.
    return { ok: false, error: `"${slug}" is not on the site` };
  }

  const lines = raw.split("\n");
  if (lines[0].trim() !== "---") {
    return { ok: false, error: `"${slug}" has no frontmatter block to change` };
  }
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0)
    return { ok: false, error: `"${slug}" has no frontmatter block to change` };

  lines.splice(closing, 0, "status: draft");
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
  fs.writeFileSync(file, lines.join("\n"));
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
 * The trip is read once, here, rather than per file: this function reads
 * frontmatter with `matter` directly instead of going through `getAllEntries`,
 * so it has to fetch the trip itself, and `getTrip` is a memoised read of the
 * same folder either way.
 *
 * Only when true, like every other flag on these surfaces. Absent means real.
 */
export function listDrafts(
  ref: string,
): { slug: string; title: string; date: string; test?: true }[] {
  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const trip = getTrip(ref);
  const drafts: { slug: string; title: string; date: string; test?: true }[] =
    [];
  for (const file of files) {
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      // Same failure `readAllEntries` guards against (B236): a file that
      // will not parse must not blank out the review queue for every other
      // draft in the trip. Skipped and logged rather than thrown; see
      // `clearMatterCache` in lib/matterCache.ts for why that call is needed too.
      clearMatterCache();
      const why =
        err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(
        `[entries] ${ref}/entries/${file}: its frontmatter could not be parsed: ${why}`,
      );
      continue;
    }
    if (parsed.data.status !== "draft") continue;
    drafts.push({
      slug: entrySlugFromFile(file),
      title: String(parsed.data.title ?? ""),
      date: String(parsed.data.date ?? ""),
      ...(isTestContent(trip, { test: parsed.data.test === true })
        ? { test: true as const }
        : {}),
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
 * Removes one day's markdown file.
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

  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: `no entry "${slug}" in this trip` };
  }

  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const { data } = matter(fs.readFileSync(file, "utf8"));
  const published = !isDraft(data);
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
  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return false;
  try {
    return !isDraft(
      matter(fs.readFileSync(path.join(dir, match), "utf8")).data,
    );
  } catch (err) {
    // A file that will not parse carries no readable `status: draft` line,
    // and `isDraft` already treats anything other than exactly that line as
    // published (see its own comment) — so "cannot be read" is answered the
    // same way "read, and not a draft" is, rather than thrown. B236. See
    // `clearMatterCache` in lib/matterCache.ts for why that call is needed too.
    clearMatterCache();
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `[entries] ${ref}/entries/${match}: its frontmatter could not be parsed: ${why}`,
    );
    return true;
  }
}
