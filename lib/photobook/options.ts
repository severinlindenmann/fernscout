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
import { COVER_TYPES, type CoverType } from "./spec";

export type BookOptions = {
  /** A key of `BOOK_SIZES`. */
  size: string;
  /**
   * Soft or hard. Asked before the size, because the two do not offer the
   * same sizes — there is no 280 mm softcover and no 140 mm hardcover — and
   * asking this way shows a full grid of three either way instead of greying
   * one out. Not `cover`, which is the cover *photograph* and has been that
   * since long before Gelato was connected.
   */
  coverType: CoverType;
  /**
   * What language the book's own words are printed in — headings, labels, the
   * colophon, the names of the ways of travelling. See
   * `lib/photobook/strings.ts`.
   *
   * Saved entry translations in this language are used for the day's prose and
   * title. Missing translations fall back to what the author wrote; choosing a
   * language never invokes a translation service. The trip title and captions
   * are still printed as written.
   */
  locale: string;
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
  /** The cost summary page. `initialBookOptions` turns this on for a first
   * visit to the order page exactly when the trip has a budget to show — B642. */
  includeCosts: boolean;
  /**
   * The chart pages — spend against the budget, and the trip's weather. B565.
   *
   * **Off in `DEFAULT_OPTIONS` below, and on in `initialBookOptions`
   * whenever there is something to chart — B642.** Somebody printing a book
   * of photographs may not want a page of charts in it, so this is the one
   * include-switch that adds pages rather than defending ones the book has
   * always had, and a trip with neither a budget nor `weatherData` still
   * starts off, exactly as it always has. But a trip that recorded *both* was
   * usually costed and measured on purpose, and the owner has gone to the
   * trouble already — so the order page's first visit turns this on for
   * them rather than leaving a page they earned unnoticed. Still a switch: a
   * saved arrangement, or a caller that skips the composer, is untouched by
   * this and gets the constant below.
   *
   * On, it prints what the trip actually recorded and nothing else: no costs
   * means no spend page, no `weatherData` means no weather page, and neither
   * means the switch quietly adds nothing.
   */
  includeCharts: boolean;
  /**
   * The party, drawn small at the foot of every chapter divider — B727.
   *
   * The walking figures are already on the title page and in the colophon
   * (`drawTravellers`), which is twice in a book of sixty pages. The owner
   * asked for them somewhere else too, and the chapter divider is the page
   * with the room: a country's name, its dates, and otherwise paper.
   *
   * Off by default, like every other switch that adds ink. It draws nothing
   * at all when the journal has described nobody (`source.figures` empty) or
   * when there are no chapter pages to draw them on — a switch that adds
   * nothing quietly is better than a page of decoration nobody asked for.
   */
  includeFigureMarks: boolean;
  /**
   * The way each leg was travelled, drawn on the transport page — B737.
   *
   * The travel scene's own vehicles (`lib/travel/vehicleShapes.ts`), which the
   * site has drawn on its front page since long before the book could. Off by
   * default like every other switch that adds ink, and it adds no page of its
   * own: the transport page already exists when a trip records how it moved,
   * and this puts a bus beside the word "bus" on it.
   */
  includeVehicles: boolean;
  /**
   * The photograph on the front cover, as a `MediaTile.src`.
   *
   * Absent means the planner picks, which is what every book did before this
   * existed — the first photograph of the first chapter, via `coverFor` in
   * `lib/photobook/plan.ts`. Ignored the same way `hero` is when the named
   * photograph is no longer in the book: an arrangement outlives the entry it
   * was made against, and a cover that names a gap is worse than one nobody
   * chose.
   */
  cover?: string;
  /**
   * What is printed down the spine, when the owner has said — B1544.
   *
   * Absent or blank means derive it, which is `spineTextFor()` in
   * `lib/photobook/plan.ts`: the trip's title, and its start year appended
   * unless the title already carries it. That default is right for most
   * books and was wrong for the one that produced this field — a trip called
   * "Algarve 2026" printed as "Algarve 2026 · 2026" — but the deeper problem
   * was that the derived string was the only string available. The spine is
   * the one part of the object that lives on a shelf being read edge-on for
   * thirty years, and its owner is entitled to write it.
   *
   * Capped at {@link MAX_SPINE_TEXT} characters, which is not a style rule:
   * the spine runs the height of the book, the smallest of which is 140 mm,
   * and type that outruns it is clipped at both ends by the trim. See the
   * constant.
   */
  spineText?: string;
  /**
   * Where a photograph is cropped from, when it is cropped at all — B513.
   *
   * Keyed by `MediaTile.src`, the same key `excludePhotos` and `DayPlan.photos`
   * use. `x` is a fraction across the photograph, `y` a fraction down it; a
   * photograph with no entry crops from its centre (0.5, 0.5), which is what
   * every photograph did before this existed.
   *
   * Lives here rather than on the photograph itself: the same picture prints
   * as a hero on one page and a quarter on another, and which point saves it
   * can differ between the two — see B513's decision record for why this is
   * not written into the entry's frontmatter.
   */
  focalPoints: Record<string, Focal>;
};

