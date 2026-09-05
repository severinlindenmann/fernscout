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

/**
 * Read options off a request body.
 *
 * Every field is checked against what the catalogue actually offers. An
 * unrecognised size is not "probably square", it is a request nobody wrote,
 * and the caller gets `null` rather than a book they did not ask for.
 */
export function parseOptions(input: unknown, sizes: readonly string[]): BookOptions | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const bool = (key: keyof BookOptions) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : null;

  const size = typeof raw.size === "string" && sizes.includes(raw.size) ? raw.size : null;
  const binding = raw.binding === "perfect" || raw.binding === "saddle" ? raw.binding : null;
  const excludePhotos = Array.isArray(raw.excludePhotos)
    ? raw.excludePhotos.filter((s): s is string => typeof s === "string")
    : null;
  const flags = {
    includeText: bool("includeText"),
    includeMap: bool("includeMap"),
    includeChapters: bool("includeChapters"),
    includeNames: bool("includeNames"),
    includeCosts: bool("includeCosts"),
  };
  if (!size || !binding || !excludePhotos || Object.values(flags).some((v) => v === null)) {
    return null;
  }
  // Each of `flags`' values is checked non-null above, but that check does not
  // narrow the object's own type — hence the individual casts rather than one
  // spread, which is what TS actually complained about.
  return {
    size,
    binding,
    excludePhotos,
    includeText: flags.includeText as boolean,
    includeMap: flags.includeMap as boolean,
    includeChapters: flags.includeChapters as boolean,
    includeNames: flags.includeNames as boolean,
    includeCosts: flags.includeCosts as boolean,
  };
}
