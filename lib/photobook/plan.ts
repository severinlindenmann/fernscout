/**
 * A trip becomes a page plan.
 *
 * This module is pure: no filesystem, no PDF, no image decoding. It takes a
 * `BookSource` — the trip flattened into days, photos and numbers — and
 * returns the exact sequence of pages, with every rectangle already measured
 * in millimetres from the trim corner. The renderer then does nothing but
 * draw what it is told, and the whole layout can be unit-tested without a byte
 * of PDF.
 *
 * The layout is **opinionated, not configurable**. There is no template
 * system, no theme layer and no per-trip override, because there is one user
 * and a template system is a way of avoiding the decision rather than making
 * it. The decisions taken here, once:
 *
 *  - **Every day opens with its own page** — date, place, what happened. The
 *    trip is a journal; a book of photographs without the writing is a
 *    different, lesser object.
 *  - **A day's words share their page with a photograph**, which fills the
 *    foot of it and bleeds off three edges. A heading and three lines of prose
 *    alone on a 210mm page reads as a mistake rather than as space.
 *  - **Some days open with a photograph that fills the paper**, and
 *    deliberately not all of them: a chapter's first day and roughly every
 *    third after it. When every photograph is the loudest, none of them is,
 *    and the rhythm a reader moves through never changes.
 *  - **The rest are framed** in grids chosen by aspect ratio, with the caption
 *    underneath where there is room for it. A photograph with no group to join
 *    runs to the outer edge rather than floating in the middle of the page.
 *  - **Countries are chapters.** Not weeks, not "highlights" — a border is the
 *    thing a reader already has a mental model for.
 *  - **A book that would exceed the binder's maximum becomes several volumes**
 *    rather than a brick or a silent truncation.
 */

import type { Figure } from "../travellers/vocabulary";
import {
  bleedBoxMm,
  contentBoxMm,
  effectiveDpi,
  mm,
  normalisePageCount,
  requiredPixels,
  sideOf,
  spineWidthMm,
  type BookSpec,
  type PageSide,
  type RectMm,
} from "./spec.ts";
import { formatDate, formatDateRange, wrap } from "./text.ts";
import { isPlottable } from "../mapFrame.ts";
import { DEFAULT_OPTIONS, type BookOptions, type DayLayout, type Focal } from "./options.ts";
import { bookStrings, fill, type BookStrings } from "./strings.ts";
import {
  costsShapes,
  spendPageShapes,
  transportShapes,
  weatherPageShapes,
  type ChartShape,
} from "./charts.ts";

// ---------------------------------------------------------------------------
// What the planner is given
// ---------------------------------------------------------------------------

export type BookPhoto = {
  /** Opaque to the planner; the renderer resolves it to bytes. The source
   * writes it relative to whichever root holds it, so it is also readable
   * enough to be the label in a warning — see `bookFile` in `source.ts` for
   * why it is not an absolute path. */
  file: string;
  /** Overrides `file` in a warning, for a caller that has a better name. */
  label?: string;
  width: number;
  height: number;
  caption?: string;
  /** Set when this is the web derivative because the kept original could not
   * be printed. The planner says so in any low-resolution warning, so a soft
   * page is never explained by resolution alone (B13). */
  fallbackReason?: string;
  /**
   * The entry's own gallery `src` — the web derivative a browser can actually
   * fetch, e.g. `/media/alps-2024/grimsel-and-rain/01.jpg`. Never the print
   * file: `file` above may be content-root-relative or carry an `originals:`
   * prefix pointing outside anything the web server serves (see `bookFile` in
   * `source.ts`), so a preview needs this instead. Optional only so the
   * hand-built `BookPhoto` fixtures in the planner's own tests, which never
   * reach a web preview, keep compiling; `buildBookSource` always sets it.
   */
  webSrc?: string;
  /**
   * Where `cover()` crops from, when it crops at all — B513.
   *
   * Set from `BookOptions.focalPoints` by `withFocal` below, keyed by
   * `webSrc`, before a day's photographs reach any placement code. Absent
   * means the centre, which is what `cover()` has always done.
   */
  focal?: Focal;
};

export function labelOf(photo: BookPhoto): string {
  return photo.label ?? photo.file;
}

export type BookDay = {
  date: string;
  title: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  paragraphs: string[];
  photos: BookPhoto[];
  /**
   * How this day was travelled, when the entry recorded it.
   *
   * `mode` is one of the site's own `TransportMode` values. The book prints
   * it on the day's page and counts it on the "how we moved" page; a day that
   * never said is simply a day with no line about it, which is most of them
   * on most trips.
   */
  transport?: { mode: string; from: string; to: string };
};

export type BookCosts = {
  baseCurrency: string;
  total: number;
  preparation: number;
  onTheRoad: number;
  perDay: number;
  byCategory: { category: string; amount: number }[];
  byCountry: { country: string; amount: number; nights: number }[];
  budget?: { total: number; days: number };
  /**
   * What each day of the trip cost, and the running total — B565.
   *
   * The same `byDay` the site's own cost page charts, carried through so the
   * book can draw the shape of the spending rather than only its sum. Empty on
   * a trip that has not begun, which is why the analytics page checks it
   * rather than assuming a trip with a total has days.
   */
  byDay: { date: string; amount: number; cumulative: number }[];
  /** Planned cumulative spend, one value per entry of `byDay`, when the trip
   * declared a budget. Absent otherwise, and never manufactured. */
  budgetCurve?: number[];
};

/**
 * The trip's own weather, as `lib/weatherStats.ts` already added it up — B565.
 *
 * Structural rather than the summary type itself so `plan.ts` stays pure and
 * free of the site's day reader; `source.ts` maps `summariseWeather`'s answer
 * onto it and computes nothing of its own. **Every number here is a
 * measurement out of a day's `weatherData`.** A day with no reading appears in
 * `byDay` with nothing in it, which is what puts the gap in the chart.
 */
export type BookWeather = {
  measured: number;
  missing: number;
  avgHigh?: number;
  avgLow?: number;
  byDay: { date: string; tempMin?: number; tempMax?: number; precipitation?: number }[];
  /** Every distinct source, in the order first seen, for the credit line. */
  sources: string[];
};

export type RoutePoint = {
  location: string;
  country: string;
  lat: number;
  lng: number;
};

export type BookSource = {
  trip: { id: string; title: string; tagline?: string; start: string; end: string; intro: string };
  /** Who is credited, by name. The byline. */
  travellers: string[];
  /**
   * How they are **drawn** — see lib/travellers/. A different question from
   * the byline above, and empty when nobody has been described, in which case
   * the book prints no figures at all rather than guessing (B497).
   */
  figures: Figure[];
  days: BookDay[];
  route: RoutePoint[];
  costs?: BookCosts;
  /** Absent when the journal has the capability off, or when no day of the
   * trip carries a reading. Never synthesised. */
  weather?: BookWeather;
  /** The date printed in the colophon. Passed in rather than read from the
   * clock so that a plan is reproducible and testable. */
  madeOn: string;
  siteUrl?: string;
  /**
   * The people this journal let in, by name.
   *
   * **Names and nothing else.** Never an address, never an email — the same
   * rule `lib/postcard/receipt.ts` states for mail, and for the same reason:
   * a book is handed around, left on a table and eventually given away, which
   * is a worse place for somebody's address than an inbox.
   *
   * Passed in rather than read here: contacts are rows and this module is
   * pure. `buildBookSource` cannot reach a database and should not learn how.
   */
  followers?: string[];
  /** Warnings raised while the source was assembled — a photograph printed
   * from its web copy, for instance. Whoever built the source knows things
   * the planner cannot see, and they belong in the same list. */
  notes?: BookWarning[];
};

// ---------------------------------------------------------------------------
// What the planner produces
// ---------------------------------------------------------------------------

export type PhotoLayout =
  | "full-bleed"
  | "panorama"
  | "single"
  | "feature"
  | "pair-portrait"
  | "pair-stacked"
  | "quad";

export type PhotoPlacement = {
  photo: BookPhoto;
  /** The slot. The image is clipped to this. */
  clip: RectMm;
  /** Where the image is drawn — larger than `clip` when it is cover-cropped. */
  draw: RectMm;
  caption?: string;
  captionBox?: RectMm;
  /** Resolution the photo actually prints at, at this size. */
  dpi: number;
};

/** The equirectangular space the baked world outline lives in (lib/worldLand.json). */
export const MAP_SPACE = { width: 1000, height: 500 };

export type RouteView = { x: number; y: number; width: number; height: number };

export type MappedPoint = { location: string; country: string; x: number; y: number };

/**
 * The include-switch that put a page in the book, when one did — B562.
 *
 * A key of `BookOptions`, so the composer can caption the page with the words
 * that switch uses on the settings panel ("the route map", "the cost
 * summary") rather than with the planner's own name for the page kind. Named
 * here rather than derived from `kind` in the renderer for B517's reason: the
 * gating decision is made in `draftsForFront`/`draftsForBack`/
 * `draftsForChapter`, and a second copy of it elsewhere is a copy that drifts.
 */
export type BookPageOption =
  | "includeText"
  | "includeMap"
  | "includeChapters"
  | "includeCosts"
  | "includeCharts";

