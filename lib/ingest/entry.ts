/**
 * Writing the markdown.
 *
 * Two paths, and the difference between them is the whole design:
 *
 *  - A **new** entry is rendered from scratch, in the same hand-written shape
 *    as the rest of `content/` — quoted strings, two-space list indents — so
 *    that a file ingest produced and a file a person typed are indistinguishable.
 *  - An **existing** entry gets its new gallery items spliced into the block
 *    that is already there, textually. It is not parsed and re-emitted,
 *    because by the time you import the second batch of a day you have
 *    already written the prose, fixed the title and added captions, and a
 *    YAML round-trip would quietly restyle all of it.
 *
 * Quoting is `quoteScalar`'s, not this file's. It had a private `yamlString`
 * escaping backslash and quote and nothing else, which was the third copy of
 * that function and the second one to be wrong — B204 is what the first cost.
 * It went unnoticed while every value here came off a file or a validated
 * field; a caption is written straight from a request body (B522), and a
 * control character in one produced a day that no reading path could parse
 * and no API call could delete. The shared one cannot emit invalid YAML
 * whatever it is handed, which is exactly why it exists.
 */
import type { GalleryItem } from "../types.ts";
import { quoteScalar } from "../validate/frontmatter.ts";

/** A gallery item as ingest writes it. `poster` is extra: nothing renders it
 * yet, but a clip without one is a black rectangle in any future grid, and it
 * costs one line to record now. */
export type IngestGalleryItem = GalleryItem & { poster?: string };

export type EntryDraft = {
  title: string;
  date: string;
  time?: string;
  location: string;
  country: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  gallery: IngestGalleryItem[];
  tags: string[];
  /** Only ever set when the guess is unambiguous — see `guessTransport`. */
  transport?: { mode: string; from: string; to: string };
  body: string;
};

/** Five decimals is about a metre — more would imply a precision no consumer
 * GPS has, and would make the numbers hard to read. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(5)));
}

function galleryLines(items: IngestGalleryItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  - src: ${quoteScalar(item.src)}`);
    lines.push(`    type: ${quoteScalar(item.type)}`);
    if (item.poster) lines.push(`    poster: ${quoteScalar(item.poster)}`);
    if (item.width) lines.push(`    width: ${item.width}`);
    if (item.height) lines.push(`    height: ${item.height}`);
    if (item.caption) lines.push(`    caption: ${quoteScalar(item.caption)}`);
    // B596. Never emitted for a picture nobody held back, so an ordinary day
    // reads exactly as it did — the absent line is what "everyone the trip
    // lets in" looks like.
    if (item.visibility) lines.push(`    visibility: ${quoteScalar(item.visibility)}`);
    // Last, because it is the least interesting line to a person reading the
    // file and the most useful one to an agent reconciling a batch. B527.
    if (item.from) lines.push(`    from: ${quoteScalar(item.from)}`);
  }
  return lines;
}

/** The prompt left in a fresh entry. Short and obviously unfinished — it is
 * the one thing the author must replace, so it should not look like prose. */
export const BODY_PLACEHOLDER =
  "_Write the day here. Date, time, place and photos above are already filled in._";

