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
 *  - **The first photo of each day runs full bleed**, without a caption. A
 *    photograph that fills the paper is the reason to print a book at all, and
 *    type over the top of it is a compromise nobody asked for. Its caption
 *    goes on the day's opening page instead.
 *  - **The rest are framed** in grids chosen by aspect ratio, with the caption
 *    underneath where there is room for it.
 *  - **Countries are chapters.** Not weeks, not "highlights" — a border is the
 *    thing a reader already has a mental model for.
 *  - **A book that would exceed the binder's maximum becomes several volumes**
 *    rather than a brick or a silent truncation.
 */

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

// ---------------------------------------------------------------------------
// What the planner is given
// ---------------------------------------------------------------------------

export type BookPhoto = {
  /** Opaque to the planner; the renderer resolves it to bytes. */
  file: string;
  /** What to call this photograph in a warning. `file` is an absolute path,
   * which is useless in a message a person has to read. */
  label?: string;
  width: number;
  height: number;
  caption?: string;
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
};

export type RoutePoint = {
  location: string;
  country: string;
  lat: number;
  lng: number;
};

export type BookSource = {
  trip: { id: string; title: string; tagline?: string; start: string; end: string; intro: string };
  travellers: string[];
  days: BookDay[];
  route: RoutePoint[];
  costs?: BookCosts;
  /** The date printed in the colophon. Passed in rather than read from the
   * clock so that a plan is reproducible and testable. */
  madeOn: string;
  siteUrl?: string;
};

// ---------------------------------------------------------------------------
// What the planner produces
// ---------------------------------------------------------------------------

export type PhotoLayout =
  | "full-bleed"
  | "panorama"
  | "single"
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

export type BookPage = { number: number; side: PageSide } & (
  | {
      kind: "title";
      title: string;
      tagline?: string;
      dates: string;
      travellers: string;
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
    }
  | { kind: "photos"; layout: PhotoLayout; placements: PhotoPlacement[] }
  | { kind: "costs"; costs: BookCosts; heading: string }
  | { kind: "colophon"; heading: string; lines: string[] }
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
    | "no-photos"
    | "split-into-volumes"
    | "text-truncated"
    | "blank-padding"
    | "page-count";
  detail: string;
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
const EMPTY_COSTS: BookCosts = {
  baseCurrency: "",
  total: 0,
  preparation: 0,
  onTheRoad: 0,
  perDay: 0,
  byCategory: [],
  byCountry: [],
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

/** Fills the slot, cropping the overflow. Used wherever a grid has to line up. */
function cover(photo: BookPhoto, slot: RectMm): RectMm {
  const scale = Math.max(slot.width / photo.width, slot.height / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
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
  const draw = mode === "cover" ? cover(photo, inner) : contain(photo, inner);
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
  const captionHeight = layout === "full-bleed" || layout === "panorama" ? 0 : type.caption * 2.1;
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
    } else if (b && orientation(a) === orientation(b) && orientation(a) !== "portrait") {
      groups.push({ layout: "pair-stacked", photos: [a, b] });
      i += 2;
    } else {
      groups.push({ layout: "single", photos: [a] });
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
  | { kind: "day"; day: BookDay; captions: string[] }
  | { kind: "photos"; layout: PhotoLayout; photos: BookPhoto[] }
  | { kind: "costs"; align: "recto" }
  | { kind: "colophon" }
  | { kind: "blank" };

function draftsForChapter(chapter: Chapter, index: number, of: number): Draft[] {
  const drafts: Draft[] = [{ kind: "chapter", chapter, index, of, align: "recto" }];
  for (const day of chapter.days) {
    const [lead, ...rest] = day.photos;
    // The lead photo runs full bleed, so its caption has nowhere to live on
    // its own page. It joins the day's opening page instead.
    const captions = day.photos.map((p) => p.caption).filter((c): c is string => Boolean(c));
    if (day.paragraphs.length > 0 || day.photos.length > 0) {
      drafts.push({ kind: "day", day, captions });
    }
    if (lead) drafts.push({ kind: "photos", layout: "full-bleed", photos: [lead] });
    for (const group of groupPhotos(rest)) {
      drafts.push({ kind: "photos", layout: group.layout, photos: group.photos });
    }
  }
  return drafts;
}

function draftsForFront(source: BookSource): Draft[] {
  const drafts: Draft[] = [{ kind: "title", align: "recto" }];
  if (source.trip.intro.trim()) drafts.push({ kind: "intro" });
  if (source.route.length >= 2) {
    drafts.push({ kind: "route", half: "left", align: "verso" });
    drafts.push({ kind: "route", half: "right" });
  }
  return drafts;
}

function draftsForBack(source: BookSource): Draft[] {
  const drafts: Draft[] = [];
  if (source.costs) drafts.push({ kind: "costs", align: "recto" });
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
      })),
    );
  }
  return out;
}