export type BookPage = { number: number; side: PageSide; from?: BookPageOption } & (
  | {
      kind: "title";
      title: string;
      tagline?: string;
      dates: string;
      travellers: string;
      /** How to draw the party above the title. Empty draws nobody. */
      figures: Figure[];
      volume?: string;
    }
  | { kind: "intro"; heading: string; lines: string[] }
  | {
      kind: "route";
      /** A route spread is two facing pages showing one map. */
      half: "left" | "right";
      view: RouteView;
      points: MappedPoint[];
      caption: string;
    }
  | {
      kind: "chapter";
      /** "Chapter 2 of 5", already in the book's language. */
      label: string;
      country: string;
      countryCode?: string;
      dates: string;
      stats: string;
      index: number;
      of: number;
    }
  | {
      kind: "day";
      date: string;
      dateLabel: string;
      title: string;
      location: string;
      lines: string[];
      truncated: boolean;
      captions: string[];
      /** "(continued on the website)", in the book's language. */
      continued: string;
      /** Set when the day's words share their page with a photograph — see
       * the note beside PHOTO_SHARE in `materialise`. */
      photo?: PhotoPlacement;
      /** "Drove · Zion National Park → Bryce Canyon", when the entry said so. */
      leg?: { mode: string; text: string };
    }
  | {
      kind: "photos";
      layout: PhotoLayout;
      placements: PhotoPlacement[];
      /**
       * The day this spread belongs to, when it belongs to one — B534.
       *
       * Set in `materialise` from the draft it came from, which is set in
       * `draftsForChapter` from `chapterDay.date` and carried through
       * `expandToMinimum`'s split. Absent for front matter (title, route,
       * costs, colophon), which belongs to no day. Do not reconstruct this by
       * scanning backwards to the nearest preceding "day" page — that
       * silently attaches the wrong day the first time the page order
       * changes, which is exactly the bug B517 already fixed once for
       * `BookWarning.date`.
       */
      date?: string;
    }
  | { kind: "followers"; heading: string; note: string; names: string[] }
  | {
      kind: "transport";
      heading: string;
      /** Most-used first. `label` is already the plural a reader wants. */
      modes: { mode: string; label: string; days: number }[];
      /** The longest single leg, when there is one worth naming. */
      note?: string;
      /**
       * The page, drawn — B565.
       *
       * Every mark and every label, in millimetres, computed once here by
       * `lib/photobook/charts.ts` so the PDF and the browser preview cannot
       * disagree about the page a customer is buying. The fields above are
       * kept because they are what a test and the CLI summary read; the
       * renderers read this.
       */
      shapes: ChartShape[];
    }
  | {
      kind: "costs";
      costs: BookCosts;
      heading: string;
      /** Every word on the page, decided here. The renderer draws what it is
       * given — it had these as English literals, which is how the book stayed
       * English while the days it printed were translated. */
      labels: {
        total: string;
        before: string;
        onRoad: string;
        perDay: string;
        budgeted: string;
        spent: string;
        where: string;
        budgetVsActual: string;
        byCountry: string;
        nights: string;
      };
      /** The page, drawn. See the `transport` variant. */
      shapes: ChartShape[];
    }
  | {
      /**
       * A page of charts — B565, and the one page kind that is off unless
       * asked for. Somebody printing a book of photographs may not want a
       * page of charts in it.
       *
       * One kind rather than one per subject: the page is nothing but its
       * shapes by the time it reaches a renderer, and a second variant would
       * be a second switch statement in both of them saying the same thing.
       */
      kind: "analytics";
      /** Which chart page this is, for tests and the CLI summary. */
      topic: "spend" | "weather";
      heading: string;
      shapes: ChartShape[];
    }
  | { kind: "colophon"; heading: string; lines: string[]; figures: Figure[] }
  | { kind: "blank" }
);

export type CoverPlan = {
  /** back cover + spine + front cover + bleed on all four edges. */
  widthMm: number;
  heightMm: number;
  spineWidthMm: number;
  frontPhoto?: BookPhoto;
  title: string;
  subtitle?: string;
  dates: string;
  spineText: string;
  backLines: string[];
};

export type BookVolume = {
  index: number;
  of: number;
  title: string;
  pages: BookPage[];
  interiorPages: number;
  spineWidthMm: number;
  cover: CoverPlan;
};

export type BookWarning = {
  code:
    | "low-resolution"
    | "no-original"
    | "no-photos"
    | "split-into-volumes"
    | "text-truncated"
    | "blank-padding"
    | "page-count";
  detail: string;
  /**
   * How many things this one warning stands for, when it stands for more than
   * itself — B549. `no-original` is raised once per *reason* and speaks for
   * every photograph that fell back for it, so a UI counting warnings by code
   * would say "one photograph" about fourteen. Absent means one.
   */
  count?: number;
  /**
   * The day this warning is about, when it is about one — `text-truncated`
   * only, so far. A UI that needs to know which day overflowed has to read
   * this rather than parse `detail`: that string is prose for a person, and
   * rewording it (or translating it, or reordering it) must not silently
   * break something that was reading it as data.
   */
  date?: string;
};

export type Photobook = {
  tripId: string;
  title: string;
  spec: BookSpec;
  volumes: BookVolume[];
  warnings: BookWarning[];
  photoCount: number;
};

// ---------------------------------------------------------------------------
// Typography. One scale, derived from the page, so a book at any trim size
// keeps its proportions instead of needing a second set of numbers.
// ---------------------------------------------------------------------------

export function typeScale(spec: BookSpec) {
  const unit = spec.size.trimHeightMm / 210;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    display: round(30 * unit),
    heading: round(17 * unit),
    subheading: round(11 * unit),
    body: round(9.6 * unit),
    caption: round(7.4 * unit),
    folio: round(7.4 * unit),
    leading: 1.5,
  };
}

const GAP_MM = 6;

/** Only ever reached if a costs page is drafted for a source with no costs,
 * which the drafting code does not do. Present so the type holds without a
 * non-null assertion. */
/**
 * How money is written on a printed page.
 *
 * One copy, because the costs page and the chart pages must agree — the same
 * reason the geometry has one copy. Grouped with the English separator
 * whatever the book's language, which is what this file did before B565 and
 * is a separate question from translating it.
 */
function moneyIn(currency: string): (n: number) => string {
  return (n) => `${currency} ${Math.round(n).toLocaleString("en-GB")}`.trim();
}

const EMPTY_COSTS: BookCosts = {
  baseCurrency: "",
  total: 0,
  preparation: 0,
  onTheRoad: 0,
  perDay: 0,
  byCategory: [],
  byCountry: [],
  byDay: [],
};

// ---------------------------------------------------------------------------
// Placing photographs
// ---------------------------------------------------------------------------

function aspect(photo: BookPhoto): number {
  return photo.height > 0 ? photo.width / photo.height : 1;
}

type Orientation = "portrait" | "landscape" | "square";

function orientation(photo: BookPhoto): Orientation {
  const a = aspect(photo);
  if (a > 1.15) return "landscape";
  if (a < 0.87) return "portrait";
  return "square";
}

function isPanorama(photo: BookPhoto): boolean {
  return aspect(photo) >= 1.9;
}

/** The centre — every photograph's crop before B513, and still the default
 * for one nobody has tapped. */
const CENTRE: Focal = { x: 0.5, y: 0.5 };

/**
 * Fills the slot, cropping the overflow. Used wherever a grid has to line up.
 *
 * `photo.focal` says which part survives the crop: `x` is a fraction across
 * the photograph and `y` a fraction down it, ordinary image-space, top-left
 * origin. This file's rectangles are **y-upwards** (see `mapProjector`'s own
 * note), so the two axes are not symmetric here — `x` scales the offset
 * directly, `y` scales the offset from the far side, `(1 - focal.y)`, so that
 * `y: 0` still means "keep the top" rather than "keep the bottom".
 *
 * At `CENTRE` this is exactly the old centring formula, and whenever a
 * dimension is not actually cropped (`slot.width - width` or
 * `slot.height - height` is 0) the corresponding half of `focal` has no
 * effect at all — a focal point on an uncropped photograph changes nothing.
 */
function cover(photo: BookPhoto, slot: RectMm, focal: Focal = CENTRE): RectMm {
  const scale = Math.max(slot.width / photo.width, slot.height / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    x: slot.x + (slot.width - width) * focal.x,
    y: slot.y + (slot.height - height) * (1 - focal.y),
    width,
    height,
  };
}

/** Fits inside the slot without cropping. Used where the photograph, not the
 * grid, is the thing being respected. */
function contain(photo: BookPhoto, slot: RectMm): RectMm {
  const scale = Math.min(slot.width / photo.width, slot.height / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  };
}

function placement(
  photo: BookPhoto,
  slot: RectMm,
  mode: "cover" | "contain",
  caption?: string,
  captionHeight = 0,
): PhotoPlacement {
  const inner: RectMm =
    captionHeight > 0
      ? { ...slot, y: slot.y + captionHeight, height: slot.height - captionHeight }
      : slot;
  const draw = mode === "cover" ? cover(photo, inner, photo.focal) : contain(photo, inner);
  const clip = mode === "cover" ? inner : draw;
  return {
    photo,
    clip,
    draw,
    caption,
    captionBox:
      captionHeight > 0
        ? { x: clip.x, y: slot.y, width: clip.width, height: captionHeight }
        : undefined,
    dpi: effectiveDpi(photo.width, draw.width),
  };
}

