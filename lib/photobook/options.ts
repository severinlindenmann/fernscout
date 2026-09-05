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

export type BookOptions = {
  /** A key of `BOOK_SIZES`. */
  size: string;
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
  binding: "perfect",
  excludePhotos: [],
  includeText: true,
  includeMap: true,
  includeChapters: true,
  includeNames: true,
  includeCosts: true,
};
