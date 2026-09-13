/**
 * Writing a day's JSON.
 *
 * Two paths, and the difference between them is the whole design:
 *
 *  - A **new** entry is built from scratch as a `DayFile` and serialised with
 *    `dayToJson` — the same serialiser every other writer in this codebase
 *    uses (`lib/api/v2/documents.ts`), so a file ingest produced and a file
 *    `POST .../days` produced are byte-for-byte the same shape.
 *  - An **existing** entry gets its new gallery items spliced into the `media`
 *    array that is already there, via `dayFromJson`/`dayToJson`, rather than
 *    rebuilt from the draft: by the time you import the second batch of a day
 *    you have already written the prose, fixed the title and added captions,
 *    and rebuilding the document from the draft would throw all of that away.
 *
 * This file used to hand-roll YAML frontmatter (`quoteScalar`, one line per
 * field) because `trip.md`/`entries/*.md` were the on-disk shape. B1598
 * moved content to JSON; a day is now `entries/YYYY-MM-DD-slug.json`, and
 * `dayToJson`/`dayFromJson` are the one place — per AGENTS.md — that knows
 * how to turn a day document into bytes and back. Nothing here hand-rolls
 * that encoding any more.
 */
import type { GalleryItem } from "../types.ts";
import { dayFromJson, dayToJson, type DayFile } from "../api/v2/documents.ts";

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
function coordinate(value: number): number {
  return Number(value.toFixed(5));
}

/** The prompt left in a fresh entry. Short and obviously unfinished — it is
 * the one thing the author must replace, so it should not look like prose. */
export const BODY_PLACEHOLDER =
  "_Write the day here. Date, time, place and photos above are already filled in._";

/**
 * A fresh draft → the `DayFile` `dayToJson` serialises.
 *
 * `status: "draft"` unconditionally — the same reason the old markdown writer
 * always wrote `status: draft`: everything an agent creates is a draft
 * (AGENTS.md), and ingest is one of the ways an agent creates one. The person
 * removes it (or a later `publish` call does) once the words are written.
 */
function buildDay(draft: EntryDraft): DayFile {
  const day: DayFile = {
    slug: "", // never serialised — dayToJson never writes it, the filename is the address
    title: draft.title,
    date: draft.date,
    content: draft.body.trim() || BODY_PLACEHOLDER,
    status: "draft",
  };
  if (draft.time) day.time = draft.time;
  if (draft.location) day.location = draft.location;
  if (draft.country) day.country = draft.country;
  if (draft.countryCode) day.countryCode = draft.countryCode;
  if (draft.lat !== undefined && draft.lng !== undefined) {
    day.coordinates = { lat: coordinate(draft.lat), lng: coordinate(draft.lng) };
  }
  if (draft.gallery.length > 0) day.media = draft.gallery;
  if (draft.tags.length > 0) day.tags = draft.tags;
  if (draft.transport) {
    day.transportMode = draft.transport.mode as DayFile["transportMode"];
    day.transportFrom = draft.transport.from;
    day.transportTo = draft.transport.to;
  }
  return day;
}

/** A fresh draft → the bytes of `entries/YYYY-MM-DD-slug.json`. */
export function renderEntry(draft: EntryDraft): string {
  return dayToJson(buildDay(draft));
}

/**
 * Splices gallery items into an entry that already exists, leaving every
 * other field alone.
 *
 * Returns `null` when the file will not parse as a day at all, which the
 * caller treats as "leave the human's file alone and say so" rather than
 * guessing — the same refusal the old text-splicing version gave for a file
 * with no frontmatter block to splice into.
 */
export function appendGallery(raw: string, items: IngestGalleryItem[], slug = ""): string | null {
  if (items.length === 0) return raw;
  let day: DayFile;
  try {
    day = dayFromJson(slug, raw);
  } catch {
    return null;
  }

  /**
   * A day that said it had no photographs, and now has some, no longer says
   * it — B540/B1564. `declined.media` is v2's one decline mechanism (v1's
   * `without: [photos]` / `unrecorded: [photos]`) recording "there are no
   * pictures from this one" or "nobody knows whether there were any";
   * photographs arriving answers either claim, so the key comes off rather
   * than a file carrying both a gallery and the claim it has none.
   *
   * Here rather than only in `attachGallery` so that ingest gets it too: it
   * appends galleries through this same function, to days it wrote itself.
   */
  if (day.declined?.media !== undefined) {
    const { media: _media, ...rest } = day.declined;
    day.declined = Object.keys(rest).length > 0 ? rest : undefined;
  }

  day.media = [...(day.media ?? []), ...items];
  return dayToJson(day);
}

/** `2026-08-14-hoi-an.json` — the naming `lib/entries.ts` strips back to a
 * slug (`entrySlugFromFile`/`entryDateFromFile`). */
export function entryFileName(date: string, slug: string): string {
  return `${date}-${slug}.json`;
}

/** Morning/afternoon/evening/night, used to tell apart two entries that share
 * a day and a place. */
export function partOfDay(hour: number): string {
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}