/**
 * Slots for a layout, in trim-relative millimetres.
 *
 * Everything except `full-bleed` and `panorama` stays inside the content box,
 * which already has the gutter on the correct side for this page.
 */
function slotsFor(layout: PhotoLayout, spec: BookSpec, side: PageSide): RectMm[] {
  const c = contentBoxMm(spec, side);
  const b = bleedBoxMm(spec);
  switch (layout) {
    case "full-bleed":
      return [b];
    case "panorama":
      return [{ x: b.x, y: c.y + c.height / 4, width: b.width, height: c.height / 2 }];
    case "single":
      return [c];
    /**
     * One photograph, printed as though somebody chose to print it.
     *
     * `single` contains the image in the whole content box, which is square,
     * so a portrait photograph lands as a tall sliver with a hand's width of
     * paper either side of it and the caption stranded underneath. That is
     * not the deliberate white space a photobook wants — it is a picture
     * nobody placed.
     *
     * This bleeds to three edges and stops at the gutter, so the photograph
     * runs off the outer edge of the paper and the only margin left is the
     * one the binding needs. The page reads as composed from the fold
     * outwards, and every orientation fills it.
     */
    case "feature": {
      const gutterSide = side === "right" ? spec.gutterMm : spec.safeMm;
      const x = side === "right" ? gutterSide : -spec.bleedMm;
      return [
        {
          x,
          y: -spec.bleedMm,
          width: spec.size.trimWidthMm - gutterSide + spec.bleedMm,
          height: spec.size.trimHeightMm + spec.bleedMm * 2,
        },
      ];
    }
    case "pair-portrait": {
      const w = (c.width - GAP_MM) / 2;
      return [
        { x: c.x, y: c.y, width: w, height: c.height },
        { x: c.x + w + GAP_MM, y: c.y, width: w, height: c.height },
      ];
    }
    case "pair-stacked": {
      const h = (c.height - GAP_MM) / 2;
      return [
        { x: c.x, y: c.y + h + GAP_MM, width: c.width, height: h },
        { x: c.x, y: c.y, width: c.width, height: h },
      ];
    }
    case "quad": {
      const w = (c.width - GAP_MM) / 2;
      const h = (c.height - GAP_MM) / 2;
      return [
        { x: c.x, y: c.y + h + GAP_MM, width: w, height: h },
        { x: c.x + w + GAP_MM, y: c.y + h + GAP_MM, width: w, height: h },
        { x: c.x, y: c.y, width: w, height: h },
        { x: c.x + w + GAP_MM, y: c.y, width: w, height: h },
      ];
    }
  }
}

function placeAll(
  layout: PhotoLayout,
  photos: BookPhoto[],
  spec: BookSpec,
  side: PageSide,
): PhotoPlacement[] {
  const type = typeScale(spec);
  const slots = slotsFor(layout, spec, side);
  // A layout that runs off the paper has nowhere to put a caption: the words
  // would be printed over the photograph or trimmed off. Those pages are
  // captioned from the day's own index page instead.
  const bleeds = layout === "full-bleed" || layout === "panorama" || layout === "feature";
  const captionHeight = bleeds ? 0 : type.caption * 2.1;
  return photos.map((photo, i) => {
    const slot = slots[Math.min(i, slots.length - 1)];
    const hasCaption = captionHeight > 0 && Boolean(photo.caption);
    return placement(
      photo,
      slot,
      layout === "single" ? "contain" : "cover",
      photo.caption,
      hasCaption ? captionHeight : 0,
    );
  });
}

/**
 * The owner's arrangement for one day, or the planner's if they made none.
 *
 * `groupPhotos` chooses by shape — is this a portrait, is that a panorama —
 * which is the right default and is what `auto` keeps. The named layouts are a
 * person overruling it for one particular day, so they force the grouping and
 * let `placeAll` crop to fit rather than asking again what shape anything is.
 *
 * `grid` still asks, because four photographs to a page only works when the
 * shapes allow it: forcing a panorama into a quarter-page crops it to a strip
 * of nothing. Where they do not, it falls back to pairs, which is the nearest
 * honest answer to "small, several to a page".
 */
function groupsFor(
  layout: DayLayout,
  photos: BookPhoto[],
): { layout: PhotoLayout; photos: BookPhoto[] }[] {
  if (layout === "auto" || layout === "hero" || photos.length === 0) return groupPhotos(photos);
  if (layout === "text") return [];
  if (layout === "single") return photos.map((photo) => ({ layout: "feature" as const, photos: [photo] }));

  const size = layout === "grid" ? 4 : 2;
  const groups: { layout: PhotoLayout; photos: BookPhoto[] }[] = [];
  for (let i = 0; i < photos.length; i += size) {
    const slice = photos.slice(i, i + size);
    if (slice.length === 1) {
      groups.push({ layout: "feature", photos: slice });
      continue;
    }
    const squarish = slice.every((p) => !isPanorama(p));
    if (size === 4 && slice.length === 4 && squarish) {
      groups.push({ layout: "quad", photos: slice });
      continue;
    }
    // Two at a time: side by side if both stand up, one above the other
    // otherwise, which is the arrangement that crops least.
    const portraits = slice.slice(0, 2).every((p) => orientation(p) === "portrait");
    groups.push({ layout: portraits ? "pair-portrait" : "pair-stacked", photos: slice.slice(0, 2) });
    if (slice.length > 2) {
      const tail = slice.slice(2);
      const tailPortraits = tail.every((p) => orientation(p) === "portrait");
      groups.push({
        layout: tail.length === 1 ? "feature" : tailPortraits ? "pair-portrait" : "pair-stacked",
        photos: tail,
      });
    }
  }
  return groups;
}