function layoutFor(photos: BookPhoto[]): PhotoLayout {
  if (photos.length === 1) return isPanorama(photos[0]) ? "panorama" : "single";
  return groupPhotos(photos)[0].layout;
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
        dates: formatDateRange(source.trip.start, source.trip.end),
        travellers: source.travellers.join(" & "),
        volume: volume.of > 1 ? `Volume ${volume.index} of ${volume.of}` : undefined,
      };

    case "intro": {
      const width = mm(c.width);
      const lines = source.trip.intro
        .split(/\n{2,}/)
        .flatMap((p) => [...wrap(p.replace(/\s*\n\s*/g, " ").trim(), type.body, width), ""]);
      return { number, side, kind: "intro", heading: "The idea", lines };
    }

    case "route": {
      const view = routeView(source.route);
      const points = source.route.map((p) => ({
        location: p.location,
        country: p.country,
        ...projectEquirectangular(p.lat, p.lng),
      }));
      return {
        number,
        side,
        kind: "route",
        half: draft.half,
        view,
        points,
        caption: `${source.route.length} stops, ${formatDateRange(source.trip.start, source.trip.end)}`,
      };
    }

    case "chapter": {
      const days = draft.chapter.days;
      const photos = days.reduce((n, d) => n + d.photos.length, 0);
      return {
        number,
        side,
        kind: "chapter",
        country: draft.chapter.country,
        countryCode: draft.chapter.countryCode,
        dates: formatDateRange(days[0].date, days[days.length - 1].date),
        stats: `${days.length} ${days.length === 1 ? "day" : "days"} · ${photos} ${photos === 1 ? "photograph" : "photographs"}`,
        index: draft.index,
        of: draft.of,
      };
    }

    case "day": {
      const day = draft.day;
      const lines = day.paragraphs.flatMap((p) => [...wrap(p, type.body, mm(c.width)), ""]);
      // Type sizes are points and the content box is millimetres, so
      // everything below is converted before it is subtracted. Getting this
      // wrong shortens the column by a factor of nearly three, which shows up
      // as prose truncated on a page that is visibly two-thirds empty.
      const toMm = (points: number) => points / mm(1);
      // Room for the heading block above and the caption index at the foot.
      const captionRoom = toMm(draft.captions.length * type.caption * 1.6 + type.body * 2);
      const available = c.height - toMm(type.heading * 3.4) - captionRoom;
      const maxLines = Math.max(0, Math.floor(available / toMm(type.body * type.leading)));
      const truncated = lines.length > maxLines;
      if (truncated) {
        warnings.push({
          code: "text-truncated",
          detail: `${day.date} "${day.title}": ${lines.length} lines written, ${maxLines} fit on the page.`,
        });
      }
      return {
        number,
        side,
        kind: "day",
        date: day.date,
        dateLabel: formatDate(day.date),
        title: day.title,
        location: [day.location, day.country].filter(Boolean).join(", "),
        lines: lines.slice(0, maxLines),
        truncated,
        captions: draft.captions,
      };
    }

    case "photos": {
      const placements = placeAll(draft.layout, draft.photos, spec, side);
      for (const p of placements) {
        const need = requiredPixels(p.draw.width, spec.dpi);
        if (p.photo.width < need) {
          warnings.push({
            code: "low-resolution",
            detail:
              `${labelOf(p.photo)} is ${p.photo.width}px wide but is printed ` +
              `${p.draw.width.toFixed(0)}mm wide, which needs ${need}px — it will print ` +
              `at about ${p.dpi} DPI.`,
          });
        }
      }
      return { number, side, kind: "photos", layout: draft.layout, placements };
    }

    case "costs":
      return {
        number,
        side,
        kind: "costs",
        costs: source.costs ?? EMPTY_COSTS,
        heading: "What it cost",
      };

    case "colophon":
      return {
        number,
        side,
        kind: "colophon",
        heading: "Colophon",
        lines: [
          source.trip.title,
          formatDateRange(source.trip.start, source.trip.end),
          "",
          `Written and photographed by ${source.travellers.join(" and ") || "the travellers"}.`,
          source.siteUrl ? `Originally published at ${source.siteUrl}` : "",
          "",
          `Laid out by Fernscout and printed on demand. Made ${formatDate(source.madeOn)}.`,
          `${spec.size.name}, ${spec.bleedMm} mm bleed, ${spec.dpi} DPI target.`,
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
 */
export function routeView(route: RoutePoint[]): RouteView {
  if (route.length === 0) return { x: 0, y: 0, width: MAP_SPACE.width, height: MAP_SPACE.height };
  const points = route.map((p) => projectEquirectangular(p.lat, p.lng));
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  // A generous margin: the route should sit in a place, not fill the frame.
  const padX = Math.max((maxX - minX) * 0.35, 30);
  const padY = Math.max((maxY - minY) * 0.35, 15);
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

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

function coverFor(
  source: BookSource,
  spec: BookSpec,
  interiorPages: number,
  volume: { index: number; of: number },
  frontPhoto: BookPhoto | undefined,
): CoverPlan {
  const spine = spineWidthMm(interiorPages, spec);
  return {
    widthMm: spec.size.trimWidthMm * 2 + spine + spec.bleedMm * 2,
    heightMm: spec.size.trimHeightMm + spec.bleedMm * 2,
    spineWidthMm: spine,
    frontPhoto,
    title: source.trip.title,
    subtitle: volume.of > 1 ? `Volume ${volume.index} of ${volume.of}` : source.trip.tagline,
    dates: formatDateRange(source.trip.start, source.trip.end),
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

export function planBook(source: BookSource, spec: BookSpec): Photobook {
  const warnings: BookWarning[] = [];
  const photoCount = source.days.reduce((n, d) => n + d.photos.length, 0);
  if (photoCount === 0) {
    warnings.push({
      code: "no-photos",
      detail: "This trip has no photographs, so the book is text only.",
    });
  }

  const chapters = chaptersOf(source.days);
  const front = draftsForFront(source);
  const back = draftsForBack(source);
  const blocks = chapters.map((ch, i) => draftsForChapter(ch, i + 1, chapters.length));

  const grouped = splitIntoVolumes(blocks, front.length, back.length, spec.pageCount.max);
  if (grouped.length > 1) {
    warnings.push({
      code: "split-into-volumes",
      detail:
        `The trip does not fit in one ${spec.pageCount.max}-page book, so it is ` +
        `${grouped.length} volumes. Each is a complete book with its own cover.`,
    });
  }

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
      materialise(draft, n + 1, spec, source, meta, warnings),
    );

    const firstPhoto = chapterBlocks
      .flat()
      .flatMap((d) => (d.kind === "photos" ? d.photos : []))
      .at(0);

    return {
      index: meta.index,
      of: meta.of,
      title: meta.of > 1 ? `${source.trip.title} — Volume ${meta.index}` : source.trip.title,
      pages: materialised,
      interiorPages: materialised.length,
      spineWidthMm: spineWidthMm(materialised.length, spec),
      cover: coverFor(source, spec, materialised.length, meta, firstPhoto),
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
  return volume.pages.flatMap((p) => (p.kind === "photos" ? p.placements : []));
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
