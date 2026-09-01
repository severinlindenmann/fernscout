import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { forgetEntries, getAllEntries, getDays, isDraft } from "../entries";
// The same splicer ingest uses. One way of writing a gallery into an entry
// that already exists, so the two doors cannot drift apart in how they format
// it or in what they preserve of a file somebody has since edited.
import { appendGallery } from "../ingest/entry";
import { getTrip, tripDir, tripRef } from "../trips";
import type { Entry, GalleryItem } from "../types";

/**
 * Writing content through the API.
 *
 * Everything an agent creates lands as a **draft** (G7). One hallucinated
 * memory in front of your family is unrecoverable, and no token lifetime fixes
 * that — so a human moves an entry from draft to published, and the API has no
 * way to skip the step.
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
  | { ok: false; error: string };

/** A delete has no file left to name. */
export type DeleteResult =
  | { ok: true; slug: string; published: boolean }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "entry"
  );
}

/** YAML-safe double-quoted scalar. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
    (f) => f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug,
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
 * Publish a draft: remove the one line that was holding it back.
 *
 * Until B28 the only way to do this was to open the file in a text editor and
 * delete `status: draft` by hand. That is fine for the author on their own
 * laptop, and useless to somebody who was handed a journal by an agent and has
 * never seen the folder — which, since journal creation over the API exists, is
 * now a real person. The guide told them four times that "a person publishes
 * it" and never once said how.
 *
 * **This does not weaken the draft rule; it moves where the person stands.**
 * Writing and publishing remain two separate calls, the second is refused
 * without a confirmation code bound to that exact day, and the refusal asks
 * whether the person actually said to. What an agent still cannot do is
 * publish as a side effect of writing.
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
    (f) => f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug,
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

/** Entries awaiting a human, for the review queue. */
export function listDrafts(ref: string): { slug: string; title: string; date: string }[] {
  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const drafts: { slug: string; title: string; date: string }[] = [];
  for (const file of files) {
    const parsed = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    if (parsed.data.status !== "draft") continue;
    drafts.push({
      slug: file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, ""),
      title: String(parsed.data.title ?? ""),
      date: String(parsed.data.date ?? ""),
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
    days: getDays(trip.ref).length,
    entries: getAllEntries(trip.ref).length,
    drafts: listDrafts(trip.ref).length,
  };
}

export function entrySummary(entry: Entry) {
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
    (f) => f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug,
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
    (f) => f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "") === slug,
  );
  if (!match) return false;
  return !isDraft(matter(fs.readFileSync(path.join(dir, match), "utf8")).data);
}
