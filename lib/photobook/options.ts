/**
 * What is in the book, as opposed to how it is laid out.
 *
 * `plan.ts` says at its top that there is no template system and no theme
 * layer, and that stands: none of these is a style. They are answers to
 * "should the book contain my writing / the route map / the country dividers
 * / the cost summary", which is a question the person paying is entitled to,
 * and which the CLI answered by assuming yes.
 *
 * Client-safe on purpose — the options form renders these defaults before any
 * request is made, so this module must import nothing server-only.
 */

import { isBookLocale } from "./strings";

export type BookOptions = {
  /** A key of `BOOK_SIZES`. */
  size: string;
  /**
   * What language the book's own words are printed in — headings, labels, the
   * colophon, the names of the ways of travelling. See
   * `lib/photobook/strings.ts`.
   *
   * Never the trip's prose, its title or a caption: those are the author's and
   * are printed as written. A German journal was getting German days inside an
   * English book, which is the inconsistency this exists to end — not a
   * translation service.
   */
  locale: string;
  binding: "perfect" | "saddle";
  /** `MediaTile.src` values left out of the book. */
  excludePhotos: readonly string[];
  /** The days' prose and the photo captions. Off gives a photo album with dates. */
  includeText: boolean;
  /** The two-page route spread. */
  includeMap: boolean;
  /** The chapter divider that opens each country. */
  includeChapters: boolean;
  /** Who travelled, on the title page and in the colophon. */
  includeNames: boolean;
  /** The cost summary page. */
  includeCosts: boolean;
};

export const DEFAULT_OPTIONS: BookOptions = {
  size: "square-210",
  locale: "en",
  binding: "perfect",
  excludePhotos: [],
  includeText: true,
  includeMap: true,
  includeChapters: true,
  includeNames: true,
  includeCosts: true,
};

/**
 * A ceiling on `excludePhotos`, past the trust boundary a request body
 * crosses to get here.
 *
 * 20,000 photographs is a trip nobody has taken through this codebase — the
 * example journal has five, a heavily ingested year-long trip has a few
 * thousand — so this is "generous", not "sized to the case at hand". A
 * `src` is a media path (`/user/media/trip/day/file.jpg`); 300 bytes is
 * several times the longest one this repo writes.
 */
const MAX_EXCLUDED_PHOTOS = 20_000;
const MAX_SRC_LENGTH = 300;

/**
 * Read options off a request body.
 *
 * Every field is checked against what the catalogue actually offers. An
 * unrecognised size is not "probably square", it is a request nobody wrote,
 * and the caller gets `null` rather than a book they did not ask for.
 *
 * `excludePhotos` gets the same treatment as everything else here — rejected
 * outright past the ceiling above, not truncated. Truncating would silently
 * un-exclude whatever got cut, printing photographs the owner asked to leave
 * out; refusing the whole request is the only answer that cannot do that.
 */
export function parseOptions(input: unknown, sizes: readonly string[]): BookOptions | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const bool = (key: keyof BookOptions) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : null;

  const size = typeof raw.size === "string" && sizes.includes(raw.size) ? raw.size : null;
  // Checked against what the book can actually print rather than against the
  // journal's own locale list: a journal may offer a language the book has no
  // words for, and printing English headings under a Hungarian title is a
  // better failure than refusing the order.
  const locale = typeof raw.locale === "string" && isBookLocale(raw.locale) ? raw.locale : null;
  const binding = raw.binding === "perfect" || raw.binding === "saddle" ? raw.binding : null;
  const excludePhotos =
    Array.isArray(raw.excludePhotos) &&
    raw.excludePhotos.length <= MAX_EXCLUDED_PHOTOS &&
    raw.excludePhotos.every((s) => typeof s === "string" && s.length <= MAX_SRC_LENGTH)
      ? (raw.excludePhotos as string[])
      : null;
  const flags = {
    includeText: bool("includeText"),
    includeMap: bool("includeMap"),
    includeChapters: bool("includeChapters"),
    includeNames: bool("includeNames"),
    includeCosts: bool("includeCosts"),
  };
  if (!size || !locale || !binding || !excludePhotos || Object.values(flags).some((v) => v === null)) {
    return null;
  }
  // Each of `flags`' values is checked non-null above, but that check does not
  // narrow the object's own type — hence the individual casts rather than one
  // spread, which is what TS actually complained about.
  return {
    size,
    locale,
    binding,
    excludePhotos,
    includeText: flags.includeText as boolean,
    includeMap: flags.includeMap as boolean,
    includeChapters: flags.includeChapters as boolean,
    includeNames: flags.includeNames as boolean,
    includeCosts: flags.includeCosts as boolean,
  };
}