/** A crop's anchor, both axes 0–1. See `BookOptions.focalPoints`. */
export type Focal = { x: number; y: number };

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
  /**
   * Which photograph runs big, when the day has a page that runs big.
   *
   * A `MediaTile.src`, and only a hint: the planner decides *whether* this day
   * gets a hero at all — a chapter's first day and roughly every third after
   * it, or a day the owner set to `hero`. This says *which* photograph takes
   * it when one is going. Somebody looking at four pictures knows which is the
   * one; the planner only knows which is first.
   *
   * Ignored when the named photograph is not in the day's list, for the same
   * reason `photos` drops what no longer exists: an arrangement outlives the
   * entry it was made against.
   */
  hero?: string;
  /**
   * Let this day's words continue onto a second page when they do not fit
   * beside its photograph — B517.
   *
   * Absent or `false` is today's behaviour exactly: the prose is measured
   * against the space left beside the day's shared photograph, cut short at
   * whatever fits, and the page says "(continued on the website)" —
   * `text-truncated` in `BookWarning`. That default has to hold for a day
   * nobody has touched, so it is opt-in rather than automatic even for a day
   * that visibly overflows.
   *
   * `true` gives the day a second page instead of cutting it: the shared
   * photograph moves there with it if the day has a spare photograph left
   * once the first page's is spoken for, or the second page runs text alone
   * if it does not — B517 ruled out manufacturing a photograph, or a
   * half-empty page, to fill it. Not doing: shrinking the type to fit, which
   * the ticket ruled out for the same reason every other page keeps one
   * scale.
   */
  runOn?: boolean;
  /**
   * Leave this day out of the book entirely — B564. Its day page, its
   * photographs and its place in the chapter all go; a chapter left with no
   * remaining days prints no divider (`chaptersOf` never groups an empty
   * list). Absent or `false` is every day's behaviour before this existed.
   *
   * Deliberately not read by `routeView` or anything under "front matter": a
   * day the book leaves out is still a place the trip went, not a place it
   * did not, so the route map and the rest of the trip's own numbers are
   * unaffected.
   */
  excluded?: boolean;
  /**
   * Leave *this day's* prose out, while the rest of the book keeps its text
   * — B703.
   *
   * Absent means "as the book says", which is `BookOptions.includeText`.
   * `false` is the only other value that means anything: a day narrows the
   * book's decision and never widens it, so `text: true` on a book printed
   * without text prints nothing extra. That direction is deliberate — the
   * book-level switch is the one an owner sets once, and a day should not be
   * able to smuggle prose past it.
   *
   * It exists because a trip usually has two or three days whose words are
   * logistics — *drove four hours, arrived late* — among twenty that are
   * worth printing, and the only choice before this was all of them or none.
   */
  text?: boolean;
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
  size: "square",
  coverType: "soft",
  locale: "en",
  excludePhotos: [],
  days: {},
  includeText: true,
  includeMap: true,
  includeChapters: true,
  includeNames: true,
  includeCosts: true,
  includeCharts: false,
  includeFigureMarks: false,
  includeVehicles: false,
  focalPoints: {},
};

/**
 * The book a fresh visit to the order page starts from — B642.
 *
 * `DEFAULT_OPTIONS` above is the constant fallback for a caller that skips
 * the composer entirely (`planBook`'s own default parameter, and the tests
 * that build a book without one); this is what a person actually sees the
 * first time they open the order page for a trip. The composer passes it as
 * `usePersistedState`'s `initial` value, which only speaks when nothing has
 * been saved yet — a saved arrangement, `includeCosts` and `includeCharts`
 * included, is never touched by this.
 *
 * `includeCharts` turns on only when there is both a budget and weather to
 * chart; `includeCosts` turns on whenever there is a budget, whether or not
 * the trip was measured. A trip with neither starts both off, exactly as
 * `DEFAULT_OPTIONS` always has.
 */