/** How photographs are grouped onto pages. See the module note for why. */
export function groupPhotos(photos: BookPhoto[]): { layout: PhotoLayout; photos: BookPhoto[] }[] {
  const groups: { layout: PhotoLayout; photos: BookPhoto[] }[] = [];
  let i = 0;
  while (i < photos.length) {
    const [a, b, c, d] = [photos[i], photos[i + 1], photos[i + 2], photos[i + 3]];
    if (isPanorama(a)) {
      groups.push({ layout: "panorama", photos: [a] });
      i += 1;
    } else if (b && orientation(a) === "portrait" && orientation(b) === "portrait") {
      groups.push({ layout: "pair-portrait", photos: [a, b] });
      i += 2;
    } else if (
      b &&
      c &&
      d &&
      [a, b, c, d].every((p) => orientation(p) !== "portrait" && !isPanorama(p))
    ) {
      groups.push({ layout: "quad", photos: [a, b, c, d] });
      i += 4;
    } else if (b && !isPanorama(b)) {
      // Any surviving two share a page, stacked. This used to require both to
      // be landscape and the same shape as each other, which almost nothing
      // is: two photographs of different orientations fell through to a page
      // each, so a day with two pictures left became two more leaves and the
      // book never showed two things at once. Stacking a portrait beside a
      // landscape crops one of them, which is a smaller loss than a page of
      // white either side of it.
      groups.push({ layout: "pair-stacked", photos: [a, b] });
      i += 2;
    } else {
      groups.push({ layout: "feature", photos: [a] });
      i += 1;
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

type Chapter = {
  country: string;
  countryCode?: string;
  days: BookDay[];
};

/**
 * What each way of travelling is called in print.
 *
 * The site draws these as icons (`components/TravelScene.tsx`); a book has no
 * hover and no tooltip, so it says the word. Past tense, because the book is
 * written after the fact — "Flew", not "Flight".
 *
 * An unknown mode falls back to the raw value rather than being dropped: a
 * journal that invents `transportMode: "ferry"` should print "Ferry" and not
 * silently lose the leg.
 */
/** The verb for a day's own line — "Drove", "Gefahren". */
function modeVerb(mode: string, s: BookStrings): string {
  return s.modeVerb[mode] ?? mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** The counted noun for the summary — "17 days driving", "1 flight". A book
 * that says "1 flights" is a book that was generated rather than written, so
 * every language spells both out rather than deriving one from the other. */
function modeCount(mode: string, days: number, s: BookStrings): string {
  const table = days === 1 ? s.modeOne : s.modeMany;
  if (table[mode]) return table[mode];
  return fill(days === 1 ? s.modeOtherOne : s.modeOtherMany, { mode });
}

/** Consecutive days in the same country. A country revisited later in the trip
 * becomes a second chapter, which is what actually happened. */
export function chaptersOf(days: BookDay[]): Chapter[] {
  const chapters: Chapter[] = [];
  for (const day of days) {
    const last = chapters[chapters.length - 1];
    if (last && last.country === day.country) {
      last.days.push(day);
      continue;
    }
    chapters.push({ country: day.country || "Elsewhere", countryCode: day.countryCode, days: [day] });
  }
  return chapters;
}

// ---------------------------------------------------------------------------
// Drafts — pages before they know their number, and therefore their gutter
// ---------------------------------------------------------------------------

type Draft =
  | { kind: "title"; align: "recto" }
  | { kind: "intro" }
  | { kind: "route"; half: "left" | "right"; align?: "verso" }
  | { kind: "chapter"; chapter: Chapter; index: number; of: number; align: "recto" }
  | {
      kind: "day";
      day: BookDay;
      captions: string[];
      photo?: BookPhoto;
      /** How many of the day's wrapped lines already ran on an earlier page —
       * B517. Set only on a continuation page; a normal day page starts at 0
       * implicitly by leaving this out. */
      skipLines?: number;
      /** This page's own overflow continues onto a following page rather
       * than being cut — B517. Set on the *first* page of a run-on day so
       * `materialise` neither truncates it nor warns about it; the
       * continuation page carries no such flag, so it truncates and warns
       * exactly as any other day page would if it still runs long. */
      continuesOnNextPage?: true;
    }
  | {
      kind: "photos";
      layout: PhotoLayout;
      photos: BookPhoto[];
      /** Set when this page's arrangement was chosen by a person rather than
       * by `groupPhotos`. `expandToMinimum` leaves it alone — see there. */
      chosen?: true;
      /** The day this page belongs to — see `BookPage`'s "photos" variant. */
      date?: string;
    }
  | { kind: "followers"; align: "recto" }
  | { kind: "transport"; align: "recto" }
  | { kind: "costs"; align: "recto" }
  | { kind: "analytics"; topic: "spend" | "weather"; align?: "verso" | "recto" }
  | { kind: "colophon" }
  | { kind: "blank" };

/**
 * How much of a day's page is left for its own prose, once the heading, the
 * caption index (when there is no shared photo) and the shared photograph
 * (when there is one) have taken their share — B517.
 *
 * Pulled out of `materialise`'s "day" case so `draftsForChapter` can ask the
 * same question while a day is still a draft, before it has a page number.
 * `contentBoxMm`'s width and height do not depend on `side` — only its `x`
 * does, for the gutter — so either side answers this the same way.
 */
function dayTextBudget(
  spec: BookSpec,
  type: ReturnType<typeof typeScale>,
  hasPhoto: boolean,
  captionCount: number,
): { columnWidthMm: number; availableHeightMm: number; photoHeightMm: number } {
  const c = contentBoxMm(spec, "right");
  const toMm = (points: number) => points / mm(1);
  // Slightly over half the trim reads as a photograph with a caption above
  // it — see PHOTO_SHARE's own note where it used to live, in `materialise`.
  const photoHeightMm = hasPhoto ? spec.size.trimHeightMm * 0.52 : 0;
  const captionRoomMm = hasPhoto ? 0 : toMm(captionCount * type.caption * 1.6 + type.body * 2);
  const availableHeightMm = c.height - toMm(type.heading * 3.4) - captionRoomMm - photoHeightMm;
  return { columnWidthMm: c.width, availableHeightMm, photoHeightMm };
}

/**
 * Wraps a day's paragraphs and says how many of the resulting lines fit in
 * the room `dayTextBudget` measured out — the one place this happens, called
 * from `draftsForChapter` to decide whether a day needs a second page and
 * from `materialise` to render both. Two callers computing this separately
 * is how a book truncates on a page the planner thought was fine.
 */
function fitDayText(
  paragraphs: string[],
  type: ReturnType<typeof typeScale>,
  columnWidthMm: number,
  availableHeightMm: number,
): { lines: string[]; maxLines: number; truncated: boolean } {
  const lines = paragraphs.flatMap((p) => [...wrap(p, type.body, mm(columnWidthMm)), ""]);
  const toMm = (points: number) => points / mm(1);
  const maxLines = Math.max(0, Math.floor(availableHeightMm / toMm(type.body * type.leading)));
  return { lines, maxLines, truncated: lines.length > maxLines };
}

/** Looks a photograph's crop up by `webSrc` and attaches it, if it has one. A
 * hand-built fixture with no `webSrc` — every planner test — simply never
 * matches, which is the same "nobody has touched it" default as a real
 * photograph with no entry. */
function withFocal(photo: BookPhoto, focalPoints: BookOptions["focalPoints"]): BookPhoto {
  const focal = photo.webSrc ? focalPoints[photo.webSrc] : undefined;
  return focal ? { ...photo, focal } : photo;
}

function draftsForChapter(
  chapter: Chapter,
  index: number,
  of: number,
  options: BookOptions,
  spec: BookSpec,
): Draft[] {
  const type = typeScale(spec);
  const drafts: Draft[] = options.includeChapters
    ? [{ kind: "chapter", chapter, index, of, align: "recto" }]
    : [];
  for (const [dayIndex, chapterDay] of chapter.days.entries()) {
    /**
     * What the owner said about this day, if anything.
     *
     * Keyed by date, which is what a day is here. A day nobody touched has no
     * entry and everything below runs exactly as it did before per-day plans
     * existed — which is the promise this feature has to keep, because most
     * days in most books will never be touched.
     */
    const chosen = options.days[chapterDay.date];

    /**
     * The photographs, in the order the owner put them.
     *
     * `chosen.photos` names them by their gallery `src`, so the day is rebuilt
     * from that list rather than filtered by it — which is what makes
     * reordering possible at all. A named photograph the day does not have is
     * dropped rather than invented: the list can outlive an entry being
     * edited, and a book must not print a picture that is no longer there.
     *
     * An empty list is a day the owner emptied on purpose, and is not the same
     * as never having said.
     */
    const chosenDay = chosen?.photos
      ? {
          ...chapterDay,
          photos: chosen.photos
            .map((src) => chapterDay.photos.find((p) => p.webSrc === src))
            .filter((p): p is BookPhoto => Boolean(p)),
        }
      : chapterDay;
    // Every photograph the day is about to place, carrying whatever crop the
    // owner tapped — B513. Done once, here, rather than at `cover()`'s call
    // sites: a photograph keeps its focal point through `hero`, through the
    // day's own shared photo, and through every grid it lands in, because it
    // is a property of the photograph for the length of this book, not of one
    // placement.
    const day = { ...chosenDay, photos: chosenDay.photos.map((p) => withFocal(p, options.focalPoints)) };

    const layout = chosen?.layout ?? "auto";
    const captions = options.includeText
      ? day.photos.map((p) => p.caption).filter((c): c is string => Boolean(c))
      : [];
    // Text off still leaves a dated page in front of each day: a photo album
    // that cannot say when it was is worse than one with a heading.
    const written = options.includeText ? day : { ...day, paragraphs: [] };

    /**
     * Which photograph, if any, gets the whole page to itself.
     *
     * Every day's first photograph used to run full bleed. Nineteen days
     * meant nineteen full-bleed pages, and a book where every photograph is
     * the loudest is a book with no loud photographs in it — the rhythm never
     * changes, so nothing stands out. A hero is now the opening day of a
     * chapter and then roughly every third day, which leaves the others to be
     * grouped and gives the eye somewhere to arrive.
     */
    // Never at the cost of the day's own page: a day with one photograph
    // spends it beside the words rather than on a hero, because the
    // alternative is a page of prose with nothing on it facing a page of
    // photograph with nothing to say.
    // `auto` is the rhythm described above. Anything else is the owner having
    // looked at this particular day and decided, which outranks a rule about
    // every third one.
    const wantsHero = layout === "hero" || (layout === "auto" && (dayIndex === 0 || dayIndex % 3 === 0));
    /**
     * Which photograph runs big, when one is going to.
     *
     * The owner's pick if they made one and it is still in the day; otherwise
     * the first, which is what the planner has always chosen. Somebody looking
     * at four pictures knows which is the one — the planner only knows which
     * is first — so this is a hint worth honouring and never a decision worth
     * demanding.
     */
    const picked = chosen?.hero
      ? day.photos.find((p) => p.webSrc === chosen.hero)
      : undefined;
    const hero = wantsHero && day.photos.length > 1 ? (picked ?? day.photos[0]) : undefined;
    const rest = layout === "text" ? [] : hero ? day.photos.filter((p) => p !== hero) : day.photos;

    /**
     * The day's words share their page with a photograph.
     *
     * A heading, a location and three lines of prose occupy the top third of
     * a 210mm page; the rest was white. Printed, that reads as a mistake
     * rather than as space. The first of the day's remaining photographs now
     * fills the lower half, so the page carries both and the book stops
     * alternating between walls of text and lone pictures.
     */
    const withText = rest[0];
    let grouped = withText ? rest.slice(1) : rest;

    if (written.paragraphs.length > 0 || day.photos.length > 0) {
      /**
       * Whether this day's words need a second page — B517.
       *
       * Measured with the same helper `materialise` renders with, against
       * the same budget: a day with a shared photograph gets the shorter
       * column that photograph leaves, exactly as it would if it were never
       * split. `runOn` is the owner's opt-in; a day nobody has touched
       * truncates here exactly as it always has.
       */
      const budget = dayTextBudget(spec, type, Boolean(withText), captions.length);
      const fit = fitDayText(written.paragraphs, type, budget.columnWidthMm, budget.availableHeightMm);
      const runOn = chosen?.runOn === true && fit.truncated;
      if (runOn) {
        // The day's next photograph, if it has a spare one, moves to the
        // continuation page with the words rather than being manufactured or
        // left as a half-empty page — B517's ruling. `grouped`'s first
        // photograph is the next one the day would otherwise have printed,
        // in a "photos" page below or on a later day's chapter.
        const spare = grouped[0];
        drafts.push({
          kind: "day",
          day: written,
          captions,
          photo: withText,
          continuesOnNextPage: true,
        });
        drafts.push({ kind: "day", day: written, captions: [], photo: spare, skipLines: fit.maxLines });
        if (spare) grouped = grouped.slice(1);
      } else {
        drafts.push({ kind: "day", day: written, captions, photo: withText });
      }
    }
    if (hero) {
      drafts.push({ kind: "photos", layout: "full-bleed", photos: [hero], date: chapterDay.date });
    }
    for (const group of groupsFor(layout, grouped)) {
      drafts.push({
        kind: "photos",
        layout: group.layout,
        photos: group.photos,
        date: chapterDay.date,
        ...(layout === "auto" ? {} : { chosen: true as const }),
      });
    }
  }
  return drafts;
}

function draftsForFront(source: BookSource, options: BookOptions): Draft[] {
  const drafts: Draft[] = [{ kind: "title", align: "recto" }];
  if (source.trip.intro.trim() && options.includeText) drafts.push({ kind: "intro" });
  if (options.includeMap && source.route.length >= 2) {
    drafts.push({ kind: "route", half: "left", align: "verso" });
    drafts.push({ kind: "route", half: "right" });
  }
  return drafts;
}

function draftsForBack(source: BookSource, options: BookOptions): Draft[] {
  const drafts: Draft[] = [];
  // Present only when the trip said how it moved. A page reading "0 days
  // driving" on a journal that never filled the field in is worse than no
  // page, and most journals never fill it in.
  if (source.followers && source.followers.length > 0) {
    drafts.push({ kind: "followers", align: "recto" });
  }
  if (source.days.some((d) => d.transport)) drafts.push({ kind: "transport", align: "recto" });
  if (source.costs && options.includeCosts) drafts.push({ kind: "costs", align: "recto" });
  // The chart spread, and only the halves the trip has something to show for.
  // A trip with no costs and no readings gets no pages at all rather than a
  // page apologising for being empty — off is a legitimate answer here and so
  // is having nothing to say.
  if (options.includeCharts) {
    const spend = source.costs && source.costs.byDay.length > 0;
    const weather = source.weather && source.weather.measured > 0;
    // A pair faces each other across the fold when there are two of them; a
    // single chart page is a recto like every other back-matter page.
    if (spend && weather) {
      drafts.push({ kind: "analytics", topic: "spend", align: "verso" });
      drafts.push({ kind: "analytics", topic: "weather" });
    } else if (spend) {
      drafts.push({ kind: "analytics", topic: "spend", align: "recto" });
    } else if (weather) {
      drafts.push({ kind: "analytics", topic: "weather", align: "recto" });
    }
  }
  drafts.push({ kind: "colophon" });
  return drafts;
}

/** Inserts the blank pages that alignment demands, and nothing more. */
function emit(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const draft of drafts) {
    const align = "align" in draft ? draft.align : undefined;
    if (align) {
      const wanted: PageSide = align === "recto" ? "right" : "left";
      if (sideOf(out.length + 1) !== wanted) out.push({ kind: "blank" });
    }
    out.push(draft);
  }
  return out;
}

/**
 * Grows a short book instead of padding it with emptiness.
 *
 * A three-day trip has perhaps a dozen pages of content and a binder that will
 * not take fewer than thirty-two. The wrong answer is twenty blank leaves. The
 * right one is to let the photographs breathe: multi-photo pages are broken up
 * into single-photo pages, largest groups first, until the count is met.
 */
function expandToMinimum(drafts: Draft[], target: number): Draft[] {
  const out = [...drafts];
  let guard = 0;
  while (out.length < target && guard++ < 500) {
    let bestIndex = -1;
    let bestSize = 1;
    out.forEach((d, i) => {
      // Never break apart a page somebody arranged. A short trip needs
      // thirty-two pages and this is how it gets them — by splitting
      // multi-photo pages until there are enough — which would quietly undo a
      // grid the owner chose and leave them pressing the same button again.
      // Padding with blanks is the worse outcome only when nobody has said
      // what they wanted.
      if (d.kind === "photos" && d.chosen) return;
      if (d.kind === "photos" && d.photos.length > bestSize) {
        bestSize = d.photos.length;
        bestIndex = i;
      }
    });
    if (bestIndex === -1) break;
    const group = out[bestIndex] as Extract<Draft, { kind: "photos" }>;
    const halves = [
      group.photos.slice(0, Math.ceil(group.photos.length / 2)),
      group.photos.slice(Math.ceil(group.photos.length / 2)),
    ];
    out.splice(
      bestIndex,
      1,
      ...halves.map((photos) => ({
        kind: "photos" as const,
        layout: layoutFor(photos),
        photos,
        date: group.date,
      })),
    );
  }
  return out;
}

function layoutFor(photos: BookPhoto[]): PhotoLayout {
  if (photos.length === 1) return isPanorama(photos[0]) ? "panorama" : "feature";
  return groupPhotos(photos)[0].layout;
}

/**
 * Whether this photograph is big enough for the size it is printed at.
 *
 * Shared, because a photograph is soft on paper wherever it was placed and a
 * check that only ran on `photos` pages would go quiet the moment a picture
 * moved onto a day's own page — which is exactly what happened when it did.
 * This is the class of fault the whole warning list exists for: invisible on
 * screen, obvious once it is printed.
 */
function checkResolution(p: PhotoPlacement, spec: BookSpec, warnings: BookWarning[]): void {
  const need = requiredPixels(p.draw.width, spec.dpi);
  if (p.photo.width >= need) return;
  warnings.push({
    code: "low-resolution",
    detail:
      `${labelOf(p.photo)} is ${p.photo.width}px wide but is printed ` +
      `${p.draw.width.toFixed(0)}mm wide, which needs ${need}px — it will print ` +
      `at about ${p.dpi} DPI.` +
      // Resolution alone reads as "the photograph is small", which sends
      // somebody looking for a bigger one they may already have.
      (p.photo.fallbackReason ? ` This is the web copy: ${p.photo.fallbackReason}.` : ""),
  });
}

// ---------------------------------------------------------------------------
// Materialising a draft into a measured page
// ---------------------------------------------------------------------------

function materialise(
  draft: Draft,
  number: number,
  spec: BookSpec,
  source: BookSource,
  volume: { index: number; of: number },
  warnings: BookWarning[],
  s: BookStrings,
): BookPage {
  const side = sideOf(number);
  const type = typeScale(spec);
  const c = contentBoxMm(spec, side);

  switch (draft.kind) {
    case "title":
      return {
        number,
        side,
        kind: "title",
        title: source.trip.title,
        tagline: source.trip.tagline,
        dates: formatDateRange(source.trip.start, source.trip.end, s),
        travellers: source.travellers.join(" & "),
        figures: source.figures,
        volume:
          volume.of > 1
            ? fill(s.volume, { index: String(volume.index), of: String(volume.of) })
            : undefined,
      };

    case "intro": {
      const width = mm(c.width);
      const lines = source.trip.intro
        .split(/\n{2,}/)
        .flatMap((p) => [...wrap(p.replace(/\s*\n\s*/g, " ").trim(), type.body, width), ""]);
      return { number, side, from: "includeText", kind: "intro", heading: s.intro, lines };
    }

    case "route": {
      // Filtered once, here, rather than only inside `routeView`: `points`
      // below is projected and drawn straight into the PDF path/dots by
      // `drawRoutePage` without going through `routeView` at all, so a stop
      // without coordinates would still reach the page as `NaN` even with the
      // bounding box fixed.
      const plottable = source.route.filter(isPlottable);
      const view = routeView(plottable);
      const points = plottable.map((p) => ({
        location: p.location,
        country: p.country,
        ...projectEquirectangular(p.lat, p.lng),
      }));
      return {
        number,
        side,
        from: "includeMap",
        kind: "route",
        half: draft.half,
        view,
        points,
        caption: `${plottable.length} stops, ${formatDateRange(source.trip.start, source.trip.end, s)}`,
      };
    }

    case "chapter": {
      const days = draft.chapter.days;
      const photos = days.reduce((n, d) => n + d.photos.length, 0);
      return {
        number,
        side,
        from: "includeChapters",
        kind: "chapter",
        label: fill(s.chapter, { index: String(draft.index), of: String(draft.of) }),
        country: draft.chapter.country,
        countryCode: draft.chapter.countryCode,
        dates: formatDateRange(days[0].date, days[days.length - 1].date, s),
        stats: `${days.length} ${days.length === 1 ? "day" : "days"} · ${photos} ${photos === 1 ? "photograph" : "photographs"}`,
        index: draft.index,
        of: draft.of,
      };
    }

    case "day": {
      const day = draft.day;
      /**
       * A photograph across the foot of the page, and the words above it.
       *
       * It bleeds off three edges rather than sitting in the content box: the
       * page then reads as one composition instead of a picture parked under
       * some type. The words keep the column they always had, only shorter.
       *
       * `dayTextBudget`'s 0.52 is the fraction of the trim the photograph
       * takes. Much less and it is a decoration; much more and a day with
       * anything to say gets truncated, which the warning below would then
       * report on every page. Slightly over half reads as a photograph with a
       * caption above it, which is what this page is.
       */
      const budget = dayTextBudget(spec, type, Boolean(draft.photo), draft.captions.length);
      const photo = draft.photo
        ? placement(
            draft.photo,
            {
              x: -spec.bleedMm,
              y: -spec.bleedMm,
              width: spec.size.trimWidthMm + spec.bleedMm * 2,
              height: budget.photoHeightMm + spec.bleedMm,
            },
            "cover",
          )
        : undefined;
      if (photo) checkResolution(photo, spec, warnings);
      const fit = fitDayText(day.paragraphs, type, budget.columnWidthMm, budget.availableHeightMm);
      const skip = draft.skipLines ?? 0;
      const lines = fit.lines.slice(skip, skip + fit.maxLines);
      // A page whose overflow already has a continuation page waiting for it
      // — B517 — is not truncated: it is exactly as long as it was always
      // going to be. Only the *last* page of a day can honestly say the rest
      // is gone.
      const truncated = fit.lines.length > skip + fit.maxLines && !draft.continuesOnNextPage;
      if (truncated) {
        warnings.push({
          code: "text-truncated",
          detail: `${day.date} "${day.title}": ${fit.lines.length - skip} lines written, ${fit.maxLines} fit on the page.`,
          date: day.date,
        });
      }
      /**
       * A continuation page (`skip > 0`) says so in its own heading rather
       * than printing the day's date and title again — B517. Two facing (or
       * near-facing) pages carrying the same date would read as two days
       * that happen to share one, not as one day that ran long, so the date
       * eyebrow is dropped here rather than repeated. `continuedTitle` is a
       * short suffix rather than a sentence: `dayTextBudget` reserves a fixed
       * height for the heading block, sized for a one-line title, and a
       * suffix long enough to wrap the title onto a second line would eat
       * into the room already promised to the prose above — exactly what
       * ruling 1 exists to prevent two measurements disagreeing about.
       */
      const title = skip > 0 ? fill(s.continuedTitle, { title: day.title }) : day.title;
      return {
        number,
        side,
        kind: "day",
        date: day.date,
        dateLabel: skip > 0 ? "" : formatDate(day.date, s),
        title,
        location: [day.location, day.country].filter(Boolean).join(", "),
        lines,
        truncated,
        // A captioned photograph on the page makes the foot-of-page caption
        // index redundant, and there is no room for it either.
        continued: s.continued,
        captions: photo ? [] : draft.captions,
        photo,
        leg: day.transport
          ? {
              mode: day.transport.mode,
              // "Drove · Zion → Bryce" when both ends were recorded, and just
              // the verb when they were not: an arrow with nothing on one side
              // of it is worse than no arrow.
              text: [
                modeVerb(day.transport.mode, s),
                [day.transport.from, day.transport.to].every(Boolean)
                  ? `${day.transport.from} \u2192 ${day.transport.to}`
                  : "",
              ]
                .filter(Boolean)
                .join("  \u00b7  "),
            }
          : undefined,
      };
    }

    case "photos": {
      const placements = placeAll(draft.layout, draft.photos, spec, side);
      for (const p of placements) checkResolution(p, spec, warnings);
      return { number, side, kind: "photos", layout: draft.layout, placements, date: draft.date };
    }

    case "followers": {
      const names = source.followers ?? [];
      return {
        number,
        side,
        kind: "followers",
        heading: s.followers,
        note:
          names.length === 1
            ? s.followersOne
            : fill(s.followersMany, { count: String(names.length) }),
        names,
      };
    }

    case "transport": {
      const counts = new Map<string, number>();
      for (const day of source.days) {
        if (day.transport) counts.set(day.transport.mode, (counts.get(day.transport.mode) ?? 0) + 1);
      }
      const modes = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([mode, days]) => ({ mode, label: modeCount(mode, days, s), days }));
      const named = source.days.filter((d) => d.transport?.from && d.transport?.to);
      const note =
        named.length > 0
          ? fill(s.transportNote, {
              count: String(named.length),
              from: named[0].transport!.from,
              to: named[named.length - 1].transport!.to,
            })
          : undefined;
      return {
        number,
        side,
        kind: "transport",
        heading: s.transport,
        modes,
        note,
        shapes: transportShapes(c, s.transport, modes, note, type),
      };
    }

    case "costs": {
      const costs = source.costs ?? EMPTY_COSTS;
      const labels = {
        total: s.costsTotal,
        before: s.costsBefore,
        onRoad: s.costsOnRoad,
        perDay: s.costsPerDay,
        budgeted: s.costsBudgeted,
        spent: s.costsSpent,
        where: s.costsWhere,
        budgetVsActual: s.costsBudgetVsActual,
        byCountry: s.costsByCountry,
        nights: s.nights,
      };
      return {
        number,
        side,
        from: "includeCosts",
        kind: "costs",
        costs,
        labels,
        heading: s.costs,
        shapes: costsShapes(c, s.costs, costs, labels, moneyIn(costs.baseCurrency), type),
      };
    }

    case "analytics": {
      const heading = draft.topic === "spend" ? s.chartsSpend : s.chartsWeather;
      // The trip's own first and last day, written as the book writes a date.
      // Formatting belongs here rather than in `charts.ts`, which draws.
      const spanOf = (dates: string[]) => ({
        firstLabel: formatDate(dates[0] ?? source.trip.start, s),
        lastLabel: formatDate(dates[dates.length - 1] ?? source.trip.end, s),
      });
      const shapes =
        draft.topic === "spend"
          ? spendPageShapes(
              c,
              {
                heading,
                ...spanOf((source.costs?.byDay ?? []).map((d) => d.date)),
                byDay: source.costs?.byDay ?? [],
                budgetCurve: source.costs?.budgetCurve,
                budgetLabel: s.chartsBudgetLine,
                cumulativeLabel: s.chartsCumulative,
                dailyLabel: s.chartsDaily,
                averageLabel: s.chartsAverage,
              },
              moneyIn(source.costs?.baseCurrency ?? ""),
              type,
            )
          : weatherPageShapes(
              c,
              {
                heading,
                ...spanOf((source.weather?.byDay ?? []).map((d) => d.date)),
                byDay: source.weather?.byDay ?? [],
                avgHigh: source.weather?.avgHigh,
                avgLow: source.weather?.avgLow,
                highLowLabel: s.chartsHighLow,
                rainLabel: s.chartsRain,
                avgHighLabel: s.chartsAvgHigh,
                avgLowLabel: s.chartsAvgLow,
                missingNote:
                  source.weather && source.weather.missing > 0
                    ? fill(s.chartsMissing, { count: String(source.weather.missing) })
                    : undefined,
                credit:
                  source.weather && source.weather.sources.length > 0
                    ? fill(s.chartsSource, { source: source.weather.sources.join(", ") })
                    : undefined,
              },
              type,
            );
      return { number, side, from: "includeCharts", kind: "analytics", topic: draft.topic, heading, shapes };
    }

    case "colophon":
      return {
        number,
        side,
        kind: "colophon",
        figures: source.figures,
        heading: s.colophon,
        lines: [
          source.trip.title,
          formatDateRange(source.trip.start, source.trip.end, s),
          "",
          source.travellers.length > 0
        ? fill(s.colophonBy, { names: source.travellers.join(" & ") })
        : s.colophonByNobody,
          source.siteUrl ? fill(s.colophonPublished, { url: source.siteUrl }) : "",
          "",
          fill(s.colophonMade, { date: formatDate(source.madeOn, s) }),
          // The trim size, which is what a colophon conventionally names. The
          // bleed and the DPI target used to be here too — a print
          // technician's readout, in English whatever the book's language,
          // on a page somebody's family reads. B547.
          `${spec.size.name}.`,
        ].filter((l, i, all) => !(l === "" && all[i - 1] === "")),
      };

    case "blank":
      return { number, side, kind: "blank" };
  }
}

// ---------------------------------------------------------------------------
// The route map, in the same equirectangular space as lib/worldLand.json
// ---------------------------------------------------------------------------

export function projectEquirectangular(lat: number, lng: number): { x: number; y: number } {
  return {
    x: ((lng + 180) / 360) * MAP_SPACE.width,
    y: ((90 - lat) / 180) * MAP_SPACE.height,
  };
}

/**
 * The window on the world that this trip needs, as a 2:1 rectangle so that the
 * spread it is drawn across is not distorted.
 *
 * `isPlottable` is imported rather than reimplemented (B269): a stop whose
 * `lat`/`lng` is not a finite number — a day written without coordinates,
 * same as everywhere else in the app — took the whole bounding box to `NaN`
 * here for the same reason it did in `lib/mapFrame.ts`'s `frameRoute` before
 * B265: `Math.min`/`Math.max` over a `NaN` is `NaN`.
 *
 * This is a second, independent implementation of that bounding-box maths
 * rather than a caller of `frameRoute`, and deliberately so — not an oversight
 * left for later:
 *
 *  - `frameRoute`'s frame corrects x by `cos(latitude)` so a unit means the
 *    same ground distance on both axes (see that file). This map's window is
 *    culled and projected in the *same, uncorrected* equirectangular space as
 *    the baked land paths in `lib/worldLand.json` (`MAP_SPACE`, matching
 *    `mapProjector`'s `view.x/y/width/height`) — applying `lngScale` here
 *    would shift every coastline and marker out of registration with the
 *    window `mapProjector`/`drawRoutePage` cull against.
 *  - The shape is fixed at exactly 2:1, because a book spread is two trim
 *    widths across one trim height; `frameRoute`'s `TARGET_ASPECT` (1.6) is
 *    chosen for a browser layout, an unrelated constraint.
 *  - The padding floor here (30/15 "map units") is sized against the *print*
 *    frame directly; `frameRoute`'s floor is a real distance
 *    (`MIN_SPAN_KM` via `KM_PER_UNIT`), which is only a meaningful unit once
 *    `lngScale` has been applied — the same correction the first point says
 *    cannot be introduced here.
 *
 * Consolidating would mean either rewriting `mapProjector` and the renderer's
 * window-culling to work in a latitude-corrected space, or having `frameRoute`
 * grow an uncorrected mode — both bigger than the NaN hole this task closes.
 */
/**
 * The fraction of a spread's width the fold makes hard to read (B518).
 *
 * `mapProjector` puts `view`'s horizontal midpoint on the spine, so this
 * fraction of `view.width`, centred there, is the band a stop should not
 * fall in. `routeView` has no `BookSpec` to ask for the real gutter, so this
 * is sized against the default one instead (`lib/photobook/spec.ts`): a
 * 16mm gutter on each of two 210mm pages is 32mm of a 420mm spread, about
 * 8% — close enough for the other sizes on offer, and a constant here keeps
 * `routeView` pure.
 */
const FOLD_BAND_FRACTION = 0.08;

/**
 * The horizontal centre `routeView` should use instead of the frame's own
 * midpoint, so the fold's band (`FOLD_BAND_FRACTION` of `width`, which does
 * not change) costs the route less.
 *
 * Shifts rather than widens (B518): looks for the gap between two stops, or
 * between a stop and empty space beyond the rest, that is nearest the
 * middle and wide enough to hold the band whole, and puts the band there.
 * Never moves far enough to let a stop reach the frame's own edge — that
 * would break `routeView`'s contract that every stop stays inside `view`.
 *
 * A shift is only worth taking if it is actually better, so every candidate
 * is scored — first by how many stops still fall in the band, then by how
 * many times the route (in travel order, which is what `xs` is passed in)
 * crosses it — and the frame's own untouched midpoint is scored the same
 * way and kept unless some candidate beats it outright. On `parks-2025`
 * (B518) every gap on offer left a stop in the band and doubled the
 * crossings over doing nothing, which is what made the first version of
 * this function a regression rather than a fix: it shifted whenever a gap
 * existed, without checking the shift was an improvement. Ties keep the
 * untouched midpoint — a frame centred on the journey is worth giving up
 * only for a real gain.
 *
 * A perfectly clear band is not reachable for every route this way: with
 * the band at 8% of the frame, a sufficiently spread-out or evenly-covered
 * route has no gap wide enough anywhere near the middle, and the honest
 * result is "no worse than the fold got no consideration at all", not "the
 * gutter is always empty".
 */
function centreAwayFromFold(xs: number[], x: number, width: number): number {
  const cx0 = x + width / 2;
  const band = width * FOLD_BAND_FRACTION;
  const half = band / 2;
  const sorted = [...xs].sort((a, b) => a - b);
  const minX = sorted[0];
  const maxX = sorted[sorted.length - 1];

  // How far the centre can move before a stop would reach the frame's edge.
  const eps = Math.max(width * 1e-9, 1e-9);
  const lo = maxX - width / 2 + eps;
  const hi = minX + width / 2 - eps;

  const inBand = (c: number) => sorted.filter((v) => Math.abs(v - c) < half).length;
  const crossings = (c: number) => {
    let count = 0;
    let side: boolean | undefined;
    for (const v of xs) {
      const thisSide = v < c;
      if (side !== undefined && thisSide !== side) count++;
      side = thisSide;
    }
    return count;
  };
  const score = (c: number): [number, number] => [inBand(c), crossings(c)];
  const better = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

  let best = cx0;
  let bestScore = score(cx0);
  if (lo <= hi) {
    // A hair past the band's edge, so a candidate that just clears a stop
    // does so with room rather than landing it exactly on the line.
    const candidates = [minX - half - eps, maxX + half + eps];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] >= band) candidates.push((sorted[i] + sorted[i - 1]) / 2);
    }
    for (const raw of candidates) {
      const c = Math.max(lo, Math.min(hi, raw));
      const s = score(c);
      if (better(s, bestScore)) {
        best = c;
        bestScore = s;
      }
    }
  }
  return best;
}

