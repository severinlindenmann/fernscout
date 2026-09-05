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
  /**
   * What a particular day should look like, where the owner has said.
   *
   * Keyed by the day's date, which is what a day *is* here: `getDays` groups
   * entries by date and the planner works from that grouping, so a slug would
   * name one update rather than the day a reader turns to.
   *
   * Absent, or a date not in here, means the planner decides — which is still
   * the normal case and still what most books will be. This is an override,
   * not a layout format: `lib/photobook/plan.ts` opens by explaining why it
   * has no template system, and a day the owner has not touched must plan
   * exactly as it did before this existed.
   */
  days: Record<string, DayPlan>;
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

/**
 * One day's arrangement, as a person chose it.
 *
 * `layout` names the shape of the day rather than the shape of a page,
 * because that is the decision somebody is actually making — "this was the day
 * of the big picture" — and because it leaves the planner free to keep
 * deciding which page each part lands on, which hand it faces and where the
 * gutter is. Those are geometry, and geometry is not a thing to put in front
 * of somebody choosing photographs.
 */
export type DayPlan = {
  /**
   * The photographs to print for this day, as `MediaTile.src` values, in the
   * order they should appear.
   *
   * Absent means every photograph the day has, in the order the entries list
   * them — which is what the book did before this existed. An empty array
   * means the owner took them all out, and is not the same thing as absent.
   */
  photos?: string[];
  layout?: DayLayout;
};

export type DayLayout =
  /** The planner decides, as it always has. */
  | "auto"
  /** One photograph filling the paper, then the rest grouped. */
  | "hero"
  /** Every photograph on its own page, running to the outer edge. */
  | "single"
  /** Two to a page. */
  | "pair"
  /** Four to a page where the shapes allow it. */
  | "grid"
  /** The day's words and nothing else. */
  | "text";

export const DAY_LAYOUTS: readonly DayLayout[] = ["auto", "hero", "single", "pair", "grid", "text"];

export const DEFAULT_OPTIONS: BookOptions = {
  size: "square-210",
  locale: "en",
  binding: "perfect",
  excludePhotos: [],
  days: {},
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
/** A trip is days, not years of them; a book maxes out at 160 pages and a
 * volume split is the answer beyond that. Generous against any real journey. */
const MAX_DAYS = 2_000;
/** Nobody arranges a single day out of more photographs than this, and the
 * planner would not fit them on one day's pages if they tried. */
const MAX_PHOTOS_PER_DAY = 500;

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
/**
 * The per-day overrides, checked one at a time.
 *
 * Rejects rather than repairs, like everything else here: a body that has been
 * tampered with, or written by a page from a different version, should be
 * refused whole rather than half-honoured. Silently dropping the days it could
 * not read would print a book missing the arrangement somebody spent an
 * evening on and say nothing about it.
 *
 * The **keys are dates and are validated as dates**, because a key from this
 * object is compared against `BookDay.date` and nothing else — it never
 * reaches a filesystem — but a loose `Record<string, …>` from a request body
 * is the shape that later grows into one. `YYYY-MM-DD` and no more.
 */
function parseDays(input: unknown): Record<string, DayPlan> | null {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_DAYS) return null;

  const out: Record<string, DayPlan> = {};
  for (const [date, value] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const day = value as Record<string, unknown>;

    const plan: DayPlan = {};
    if (day.layout !== undefined) {
      if (typeof day.layout !== "string" || !DAY_LAYOUTS.includes(day.layout as DayLayout)) {
        return null;
      }
      plan.layout = day.layout as DayLayout;
    }
    if (day.photos !== undefined) {
      if (!Array.isArray(day.photos) || day.photos.length > MAX_PHOTOS_PER_DAY) return null;
      if (!day.photos.every((s) => typeof s === "string" && s.length <= MAX_SRC_LENGTH)) return null;
      plan.photos = day.photos as string[];
    }
    // A day carrying neither is the planner's again, and saying so by leaving
    // it out keeps the posted body honest about what was actually chosen.
    if (plan.layout !== undefined || plan.photos !== undefined) out[date] = plan;
  }
  return out;
}

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
  const days = parseDays(raw.days);
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
  if (
    !size ||
    !locale ||
    !binding ||
    !excludePhotos ||
    !days ||
    Object.values(flags).some((v) => v === null)
  ) {
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
    days,
    includeText: flags.includeText as boolean,
    includeMap: flags.includeMap as boolean,
    includeChapters: flags.includeChapters as boolean,
    includeNames: flags.includeNames as boolean,
    includeCosts: flags.includeCosts as boolean,
  };
}