export function initialBookOptions(
  locale: string,
  hasCosts: boolean,
  hasWeather: boolean,
  /** Whether anybody has been described, and whether any day says how it was
   * travelled — the two drawings, B756. */
  hasFigures = false,
  hasTransport = false,
): BookOptions {
  return {
    ...DEFAULT_OPTIONS,
    locale,
    includeCosts: hasCosts,
    includeCharts: hasCosts && hasWeather,
    // On where there is something to draw — B756.
    //
    // Both shipped off, on the reasoning that a switch which adds ink should
    // be asked for. That reasoning holds for a page of charts and fails for
    // these two: the owner who asked for them went through the questions,
    // was shown both tiles, and reported that the vehicles did not work. A
    // feature somebody has to find is a feature they do not have.
    //
    // The same rule `includeCharts` already follows, and the same safety: a
    // journal that has described nobody and a trip that never said how it
    // moved both start off, because there `hasFigures` and `hasTransport` are
    // false and the switches would draw nothing anyway. Still switches — a
    // saved arrangement is untouched by this, and the panel turns them off.
    includeFigureMarks: hasFigures,
    includeVehicles: hasTransport,
  };
}

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
 * How long a spine title may be — B1544.
 *
 * Not a taste limit. `renderCover` sets the spine title rotated and centred
 * on the panel's full height and does not measure it against anything, so
 * text longer than the book is tall runs off both ends and is trimmed away.
 * The shortest book here is 140 mm tall, and the spine face is set at 7 pt or
 * less, where an average character is about 1.4 mm — call it a hundred
 * characters before the smallest book is in trouble. Sixty leaves room for
 * the wide-letter cases and is well past any title anybody writes.
 *
 * The number is enforced twice on purpose: `maxLength` on the composer's own
 * field, so it cannot be typed, and here, so it cannot be posted.
 */
export const MAX_SPINE_TEXT = 60;
/** One entry per photograph anybody has actually tapped, which is a small
 * fraction of a journal's photographs. Sized like `MAX_EXCLUDED_PHOTOS`
 * rather than smaller: both are the same shape of dictionary keyed by `src`,
 * and there is no reason a crop would be rarer than an exclusion. */
const MAX_FOCAL_POINTS = 20_000;

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
    if (day.hero !== undefined) {
      if (typeof day.hero !== "string" || day.hero.length > MAX_SRC_LENGTH) return null;
      plan.hero = day.hero;
    }
    if (day.photos !== undefined) {
      if (!Array.isArray(day.photos) || day.photos.length > MAX_PHOTOS_PER_DAY) return null;
      if (!day.photos.every((s) => typeof s === "string" && s.length <= MAX_SRC_LENGTH)) return null;
      plan.photos = day.photos as string[];
    }
    if (day.runOn !== undefined) {
      if (typeof day.runOn !== "boolean") return null;
      plan.runOn = day.runOn;
    }
    if (day.excluded !== undefined) {
      if (typeof day.excluded !== "boolean") return null;
      plan.excluded = day.excluded;
    }
    if (day.text !== undefined) {
      if (typeof day.text !== "boolean") return null;
      plan.text = day.text;
    }
    // A day carrying none of these is the planner's again, and saying so by
    // leaving it out keeps the posted body honest about what was actually
    // chosen.
    if (
      plan.layout !== undefined ||
      plan.photos !== undefined ||
      plan.hero !== undefined ||
      plan.runOn !== undefined ||
      plan.excluded !== undefined ||
      plan.text !== undefined
    ) {
      out[date] = plan;
    }
  }
  return out;
}

/**
 * The crop points, checked one at a time — rejected whole rather than
 * repaired, like `parseDays`: a body that named a bad point is a request
 * nobody wrote, not a request to leave that one photograph centred.
 */
function parseFocalPoints(input: unknown): Record<string, Focal> | null {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_FOCAL_POINTS) return null;

  const isFraction = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

  const out: Record<string, Focal> = {};
  for (const [src, value] of entries) {
    if (src.length > MAX_SRC_LENGTH) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { x, y } = value as Record<string, unknown>;
    if (!isFraction(x) || !isFraction(y)) return null;
    out[src] = { x, y };
  }
  return out;
}