export function routeView(route: RoutePoint[]): RouteView {
  const plottable = route.filter(isPlottable);
  if (plottable.length === 0) {
    return { x: 0, y: 0, width: MAP_SPACE.width, height: MAP_SPACE.height };
  }
  const points = plottable.map((p) => projectEquirectangular(p.lat, p.lng));
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  /**
   * Enough margin to sit in a place, and no more.
   *
   * This used to be 35% of the span or 30 units, whichever was larger. The
   * floor is what did the damage: `MAP_SPACE` is 1000 units for 360°, so 30
   * units is about eleven degrees of longitude *on each side*. A fortnight's
   * driving across Utah spans about twelve degrees, so the route was given a
   * frame three times its own width and printed as a squiggle in one corner
   * of a two-page spread — with the whole American west around it for
   * company.
   *
   * 15% and a floor of 6 units (a bit over two degrees) keeps a coastline in
   * view without letting the frame run away from the journey.
   */
  const padX = Math.max((maxX - minX) * 0.15, 6);
  const padY = Math.max((maxY - minY) * 0.15, 4);
  let x = minX - padX;
  let y = minY - padY;
  let width = maxX - minX + padX * 2;
  let height = maxY - minY + padY * 2;

  // Force 2:1 — a spread is twice as wide as it is tall, near enough.
  if (width / height > 2) {
    const wanted = width / 2;
    y -= (wanted - height) / 2;
    height = wanted;
  } else {
    const wanted = height * 2;
    x -= (wanted - width) / 2;
    width = wanted;
  }

  // Slide the frame so the fold — the spine `mapProjector` puts at this
  // frame's horizontal midpoint — lands off the route rather than on it.
  x = centreAwayFromFold(points.map((p) => p.x), x, width) - width / 2;

  return { x, y, width, height };
}

