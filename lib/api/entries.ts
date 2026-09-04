import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isTestContent } from "../access";
import { entrySlugFromFile, forgetEntries, getAllEntries, getDays, isDraft } from "../entries";
// The same splicer ingest uses. One way of writing a gallery into an entry
// that already exists, so the two doors cannot drift apart in how they format
// it or in what they preserve of a file somebody has since edited.
import { appendGallery } from "../ingest/entry";
// One slugify for the whole codebase (B77). This module used to carry its
// own, which stripped a German umlaut down to its bare vowel and disagreed
// with the one ingest used — the same title, two permanent URLs.
import { slugify } from "../slug.ts";
import { getTrip, tripDir, tripRef } from "../trips";
import type { Entry, GalleryItem, Trip } from "../types";
import { quoteScalar } from "../validate/frontmatter";

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

export type DraftInput = {
  title: string;
  date: string;
  time?: string;
  location?: string;
  country?: string;
  lat?: number;
  lng?: number;
  content: string;
  tags?: string[];
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
  costs?: { label: string; amount: number; currency?: string; category?: string }[];
  /** How the day was travelled. Same story as `costs` — validated since W29,
   * written since W38. */
  transportMode?: string;
  transportFrom?: string;
  transportTo?: string;
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
   * Names this one write, so a retry after a dropped connection gets the first
   * answer back instead of a conflict. Never written to the file — see the
   * days route.
   */
  idempotency_key?: string;
};

export type WriteResult =
  | { ok: true; slug: string; file: string; status: "draft" }
  /**
   * `bug` marks the refusals that are this software's fault rather than the
   * caller's, so a door that speaks in status codes can say 500 instead of
   * blaming the request (B208). Absent on every refusal a caller can fix by
   * sending something else.
   */
  | { ok: false; error: string; bug?: true };

/** A delete has no file left to name. */
export type DeleteResult =
  | { ok: true; slug: string; published: boolean }
  | { ok: false; error: string };

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

/**
 * The `costs:` block, in the flow style the hand-written entries use.
 *
 * `currency` is omitted when absent rather than guessed: a cost with no
 * currency is read as the journal's base currency, which is the right default
 * and not a value this should bake into the file. `category` falls back to
 * "other", which is what `lib/costs.ts` would read anyway — written out so the
 * file says what it means.
 */
