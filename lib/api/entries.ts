import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { forgetEntries, getAllEntries, getDays, isDraft } from "../entries";
import { getTrip, tripDir, tripRef } from "../trips";
import type { Entry } from "../types";

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