/**
 * Maps the equirectangular map space onto one half of a two-page spread.
 *
 * Shared by the PDF renderer and the web preview so that both draw the same
 * map — the preview exists to catch mistakes, which it cannot do if it is
 * projecting the world differently.
 *
 * The window is fitted with a cover rather than a contain, so no white band
 * appears when the trip's shape and the page's shape disagree. Both halves use
 * one transform, so the coastline runs across the gutter without a step.
 *
 * Returns trim-relative millimetres, y upwards, like every other rectangle in
 * this file.
 */
export function mapProjector(view: RouteView, spec: BookSpec, half: "left" | "right") {
  const spreadWidth = spec.size.trimWidthMm * 2;
  const spreadHeight = spec.size.trimHeightMm;
  const scale = Math.max(spreadWidth / view.width, spreadHeight / view.height);
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  const offsetX = half === "left" ? 0 : spec.size.trimWidthMm;

  /** The slice of map space this page shows, for culling coastlines. */
  const halfWidthMap = spec.size.trimWidthMm / scale;
  const window = {
    x: half === "left" ? cx - halfWidthMap : cx,
    y: cy - spreadHeight / 2 / scale,
    width: halfWidthMap,
    height: spreadHeight / scale,
  };

  return {
    scale,
    window,
    project: (mx: number, my: number): [number, number] => [
      spreadWidth / 2 + (mx - cx) * scale - offsetX,
      spreadHeight / 2 - (my - cy) * scale,
    ],
  };
}