export function renderEntry(draft: EntryDraft): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${quoteScalar(draft.title)}`);
  lines.push(`date: ${quoteScalar(draft.date)}`);
  if (draft.time) lines.push(`time: ${quoteScalar(draft.time)}`);
  lines.push(`location: ${quoteScalar(draft.location)}`);
  lines.push(`country: ${quoteScalar(draft.country)}`);
  if (draft.countryCode) lines.push(`countryCode: ${quoteScalar(draft.countryCode)}`);
  if (draft.lat !== undefined) lines.push(`lat: ${coordinate(draft.lat)}`);
  if (draft.lng !== undefined) lines.push(`lng: ${coordinate(draft.lng)}`);
  if (draft.gallery.length > 0) {
    lines.push("gallery:");
    lines.push(...galleryLines(draft.gallery));
  }
  if (draft.tags.length > 0) {
    lines.push(`tags: [${draft.tags.map(quoteScalar).join(", ")}]`);
  }
  if (draft.transport) {
    lines.push(`transportMode: ${quoteScalar(draft.transport.mode)}`);
    lines.push(`transportFrom: ${quoteScalar(draft.transport.from)}`);
    lines.push(`transportTo: ${quoteScalar(draft.transport.to)}`);
  }
  // A fresh entry's body is BODY_PLACEHOLDER — "write the day here" — and
  // without this it was on the public site the moment it was written, which
  // for an agent running the ingest skill means publishing a placeholder to
  // somebody's family. Everything an agent creates is a draft (AGENTS.md), and
  // ingest is one of the ways an agent creates one. The person removes the
  // line when they have written the words; they are editing the file anyway.
  lines.push("status: draft");
  lines.push("---");
  lines.push("");
  lines.push(draft.body.trim() || BODY_PLACEHOLDER);
  lines.push("");
  return lines.join("\n");
}

/**
 * Splices gallery items into an entry that already exists, leaving every
 * other byte alone.
 *
 * Returns null when the file has no frontmatter block to splice into, which
 * the caller treats as "leave the human's file alone and say so" rather than
 * guessing.
 */
export function appendGallery(markdown: string, items: IngestGalleryItem[]): string | null {
  if (items.length === 0) return markdown;
  const lines = markdown.split("\n");
  if (lines[0].trim() !== "---") return null;

  const opening = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (opening < 0) return null;

  /**
   * A day that said it had no photographs, and now has some, no longer says
   * it — B540.
   *
   * `without: [photos]` is a statement about the day: *there are no pictures
   * from this one*. Photographs arriving is that statement becoming false, and
   * a file that carries both a gallery and the claim it has none is telling a
   * reader two things at once. `editEntry` already retracts a decline the
   * moment an edit answers it, including the `lat`/`lng` pair that answers a
   * row without naming it; this is the same rule for the row that is answered
   * by a different call altogether.
   *
   * Here rather than in `attachGallery` so that ingest gets it too: it appends
   * galleries through this same function, to days it wrote itself.
   *
   * `unrecorded: [photos]` is the same claim from the other side — nobody
   * knows whether there were any — and a gallery arriving answers it exactly
   * as well as `without:` does. B1564 is the same rule as B540 above, for the
   * second list a day can carry the decline in.
   */
  for (const key of ["without", "unrecorded"]) {
    // Recomputed on every pass, not just once above `opening`: removing the
    // `without:` line shifts the closing `---` up by one, and a boundary
    // taken before that splice would let the `unrecorded:` search spill past
    // the frontmatter and into the body.
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    const at = lines.findIndex((line, i) => i > 0 && i < end && new RegExp(`^${key}:`).test(line));
    if (at < 0) continue;
    const kept = (lines[at].match(/\[(.*)\]/)?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== "photos");
    if (kept.length > 0) lines[at] = `${key}: [${kept.join(", ")}]`;
    else lines.splice(at, 1);
  }

  // Found again rather than adjusted: dropping the `without:` line above moves
  // everything after it, and an index taken before the splice would put the
  // gallery one line into somebody's prose.
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const galleryAt = lines.findIndex((line, i) => i > 0 && i < closing && /^gallery:\s*$/.test(line));
  const block = galleryLines(items);

  if (galleryAt < 0) {
    // No gallery yet — start one at the end of the frontmatter.
    lines.splice(closing, 0, "gallery:", ...block);
    return lines.join("\n");
  }

  // The list runs until the first line that is not part of it: any indented
  // line belongs to the list, anything at column zero starts the next key.
  let end = galleryAt + 1;
  while (end < closing && /^\s+\S/.test(lines[end])) end++;
  lines.splice(end, 0, ...block);
  return lines.join("\n");
}

/** `2026-08-14-hoi-an.md` — the naming `lib/entries.ts` strips back to a slug. */
export function entryFileName(date: string, slug: string): string {
  return `${date}-${slug}.md`;
}

/** Morning/afternoon/evening/night, used to tell apart two entries that share
 * a day and a place. */
export function partOfDay(hour: number): string {
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}
