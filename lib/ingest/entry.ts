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
 */
import type { GalleryItem } from "../types.ts";

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

/** Double-quoted YAML: the only escapes it needs are backslash and quote. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Five decimals is about a metre — more would imply a precision no consumer
 * GPS has, and would make the numbers hard to read. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(5)));
}

/**
 * Letters NFD cannot take apart, because they are not an ASCII letter plus an
 * accent — they are their own letters. Without these, "Ðà Lạt" slugs to
 * "a-lat" and "Ærøskøbing" to "rskbing", which is the sort of URL you only
 * notice after it has been shared.
 */
const TRANSLITERATIONS: [RegExp, string][] = [
  // Both the Vietnamese d-with-stroke and the eth GeoNames often uses for it.
  [/[đĐðÐ]/g, "d"],
  [/[øØ]/g, "o"],
  [/[łŁ]/g, "l"],
  [/[æÆ]/g, "ae"],
  [/[œŒ]/g, "oe"],
  [/[þÞ]/g, "th"],
  [/ß/g, "ss"],
];

export function slugify(text: string): string {
  let out = text.normalize("NFD");
  for (const [pattern, replacement] of TRANSLITERATIONS) out = out.replace(pattern, replacement);
  return (
    out
      .toLowerCase()
      // Strip combining marks, so "Hội An" becomes "hoi-an" rather than losing
      // the vowels entirely.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "entry"
  );
}

export function galleryLines(items: IngestGalleryItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  - src: ${yamlString(item.src)}`);
    lines.push(`    type: ${yamlString(item.type)}`);
    if (item.poster) lines.push(`    poster: ${yamlString(item.poster)}`);
    if (item.width) lines.push(`    width: ${item.width}`);
    if (item.height) lines.push(`    height: ${item.height}`);
    if (item.caption) lines.push(`    caption: ${yamlString(item.caption)}`);
  }
  return lines;
}

/** The prompt left in a fresh entry. Short and obviously unfinished — it is
 * the one thing the author must replace, so it should not look like prose. */
export const BODY_PLACEHOLDER =
  "_Write the day here. Date, time, place and photos above are already filled in._";

export function renderEntry(draft: EntryDraft): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${yamlString(draft.title)}`);
  lines.push(`date: ${yamlString(draft.date)}`);
  if (draft.time) lines.push(`time: ${yamlString(draft.time)}`);
  lines.push(`location: ${yamlString(draft.location)}`);
  lines.push(`country: ${yamlString(draft.country)}`);
  if (draft.countryCode) lines.push(`countryCode: ${yamlString(draft.countryCode)}`);
  if (draft.lat !== undefined) lines.push(`lat: ${coordinate(draft.lat)}`);
  if (draft.lng !== undefined) lines.push(`lng: ${coordinate(draft.lng)}`);
  if (draft.gallery.length > 0) {
    lines.push("gallery:");
    lines.push(...galleryLines(draft.gallery));
  }
  if (draft.tags.length > 0) {
    lines.push(`tags: [${draft.tags.map(yamlString).join(", ")}]`);
  }
  if (draft.transport) {
    lines.push(`transportMode: ${yamlString(draft.transport.mode)}`);
    lines.push(`transportFrom: ${yamlString(draft.transport.from)}`);
    lines.push(`transportTo: ${yamlString(draft.transport.to)}`);
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