/** The part of a page a route map is allowed to fill: bleed on the outer
 * edges, hard up against the spine on the inner one. */
export function mapClipMm(spec: BookSpec, half: "left" | "right"): RectMm {
  return {
    x: half === "left" ? -spec.bleedMm : 0,
    y: -spec.bleedMm,
    width: spec.size.trimWidthMm + spec.bleedMm,
    height: spec.size.trimHeightMm + spec.bleedMm * 2,
  };
}

/** A stop already projected onto the page, in whatever unit the caller draws
 * in — see `routeLabelPlacements`. */
export type ProjectedStop = { location: string; x: number; y: number };

/** One stop's name, placed — see `routeLabelPlacements`. */
export type RouteLabelPlacement = { location: string; x: number; y: number; anchorX: number };

/**
 * Which stops on a route spread get a name, and which side of the dot it goes
 * on. B519.
 *
 * Every dot is drawn; only some are labelled, because on a long trip the
 * names simply overlap. A stop is skipped when its dot falls outside this
 * page's own content box — both halves draw every stop, but only the page a
 * dot actually lands on names it, or a label prints half on each side of the
 * fold — and when it is closer than `minGap` to the last labelled stop,
 * unless it is the route's final stop.
 *
 * A name goes to the right of its dot, to the left if it will not fit there,
 * and is pushed back inside the margin if it fits on neither: bounded by
 * `leftEdge`/`rightEdge`, which already carry the gutter on the correct side
 * for this page.
 *
 * Unit-agnostic on purpose: pass `leftEdge`, `rightEdge`, `gap`, `minGap` and
 * `widthOf`'s return value all in the same unit the caller already draws
 * in — PDF points for the renderer, millimetres for the preview — and the
 * same decisions come out both times. `render.ts`'s `drawRoutePage` and
 * `preview.ts`'s `routeSvg` each called this rule out by hand until B552;
 * `mapProjector` and `graticuleStep` were already shared and this one was not,
 * which is exactly the shape B519 and B518 both found drifting.
 */