export function parseOptions(input: unknown, sizes: readonly string[]): BookOptions | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const bool = (key: keyof BookOptions) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : null;

  const size = typeof raw.size === "string" && sizes.includes(raw.size) ? raw.size : null;
  // Absent means soft: every order stored before the cover could be chosen
  // was a softcover, so an old payload reads back as exactly what it was.
  const coverType: CoverType | null =
    raw.coverType === undefined
      ? "soft"
      : COVER_TYPES.includes(raw.coverType as CoverType)
        ? (raw.coverType as CoverType)
        : null;
  // Checked against what the book can actually print rather than against the
  // journal's own locale list: a journal may offer a language the book has no
  // words for, and printing English headings under a Hungarian title is a
  // better failure than refusing the order.
  const locale = typeof raw.locale === "string" && isBookLocale(raw.locale) ? raw.locale : null;
  const days = parseDays(raw.days);
  const focalPoints = parseFocalPoints(raw.focalPoints);
  // Optional, and rejected rather than defaulted like every other field here:
  // a `cover` that fails the check is a request nobody wrote, not a request
  // for the planner's own pick — that is what leaving the key out is for.
  let cover: string | undefined;
  if (raw.cover !== undefined) {
    if (typeof raw.cover !== "string" || raw.cover.length > MAX_SRC_LENGTH) return null;
    cover = raw.cover;
  }
  // Refused rather than truncated, for the same reason `cover` is refused
  // rather than defaulted: a caller who sent sixty-one characters asked for
  // something, and quietly printing the first sixty of it onto a book is a
  // worse answer than saying no. Blank is kept out of the arrangement
  // entirely so it reads back as "derive it" — B1544.
  let spineText: string | undefined;
  if (raw.spineText !== undefined) {
    if (typeof raw.spineText !== "string" || raw.spineText.length > MAX_SPINE_TEXT) return null;
    if (raw.spineText.trim()) spineText = raw.spineText.trim();
  }
  const excludePhotos =
    Array.isArray(raw.excludePhotos) &&
    raw.excludePhotos.length <= MAX_EXCLUDED_PHOTOS &&
    raw.excludePhotos.every((s) => typeof s === "string" && s.length <= MAX_SRC_LENGTH)
      ? (raw.excludePhotos as string[])
      : null;
  /**
   * A switch added after this route existed, and therefore optional — B727.
   *
   * Every other flag is required, and a body missing one is refused whole
   * rather than repaired: those have been in the schema since the beginning,
   * so a caller omitting one has misunderstood the request. `includeFigureMarks`
   * is different only in when it arrived — refusing every body written before
   * today would break every stored arrangement and every agent that ever
   * posted one, to insist on a decoration that is off by default anyway.
   * Absent means off, which is what it meant before it existed.
   */
  const figureMarks =
    raw.includeFigureMarks === undefined ? false : bool("includeFigureMarks");
  /** Optional for the same reason as the line above — B737 is newer still. */
  const vehicles = raw.includeVehicles === undefined ? false : bool("includeVehicles");

  const flags = {
    includeText: bool("includeText"),
    includeMap: bool("includeMap"),
    includeChapters: bool("includeChapters"),
    includeNames: bool("includeNames"),
    includeCosts: bool("includeCosts"),
    includeCharts: bool("includeCharts"),
  };
  if (
    !size ||
    !coverType ||
    !locale ||
    !excludePhotos ||
    !days ||
    !focalPoints ||
    figureMarks === null ||
    vehicles === null ||
    Object.values(flags).some((v) => v === null)
  ) {
    return null;
  }
  // Each of `flags`' values is checked non-null above, but that check does not
  // narrow the object's own type — hence the individual casts rather than one
  // spread, which is what TS actually complained about.
  return {
    size,
    coverType,
    locale,
    excludePhotos,
    days,
    focalPoints,
    includeText: flags.includeText as boolean,
    includeMap: flags.includeMap as boolean,
    includeChapters: flags.includeChapters as boolean,
    includeNames: flags.includeNames as boolean,
    includeCosts: flags.includeCosts as boolean,
    includeCharts: flags.includeCharts as boolean,
    includeFigureMarks: figureMarks,
    includeVehicles: vehicles,
    ...(cover !== undefined ? { cover } : {}),
    ...(spineText !== undefined ? { spineText } : {}),
  };
}