function costLines(costs: DraftInput["costs"]): string[] {
  if (!costs?.length) return [];
  return [
    "costs:",
    ...costs.map((cost) => {
      const fields = [
        `label: ${quote(cost.label)}`,
        `amount: ${cost.amount}`,
        `category: ${quote(cost.category?.trim() || "other")}`,
        ...(cost.currency?.trim() ? [`currency: ${quote(cost.currency.trim().toUpperCase())}`] : []),
      ];
      return `  - { ${fields.join(", ")} }`;
    }),
  ];
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
    if (value !== undefined && (typeof value !== "number" || Number.isNaN(value))) {
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
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
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
export function createDraft(ref: string, input: DraftInput): WriteResult {
  const problem = validateDraft(input);
  if (problem) return { ok: false, error: problem };

  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const slug = slugify(input.title);
  const dir = path.join(tripDir(ref), "entries");
  const file = path.join(dir, `${input.date}-${slug}.md`);

  if (fs.existsSync(file)) {
    return { ok: false, error: `an entry already exists at ${input.date}-${slug}` };
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
      error:
        `an entry already exists with the slug "${slug}" in this trip — ${taken}. ` +
        "A slug is a day's address within its trip and only one day can hold it, so a " +
        "second would be written and never served. Two titles slug the same way when they " +
        "differ only in punctuation or accents; give this day a title that differs in a word.",
    };
  }

  const lines = [
    "---",
    `title: ${quote(input.title)}`,
    `date: ${quote(input.date)}`,
    ...(input.time ? [`time: ${quote(input.time)}`] : []),
    ...(input.location ? [`location: ${quote(input.location)}`] : []),
    ...(input.country ? [`country: ${quote(input.country)}`] : []),
    ...(input.lat !== undefined ? [`lat: ${input.lat}`] : []),
    ...(input.lng !== undefined ? [`lng: ${input.lng}`] : []),
    ...(input.tags?.length ? [`tags: [${input.tags.map(quote).join(", ")}]`] : []),
    ...(input.transportMode
      ? [
          `transportMode: ${quote(input.transportMode)}`,
          `transportFrom: ${quote(input.transportFrom ?? "")}`,
          `transportTo: ${quote(input.transportTo ?? "")}`,
        ]
      : []),
    ...costLines(input.costs),
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

  return { ok: true, slug, file, status: "draft" };
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
 * Drafts and published days both, but the caller decides: the media route
 * refuses a published day before any bytes are written. Writing new pictures
 * into a day people have already read is a person's job.
 */
export function attachGallery(
  ref: string,
  slug: string,
  items: GalleryItem[],
): { ok: true; attached: number } | { ok: false; error: string } {
  if (items.length === 0) return { ok: true, attached: 0 };

  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return { ok: false, error: `no entry "${slug}" in this trip` };
  }
  const match = files.find(
    (f) => entrySlugFromFile(f) === slug,
  );
  if (!match) return { ok: false, error: `no entry "${slug}" in this trip` };

  const file = path.join(dir, match);
  const spliced = appendGallery(fs.readFileSync(file, "utf8"), items);
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

  fs.writeFileSync(file, spliced);
  forgetEntries(ref);
  return { ok: true, attached: items.length };
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
 * One function, because REST and MCP report the same act and a sentence kept
 * in two files disagrees with itself within a month — which is exactly how the
 * two copies of this one came to differ before B158 merged them.
 */
export function publishNotice(input: {
  title: string;
  date: string;
  /** Where the day will be, so the person hears the address they are agreeing to. */
  url: string;
  /** `isTestContent(trip, entry)` — the trip's flag counts, not just the day's. */
  test: boolean;
}): string {
  const head = `"${input.title}" (${input.date}) is on ${input.url}.`;
  const tail =
    `Taking it down again removes it from the site, not from the people who have ` +
    `already read it.`;
  return input.test
    ? `${head} It is marked test: true — content nobody lived — so the page says so in a ` +
        `banner and it is kept out of the feed, the search index and the sitemap. Anyone ` +
        `with the link can still read it. ${tail}`
    : `${head} It is in the journal, the feed and the search index, and anyone with ` +
        `the link can read it. ${tail}`;
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
  const match = files.find(
    (f) => entrySlugFromFile(f) === slug,
  );
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
  if (closing < 0) return { ok: false, error: `"${slug}" has no frontmatter block to change` };

  // Only inside the frontmatter, and only the status line. A `status: draft`
  // in the prose is somebody writing about drafts.
  const at = lines.findIndex(
    (line, i) => i > 0 && i < closing && /^status:\s*draft\s*$/i.test(line.trim()),
  );
  if (at < 0) return { ok: false, error: `"${slug}" has no "status: draft" line to remove` };

  lines.splice(at, 1);
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
  const drafts: { slug: string; title: string; date: string; test?: true }[] = [];
  for (const file of files) {
    const parsed = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    if (parsed.data.status !== "draft") continue;
    drafts.push({
      slug: entrySlugFromFile(file),
      title: String(parsed.data.title ?? ""),
      date: String(parsed.data.date ?? ""),
      ...(isTestContent(trip, { test: parsed.data.test === true }) ? { test: true as const } : {}),
    });
  }
  return drafts.sort((a, b) => a.date.localeCompare(b.date));
}

/** The shape the API returns for a trip. Deliberately not the internal type. */
export function tripSummary(username: string, tripId: string) {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return null;
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
    // Echoed only when true, like every other flag here. Absent until B47,
    // which meant an agent that set it was never told it had been accepted and
    // could not see it afterwards — on the one field whose whole job is to say
    // "none of this happened".
    ...(trip.test ? { test: true } : {}),
    days: getDays(trip.ref).length,
    entries: getAllEntries(trip.ref).length,
    drafts: listDrafts(trip.ref).length,
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
 * which is what `tripSummary` above already says.
 */
export function entrySummary(entry: Entry, trip: Trip | undefined) {
  return {
    slug: entry.slug,
    title: entry.title,
    date: entry.date,
    time: entry.time,
    location: entry.location,
    country: entry.country,
    lat: entry.lat,
    lng: entry.lng,
    photos: entry.gallery.length,
    ...(isTestContent(trip, entry) ? { test: true } : {}),
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

  const match = files.find(
    (f) => entrySlugFromFile(f) === slug,
  );
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
  const match = files.find(
    (f) => entrySlugFromFile(f) === slug,
  );
  if (!match) return false;
  return !isDraft(matter(fs.readFileSync(path.join(dir, match), "utf8")).data);
}