export function routeLabelPlacements(
  points: readonly ProjectedStop[],
  leftEdge: number,
  rightEdge: number,
  gap: number,
  minGap: number,
  widthOf: (location: string) => number,
): RouteLabelPlacement[] {
  const out: RouteLabelPlacement[] = [];
  let lastLabel: { x: number; y: number } | null = null;
  points.forEach((p, i) => {
    if (p.x < leftEdge || p.x > rightEdge) return;
    const far = !lastLabel || Math.hypot(p.x - lastLabel.x, p.y - lastLabel.y) > minGap;
    if (!far && i !== points.length - 1) return;
    const width = widthOf(p.location);
    const right = p.x + gap;
    const left = p.x - gap - width;
    const anchorX =
      right + width <= rightEdge
        ? right
        : left >= leftEdge
          ? left
          : Math.min(Math.max(right, leftEdge), rightEdge - width);
    out.push({ location: p.location, x: p.x, y: p.y, anchorX });
    lastLabel = { x: p.x, y: p.y };
  });
  return out;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

function coverFor(
  source: BookSource,
  spec: BookSpec,
  interiorPages: number,
  volume: { index: number; of: number },
  frontPhoto: BookPhoto | undefined,
  s: BookStrings,
): CoverPlan {
  const spine = spineWidthMm(interiorPages, spec);
  return {
    widthMm: spec.size.trimWidthMm * 2 + spine + spec.bleedMm * 2,
    heightMm: spec.size.trimHeightMm + spec.bleedMm * 2,
    spineWidthMm: spine,
    frontPhoto,
    title: source.trip.title,
    subtitle: volume.of > 1 ? fill(s.volume, { index: String(volume.index), of: String(volume.of) }) : source.trip.tagline,
    dates: formatDateRange(source.trip.start, source.trip.end, s),
    spineText: `${source.trip.title} · ${source.trip.start.slice(0, 4)}`,
    backLines: wrap(
      source.trip.intro.split(/\n{2,}/)[0]?.replace(/\s*\n\s*/g, " ").trim() ?? "",
      typeScale(spec).body,
      mm(spec.size.trimWidthMm - spec.safeMm * 2),
    ).slice(0, 8),
  };
}

/**
 * Splits chapter blocks across volumes.
 *
 * Greedy and deliberately simple: fill a volume until the next chapter would
 * not fit, then start another. A single chapter longer than a whole volume is
 * cut at a day boundary, never mid-day.
 */
function splitIntoVolumes(
  blocks: Draft[][],
  frontLength: number,
  backLength: number,
  max: number,
): Draft[][][] {
  // Alignment can add a blank before each chapter and before the back matter.
  const slack = 4;
  const capacity = Math.max(4, max - frontLength - backLength - slack);
  const volumes: Draft[][][] = [];
  let current: Draft[][] = [];
  let used = 0;

  const flush = () => {
    if (current.length > 0) volumes.push(current);
    current = [];
    used = 0;
  };

  for (const block of blocks) {
    for (const piece of block.length > capacity ? cutBlock(block, capacity) : [block]) {
      if (used > 0 && used + piece.length > capacity) flush();
      current.push(piece);
      used += piece.length;
    }
  }
  flush();
  return volumes.length > 0 ? volumes : [[]];
}

/** Cuts an over-long chapter at day boundaries, repeating its opener. */
function cutBlock(block: Draft[], capacity: number): Draft[][] {
  const opener = block[0];
  const rest = block.slice(1);
  const pieces: Draft[][] = [];
  let piece: Draft[] = [opener];
  for (const draft of rest) {
    if (piece.length >= capacity && draft.kind === "day") {
      pieces.push(piece);
      piece = [opener];
    }
    piece.push(draft);
  }
  pieces.push(piece);
  return pieces;
}

export function planBook(
  source: BookSource,
  spec: BookSpec,
  options: BookOptions = DEFAULT_OPTIONS,
): Photobook {
  // The book's own words — headings, labels, the names of the ways of
  // travelling — in the language the owner chose. Not the trip's prose, which
  // is printed as its author wrote it.
  const s = bookStrings(options.locale);
  const warnings: BookWarning[] = [...(source.notes ?? [])];
  const photoCount = source.days.reduce((n, d) => n + d.photos.length, 0);
  if (photoCount === 0) {
    warnings.push({
      code: "no-photos",
      detail: "This trip has no photographs, so the book is text only.",
    });
  }

  // A day the owner left out — B564 — never reaches `chaptersOf`, so its page,
  // its photographs and its place in the chapter are all gone; a chapter left
  // with no remaining days simply never appears, since `chaptersOf` only ever
  // groups the days it is given. Everything else (`source.route`, the front
  // and back matter) still reads the untouched `source.days` below: an
  // excluded day is a place the trip did not print, not a place it did not go.
  const printedDays = source.days.filter((d) => !options.days[d.date]?.excluded);
  const chapters = chaptersOf(printedDays);
  const front = draftsForFront(source, options);
  const back = draftsForBack(source, options);
  const blocks = chapters.map((ch, i) => draftsForChapter(ch, i + 1, chapters.length, options, spec));

  const grouped = splitIntoVolumes(blocks, front.length, back.length, spec.pageCount.max);
  if (grouped.length > 1) {
    warnings.push({
      code: "split-into-volumes",
      detail:
        `The trip does not fit in one ${spec.pageCount.max}-page book, so it is ` +
        `${grouped.length} volumes. Each is a complete book with its own cover.`,
    });
  }

  /**
   * The owner's choice of front cover, if it is still in the book — B512.
   *
   * Searched across every chapter rather than one volume's slice of them,
   * because the choice is the owner's for the whole trip and a multi-volume
   * split is an accident of page count, not something they were asked about.
   * Looked up once, outside the per-volume loop below, for the same reason
   * `firstPhoto` there is per-volume: each volume still falls back to its own
   * first photograph when this is absent or gone, exactly as `hero` falls
   * back to a day's own first photograph.
   */
  const chosenCover = options.cover
    ? blocks
        .flat()
        .flatMap((d) =>
          d.kind === "photos" ? d.photos : d.kind === "day" && d.photo ? [d.photo] : [],
        )
        .find((p) => p.webSrc === options.cover)
    : undefined;

  const volumes: BookVolume[] = grouped.map((chapterBlocks, i) => {
    const meta = { index: i + 1, of: grouped.length };
    let drafts = [...front, ...chapterBlocks.flat(), ...back];

    // Grow before padding: see expandToMinimum.
    const emitted = emit(drafts);
    if (emitted.length < spec.pageCount.min) {
      drafts = expandToMinimum(drafts, spec.pageCount.min);
    }

    let pages = emit(drafts);
    const target = normalisePageCount(pages.length, spec.pageCount);
    const padding = target - pages.length;
    if (padding > 0) {
      pages = [...pages, ...Array.from({ length: padding }, () => ({ kind: "blank" }) as Draft)];
      if (padding > 3) {
        warnings.push({
          code: "blank-padding",
          detail:
            `Volume ${meta.index} ends with ${padding} blank pages: there was not enough ` +
            `content to reach the ${spec.pageCount.min}-page minimum even after spreading the ` +
            `photographs out. A trip this short wants saddle stitch (4-48 pages) rather ` +
            `than perfect binding — see SADDLE_STITCH in lib/photobook/spec.ts.`,
        });
      }
    }
    if (pages.length > spec.pageCount.max) {
      warnings.push({
        code: "page-count",
        detail: `Volume ${meta.index} is ${pages.length} pages, over the ${spec.pageCount.max}-page maximum.`,
      });
    }

    const materialised = pages.map((draft, n) =>
      materialise(draft, n + 1, spec, source, meta, warnings, s),
    );

    const firstPhoto = chapterBlocks
      .flat()
      .flatMap((d) => (d.kind === "photos" ? d.photos : []))
      .at(0);

    return {
      index: meta.index,
      of: meta.of,
      title:
        meta.of > 1
          ? `${source.trip.title} \u2014 ${fill(s.volume, { index: String(meta.index), of: String(meta.of) })}`
          : source.trip.title,
      pages: materialised,
      interiorPages: materialised.length,
      spineWidthMm: spineWidthMm(materialised.length, spec),
      cover: coverFor(source, spec, materialised.length, meta, chosenCover ?? firstPhoto, s),
    };
  });

  // One line per distinct photo rather than one per placement.
  const seen = new Set<string>();
  const deduped = warnings.filter((w) => {
    if (w.code !== "low-resolution") return true;
    const key = w.detail.split(" ")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    tripId: source.trip.id,
    title: source.trip.title,
    spec,
    volumes,
    warnings: deduped,
    photoCount,
  };
}

/** Every photo a plan will actually draw, in page order. Used by the renderer
 * to load exactly the files it needs and by the preview to size its grid. */
export function photosIn(volume: BookVolume): PhotoPlacement[] {
  return volume.pages.flatMap((p) => {
    if (p.kind === "photos") return p.placements;
    // A day page carries one photograph too. Leaving it out here understates
    // every count and resolution check built on this.
    if (p.kind === "day" && p.photo) return [p.photo];
    return [];
  });
}

/** A page-by-page summary, for the CLI and for tests to assert against. */
export function outline(volume: BookVolume): string[] {
  return volume.pages.map((p) => {
    const label =
      p.kind === "photos"
        ? `photos (${p.layout}, ${p.placements.length})`
        : p.kind === "chapter"
          ? `chapter ${p.index}/${p.of} — ${p.country}`
          : p.kind === "day"
            ? `day — ${p.date} ${p.title}`
            : p.kind;
    return `${String(p.number).padStart(3)} ${p.side === "left" ? "L" : "R"}  ${label}`;
  });
}
