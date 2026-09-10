/**
 * Draws a page plan onto paper.
 *
 * Everything decided has already been decided by the planner: this module owns
 * ink, not layout. It converts millimetres-from-the-trim-corner into PDF
 * points-from-the-bleed-corner, picks colours and font sizes, and pushes
 * operators at `PdfBuilder`. If a page comes out in the wrong place, the bug is
 * in plan.ts; if it comes out the right shape in the wrong colour, it is here.
 *
 * Photographs are embedded byte-for-byte as DCTDecode streams, exactly as the
 * postcard renderer does — no re-encoding, no quality loss, and no image
 * library.
 */

import {
  PdfBuilder,
  readJpeg,
  type FontName,
  type JpegImage,
  type Page,
  type PdfDocumentOptions,
} from "../postcard/pdf.ts";
import {
  contentBoxMm,
  mm,
  pageMediaBoxMm,
  type BookSpec,
  type PageSide,
  type RectMm,
} from "./spec.ts";
import {
  cover as coverRect,
  labelOf,
  mapClipMm,
  mapProjector,
  routeLabelPlacements,
  typeScale,
  type BookPage,
  type BookVolume,
  MAP_SPACE,
  type MappedPoint,
  type PhotoPlacement,
  type RouteView,
} from "./plan.ts";
import { measure, toWinAnsi, wrap } from "./text.ts";
import { drawTravellers } from "./travellers.ts";
import { drawVehicle } from "./vehicles.ts";
import { graticuleStep } from "./graticule.ts";
import { PALETTE, rgbOf, type ChartShape } from "./charts.ts";
import { landPaths, toPdfPath } from "./worldland.ts";
import { basemapForRoute } from "../basemap.ts";


/**
 * The palette. Two inks and one accent, in RGB.
 *
 * RGB because that is what this writer can honestly emit — see
 * docs/providers/photobook.md, and `lib/photobook/pdfx.ts` for what converting
 * to CMYK would actually take. The values are chosen to survive that
 * conversion: nothing is more saturated than a four-colour press can hold, and
 * the "black" is a soft near-black rather than 0,0,0, which reproduces better
 * as rich black than as a flat key plate.
 */
const INK = PALETTE.ink;
const MUTED = PALETTE.muted;
const RULE = PALETTE.rule;
const PAPER = PALETTE.paper;
const ACCENT = PALETTE.accent;
const LAND = { r: 0.925, g: 0.918, b: 0.902 };
/** Faint enough to be structure rather than decoration; it must never compete
 * with the route. */
const GRATICULE = { r: 0.87, g: 0.86, b: 0.84 };

const LAND_EDGE = { r: 0.84, g: 0.83, b: 0.81 };
/** The basemap, in tones that survive being printed small and in one colour
 * family — a route map in a book is a backdrop, not an atlas. */
const RELIEF = { r: 0.90, g: 0.892, b: 0.874 };
const GLACIER = { r: 0.965, g: 0.968, b: 0.975 };
const WATER = { r: 0.847, g: 0.878, b: 0.898 };
const WATER_LINE = { r: 0.76, g: 0.81, b: 0.85 };
const BORDER = { r: 0.72, g: 0.71, b: 0.69 };
const GUIDE = { r: 0.9, g: 0.2, b: 0.5 };

type ImageLoader = (file: string) => Uint8Array;

export type RenderOptions = {
  /** Resolves a `BookPhoto.file` to JPEG bytes. Injected so the renderer can be
   * tested without a filesystem and so media can move to object storage later
   * without touching this module. */
  loadImage: ImageLoader;
  /** Draws trim, bleed and safe-area guides. Proofing only — never for print. */
  guides?: boolean;
  document?: PdfDocumentOptions;
};

export type RenderedVolume = {
  pdf: Uint8Array;
  pages: number;
  /** Files that could not be read, so a missing photo is a reported gap rather
   * than a blank page nobody notices until the proof arrives. */
  missing: string[];
};

// ---------------------------------------------------------------------------
// Millimetres to points
// ---------------------------------------------------------------------------

type Frame = {
  /** trim-relative mm → PDF points */
  x: (v: number) => number;
  y: (v: number) => number;
  len: (v: number) => number;
};

function frameFor(spec: BookSpec): Frame {
  return {
    x: (v) => mm(spec.bleedMm + v),
    y: (v) => mm(spec.bleedMm + v),
    len: (v) => mm(v),
  };
}

function rect(frame: Frame, r: RectMm) {
  return { x: frame.x(r.x), y: frame.y(r.y), width: frame.len(r.width), height: frame.len(r.height) };
}

// ---------------------------------------------------------------------------
// Small typographic helpers
// ---------------------------------------------------------------------------

function text(
  page: Page,
  frame: Frame,
  value: string,
  xMm: number,
  yMm: number,
  size: number,
  color = INK,
  font: FontName = "F1",
) {
  PdfBuilder.drawText(page, toWinAnsi(value), frame.x(xMm), frame.y(yMm), size, color, font);
}

function textRight(
  page: Page,
  frame: Frame,
  value: string,
  rightMm: number,
  yMm: number,
  size: number,
  color = INK,
  font: FontName = "F1",
) {
  const w = measure(value, size, font === "F2" ? "bold" : "regular") / mm(1);
  text(page, frame, value, rightMm - w, yMm, size, color, font);
}

/** Draws wrapped lines downward from a baseline, returning the next free y. */
function block(
  page: Page,
  frame: Frame,
  lines: string[],
  xMm: number,
  topMm: number,
  size: number,
  leading: number,
  color = INK,
  font: FontName = "F1",
): number {
  let y = topMm;
  for (const line of lines) {
    if (line) text(page, frame, line, xMm, y, size, color, font);
    y -= (size * leading) / mm(1);
  }
  return y;
}

function rule(page: Page, frame: Frame, xMm: number, yMm: number, widthMm: number, color = RULE) {
  PdfBuilder.drawLine(
    page,
    frame.x(xMm),
    frame.y(yMm),
    frame.x(xMm + widthMm),
    frame.y(yMm),
    0.6,
    color,
  );
}

/** Letter-spaced small capitals, faked by uppercasing and inserting hair
 * spaces. The base-14 fonts have no small-cap variant and this reads better on
 * paper than a shouty run of full capitals. */
function eyebrow(value: string): string {
  return value.toUpperCase().split("").join(" ");
}

/**
 * Draws a page's charts — B565.
 *
 * The whole of the arithmetic happened in `lib/photobook/charts.ts`, in
 * millimetres, and `lib/photobook/preview.ts` walks the identical list to make
 * the browser's copy. So this function chooses ink and pushes operators and
 * nothing else; if a bar is the wrong length the bug is in charts.ts, and it
 * is wrong in the preview too, which is how it gets noticed before a book is
 * printed rather than after.
 */
function drawShapes(page: Page, frame: Frame, shapes: readonly ChartShape[]) {
  // Path syntax wants plain numbers; `PdfBuilder.drawPath` takes the string.
  const n = (v: number) => v.toFixed(3);
  const point = (p: { x: number; y: number }) => `${n(frame.x(p.x))} ${n(frame.y(p.y))}`;
  for (const shape of shapes) {
    if (shape.kind === "vehicle") {
      // Its own palette, so it is placed rather than toned — B737.
      drawVehicle(page, frame, shape.mode, shape.x, shape.y, shape.widthMm);
      continue;
    }
    const colour = rgbOf(shape.tone);
    switch (shape.kind) {
      case "rect": {
        const r = rect(frame, shape);
        if (r.width <= 0 || r.height <= 0) break;
        PdfBuilder.drawRect(page, r.x, r.y, r.width, r.height, colour);
        break;
      }
      case "line":
        drawDashable(page, frame, [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }], colour, shape.widthMm, shape.dashMm);
        break;
      case "polyline":
        drawDashable(page, frame, shape.points, colour, shape.widthMm, shape.dashMm);
        break;
      case "area": {
        if (shape.points.length < 2) break;
        const path =
          `${point(shape.points[0])} m ` +
          shape.points.slice(1).map((p) => `${point(p)} l`).join(" ") +
          ` ${n(frame.x(shape.points[shape.points.length - 1].x))} ${n(frame.y(shape.baselineY))} l` +
          ` ${n(frame.x(shape.points[0].x))} ${n(frame.y(shape.baselineY))} l h`;
        PdfBuilder.drawPath(page, path, { fill: colour });
        break;
      }
      case "dot":
        PdfBuilder.drawCircle(page, frame.x(shape.x), frame.y(shape.y), frame.len(shape.radiusMm), colour);
        break;
      case "text":
        text(
          page,
          frame,
          shape.text,
          shape.x,
          shape.y,
          shape.sizePt,
          colour,
          shape.weight === "bold" ? "F2" : shape.weight === "italic" ? "F3" : "F1",
        );
        break;
    }
  }
}

/**
 * A run of points, dashed by hand where a dash was asked for.
 *
 * The PDF writer draws solid segments and has no dash-pattern operator, and
 * adding one would mean a second way of setting graphics state for the sake of
 * two reference lines. Cutting the run into segments is a dozen lines and
 * produces the same marks on paper.
 */
function drawDashable(
  page: Page,
  frame: Frame,
  points: readonly { x: number; y: number }[],
  colour: { r: number; g: number; b: number },
  widthMm: number,
  dashMm?: number,
) {
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    PdfBuilder.drawLine(page, frame.x(a.x), frame.y(a.y), frame.x(b.x), frame.y(b.y), frame.len(widthMm), colour);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!dashMm) {
      stroke(a, b);
      continue;
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(Math.floor(length / (dashMm * 2)), 1);
    for (let d = 0; d < steps; d += 1) {
      const t0 = (d * 2 * dashMm) / length;
      const t1 = Math.min(((d * 2 + 1) * dashMm) / length, 1);
      stroke(
        { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
        { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

function folio(page: Page, frame: Frame, spec: BookSpec, number: number, side: PageSide) {
  const type = typeScale(spec);
  const y = spec.safeMm / 2;
  if (side === "right") {
    textRight(page, frame, String(number), spec.size.trimWidthMm - spec.safeMm, y, type.folio, MUTED);
  } else {
    text(page, frame, String(number), spec.safeMm, y, type.folio, MUTED);
  }
}

function guides(page: Page, frame: Frame, spec: BookSpec, side: PageSide) {
  const t = { x: 0, y: 0, width: spec.size.trimWidthMm, height: spec.size.trimHeightMm };
  const c = contentBoxMm(spec, side);
  for (const box of [t, c]) {
    const r = rect(frame, box);
    PdfBuilder.drawLine(page, r.x, r.y, r.x + r.width, r.y, 0.3, GUIDE);
    PdfBuilder.drawLine(page, r.x, r.y + r.height, r.x + r.width, r.y + r.height, 0.3, GUIDE);
    PdfBuilder.drawLine(page, r.x, r.y, r.x, r.y + r.height, 0.3, GUIDE);
    PdfBuilder.drawLine(page, r.x + r.width, r.y, r.x + r.width, r.y + r.height, 0.3, GUIDE);
  }
  PdfBuilder.drawText(page, `trim ${spec.size.trimWidthMm}x${spec.size.trimHeightMm}mm`, frame.x(1), frame.y(-spec.bleedMm + 0.8), 4, GUIDE);
}

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

function drawPhoto(
  page: Page,
  frame: Frame,
  spec: BookSpec,
  placement: PhotoPlacement,
  image: JpegImage,
) {
  PdfBuilder.drawImageClipped(page, image, rect(frame, placement.clip), rect(frame, placement.draw));
  if (!placement.caption || !placement.captionBox) return;

  const type = typeScale(spec);
  const box = placement.captionBox;
  const lineHeight = (type.caption * 1.35) / mm(1);
  // Two lines at most: a caption longer than that is a paragraph, and it
  // belongs on the day's page rather than under a photograph.
  wrap(placement.caption, type.caption, mm(box.width))
    .slice(0, 2)
    .forEach((line, i) => {
      const y = box.y + box.height - type.caption / mm(1) - i * lineHeight;
      text(page, frame, line, box.x, y, type.caption, MUTED, "F3");
    });
}

/** A missing photograph gets a ruled box saying which file it was, because a
 * silently blank page is the one error that survives all the way to print. */
function drawMissing(page: Page, frame: Frame, spec: BookSpec, placement: PhotoPlacement) {
  const r = rect(frame, placement.clip);
  PdfBuilder.drawRect(page, r.x, r.y, r.width, r.height, { r: 0.96, g: 0.96, b: 0.96 });
  PdfBuilder.drawLine(page, r.x, r.y, r.x + r.width, r.y + r.height, 0.4, RULE);
  PdfBuilder.drawLine(page, r.x, r.y + r.height, r.x + r.width, r.y, 0.4, RULE);
  const type = typeScale(spec);
  text(page, frame, `missing: ${labelOf(placement.photo)}`, placement.clip.x + 3, placement.clip.y + 3, type.caption, MUTED);
}

// ---------------------------------------------------------------------------
// The route map
// ---------------------------------------------------------------------------

/**
 * Which coastlines are worth drawing on this page.
 *
 * The baked outline is the whole world; a trip occupies a corner of it. Culling
 * by bounding box keeps the content stream to the few hundred paths that are
 * actually visible instead of several thousand that are not.
 */
function visibleLand(window: { x: number; y: number; width: number; height: number }) {
  const pad = 5;
  return landPaths().filter(
    (land) =>
      land.maxX >= window.x - pad &&
      land.minX <= window.x + window.width + pad &&
      land.maxY >= window.y - pad &&
      land.minY <= window.y + window.height + pad,
  );
}

/**
 * The land under a route, from the same basemap the website draws.
 *
 * `lib/worldLand.json` is 1:110m *coastline* with points 63 km apart, which
 * B46 measured as saying almost nothing: an inland trip was drawn on a blank
 * field at every zoom, because Switzerland has no coast. The website stopped
 * using it then; the book did not, and a four-day loop over three Alpine
 * passes printed two pages of bare graticule.
 *
 * `lib/basemap.ts` already assembles borders, lakes, rivers, relief and
 * glaciers per frame out of Natural Earth 10m. Two things make it drop
 * straight in: its projection is the same equirectangular 1000x500 this
 * planner uses, and shapes arrive as path strings that `toPdfPath` already
 * knows how to draw.
 *
 * A web frame multiplies x by `lngScale` — `cos` of the middle latitude, so a
 * map of Switzerland is not stretched sideways — but **only for the labels**.
 * The path geometry arrives unscaled, in the same units this planner uses.
 * Dividing it through by `lngScale` as well put the Alps at x 749 on a page
 * showing 520 to 527, and printed a spread of flat colour with the whole
 * basemap somewhere off to the right.
 */
function basemapUnder(points: MappedPoint[], project: (x: number, y: number) => [number, number]) {
  if (points.length === 0) return null;
  // The projection is invertible, so the plan does not have to carry lat/lng
  // as well as the projected pair it already has.
  const latLng = points.map((p) => ({
    lat: 90 - (p.y / MAP_SPACE.height) * 180,
    lng: (p.x / MAP_SPACE.width) * 360 - 180,
  }));
  const bundle = basemapForRoute(latLng);
  if (!bundle) return null;
  return { bundle, project };
}

function drawRoutePage(
  page: Page,
  frame: Frame,
  spec: BookSpec,
  view: RouteView,
  points: MappedPoint[],
  half: "left" | "right" | "full",
  side: PageSide,
  caption: string,
) {
  const type = typeScale(spec);
  const map = mapProjector(view, spec, half);
  const project = (mx: number, my: number): [number, number] => {
    const [x, y] = map.project(mx, my);
    return [frame.x(x), frame.y(y)];
  };

  const clip = rect(frame, mapClipMm(spec, half));
  PdfBuilder.pushClip(page, clip.x, clip.y, clip.width, clip.height);

  for (const land of visibleLand(map.window)) {
    PdfBuilder.drawPath(page, toPdfPath(land.d, project), {
      fill: LAND,
      stroke: LAND_EDGE,
      lineWidth: 0.3,
    });
  }

  // Then the detail, in the order a cartographer would lay it: ground, ice,
  // water, then the lines people drew on it. Roads, railways and towns are
  // deliberately left out — this is the backdrop to a journey, and a book
  // page is small.
  const under = basemapUnder(points, project);
  if (under) {
    const paint = (paths: readonly string[], style: Parameters<typeof PdfBuilder.drawPath>[2]) => {
      for (const d of paths) PdfBuilder.drawPath(page, toPdfPath(d, under.project), style);
    };
    paint(under.bundle.relief, { fill: RELIEF });
    paint(under.bundle.glaciers, { fill: GLACIER });
    paint(under.bundle.lakes, { fill: WATER, stroke: WATER_LINE, lineWidth: 0.2 });
    paint(under.bundle.rivers, { stroke: WATER_LINE, lineWidth: 0.35 });
    paint(under.bundle.borders, { stroke: BORDER, lineWidth: 0.4 });
  }

  /**
   * A graticule, drawn over the land.
   *
   * A spread framed tightly on a fortnight's driving can land entirely inside
   * one country, and the baked outline holds coastlines and nothing else — so
   * that page came out as a rectangle of flat grey with a line on it, which
   * reads as a rendering failure rather than as the middle of a continent.
   * Meridians and parallels give the page structure and, more usefully, a
   * sense of how far apart the stops actually are. Drawn after the land and
   * not before it: the land is a filled path, so a graticule underneath it is
   * a graticule nobody sees.
   *
   * The spacing is chosen so the spread carries roughly six lines each way at
   * any zoom: a fixed interval would be one line across Utah and four hundred
   * across the Pacific.
   */
  const step = graticuleStep(map.window.width);
  const first = (v: number) => Math.ceil(v / step) * step;
  for (let gx = first(map.window.x); gx < map.window.x + map.window.width; gx += step) {
    const [x0, y0] = project(gx, map.window.y);
    const [x1, y1] = project(gx, map.window.y + map.window.height);
    PdfBuilder.drawPath(page, `${x0.toFixed(2)} ${y0.toFixed(2)} m ${x1.toFixed(2)} ${y1.toFixed(2)} l`, {
      stroke: GRATICULE,
      lineWidth: 0.25,
    });
  }
  for (let gy = first(map.window.y); gy < map.window.y + map.window.height; gy += step) {
    const [x0, y0] = project(map.window.x, gy);
    const [x1, y1] = project(map.window.x + map.window.width, gy);
    PdfBuilder.drawPath(page, `${x0.toFixed(2)} ${y0.toFixed(2)} m ${x1.toFixed(2)} ${y1.toFixed(2)} l`, {
      stroke: GRATICULE,
      lineWidth: 0.25,
    });
  }

  if (points.length >= 2) {
    const path = points
      .map((p, i) => {
        const [x, y] = project(p.x, p.y);
        return `${x.toFixed(2)} ${y.toFixed(2)} ${i === 0 ? "m" : "l"}`;
      })
      .join(" ");
    PdfBuilder.drawPath(page, path, { stroke: ACCENT, lineWidth: 1.6 });
  }

  const plotted = points.map((p) => {
    const [x, y] = project(p.x, p.y);
    return { location: p.location, x, y };
  });

  // Every dot before any label. Drawing them interleaved lets a later dot's
  // white halo paint over the first word of an earlier label, which is the
  // kind of thing that turns "Ho Chi Minh City" into "Chi Minh City" and is
  // invisible until you look at a rendered page.
  for (const p of plotted) {
    PdfBuilder.drawCircle(page, p.x, p.y, mm(1.6), PAPER);
    PdfBuilder.drawCircle(page, p.x, p.y, mm(1.1), ACCENT);
  }

  // A label every so often. Every stop labelled turns a map into a list, and
  // on a long trip the names simply overlap. Bounded by the content box, not
  // the clip box: the clip runs into the bleed and across the fold, so a
  // label can sit well inside it and still be guillotined off the finished
  // page or swallowed by the binding. The rule itself — which stops get a
  // name and which side of the dot it goes on — is `routeLabelPlacements` in
  // plan.ts, shared with the preview since B552 so the two cannot drift the
  // way B519 found them.
  const box = contentBoxMm(spec, side);
  const leftEdge = frame.x(box.x);
  const rightEdge = frame.x(box.x + box.width);
  // Which stop belongs to *this* page — its own trim, gutter included, so a
  // stop whose dot falls in the gutter band still belongs to exactly one
  // page rather than to neither (B1000). The label itself still only ever
  // anchors inside `leftEdge`/`rightEdge` above.
  const ownerEdges = { left: frame.x(0), right: frame.x(spec.size.trimWidthMm) };
  for (const placement of routeLabelPlacements(
    plotted,
    leftEdge,
    rightEdge,
    mm(2.2),
    mm(9),
    (location) => measure(location, type.caption, "bold"),
    ownerEdges,
  )) {
    PdfBuilder.drawText(
      page,
      toWinAnsi(placement.location),
      placement.anchorX,
      placement.y - mm(1),
      type.caption,
      INK,
      "F2",
    );
  }

  PdfBuilder.popClip(page);

  // The caption prints once — on the right page of a spread, or on the one
  // page a compact route got instead (B1000).
  if (half === "right" || half === "full") {
    textRight(
      page,
      frame,
      caption,
      spec.size.trimWidthMm - spec.safeMm,
      spec.safeMm,
      type.caption,
      MUTED,
      "F3",
    );
  }
}

// ---------------------------------------------------------------------------
// One page
// ---------------------------------------------------------------------------

function drawPage(
  builder: PdfBuilder,
  plan: BookPage,
  spec: BookSpec,
  options: RenderOptions,
  images: Map<string, JpegImage | null>,
) {
  const media = pageMediaBoxMm(spec);
  // TrimBox spans the whole page, which is what Gelato's own downloadable
  // product template does — see `renderCover` for the whole reasoning.
  const page = builder.addPage(mm(media.width), mm(media.height), {
    x: 0,
    y: 0,
    width: mm(media.width),
    height: mm(media.height),
  });
  const frame = frameFor(spec);
  const type = typeScale(spec);
  const c = contentBoxMm(spec, plan.side);

  // Paper. Painted rather than left to the substrate so that a page which is
  // mostly white still declares its colour, and so a viewer with a dark theme
  // does not show a transparent page.
  PdfBuilder.drawRect(page, 0, 0, mm(media.width), mm(media.height), PAPER);

  switch (plan.kind) {
    case "title": {
      // One group, sitting on the lower third — the title page's whole job is
      // to be quiet and unmistakably the front of something.
      const lines = wrap(plan.title, type.display, mm(c.width), "bold");
      const titleBaseline = c.y + c.height * 0.34;
      /**
       * The party, standing on the title — B749, placed off the title's own
       * top since B756 rather than at a fraction of the page.
       *
       * A percentage was two numbers that had to agree by coincidence, and
       * they stopped agreeing the moment a party of five was drawn against a
       * title long enough to wrap: the figures came down through the words.
       * The top of the first line is where the title actually ends, so that
       * is what the feet stand on, plus a gap. Party-independent, wrap-
       * independent, and it cannot overlap by arithmetic.
       */
      const titleTop = titleBaseline + (type.display * 0.72) / mm(1);
      drawTravellers(page, (xMm, yMm) => [frame.x(xMm), frame.y(yMm)], {
        x: c.x,
        y: titleTop + 5,
        // Left-aligned with the title rather than centred over it: everything
        // else on this page hangs off the same margin, and a centred mark
        // above ranged-left type reads as two decisions instead of one.
        width: c.height * 0.28,
        height: c.height * 0.2,
      }, plan.figures);
      let y = titleBaseline;
      for (const line of lines) {
        text(page, frame, line, c.x, y, type.display, INK, "F2");
        y -= (type.display * 1.16) / mm(1);
      }
      y += (type.display * 1.16) / mm(1);
      y -= (type.display * 1.5) / mm(1);
      if (plan.tagline) {
        for (const line of wrap(plan.tagline, type.subheading, mm(c.width), "regular")) {
          text(page, frame, line, c.x, y, type.subheading, MUTED, "F3");
          y -= (type.subheading * 1.4) / mm(1);
        }
        y -= 4;
      }
      rule(page, frame, c.x, y, Math.min(c.width, 56), ACCENT);
      y -= 7;
      text(page, frame, eyebrow(plan.dates), c.x, y, type.caption, INK);
      y -= 6;
      text(page, frame, plan.travellers, c.x, y, type.caption, MUTED);
      if (plan.volume) text(page, frame, plan.volume, c.x, y - 6, type.caption, MUTED, "F3");
      break;
    }

    case "intro": {
      text(page, frame, eyebrow(plan.heading), c.x, c.y + c.height - 6, type.caption, MUTED);
      rule(page, frame, c.x, c.y + c.height - 12, Math.min(c.width, 40), ACCENT);
      block(page, frame, plan.lines, c.x, c.y + c.height - 24, type.body, type.leading);
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "route":
      drawRoutePage(page, frame, spec, plan.view, plan.points, plan.half, plan.side, plan.caption);
      break;

    case "chapter": {
      const lines = wrap(plan.country, type.display, mm(c.width), "bold");
      let y = c.y + c.height * 0.5;
      text(
        page,
        frame,
        eyebrow(plan.label),
        c.x,
        y + (type.display * 1.6) / mm(1),
        type.caption,
        MUTED,
      );
      for (const line of lines) {
        text(page, frame, line, c.x, y, type.display, INK, "F2");
        y -= (type.display * 1.15) / mm(1);
      }
      rule(page, frame, c.x, y + 4, Math.min(c.width, 60), ACCENT);
      text(page, frame, plan.dates, c.x, y - 6, type.subheading, INK);
      text(page, frame, plan.stats, c.x, y - 14, type.caption, MUTED);
      // The party, arriving in this country — B727. At the foot of the page
      // and small, on the same margin everything else here hangs off, so it
      // reads as a mark rather than an illustration. `drawTravellers` returns
      // immediately for an empty list, which is every book that did not ask
      // for this and every journal that has described nobody.
      drawTravellers(page, (xMm, yMm) => [frame.x(xMm), frame.y(yMm)], {
        x: c.x,
        y: c.y + c.height * 0.06,
        width: c.height * 0.2,
        height: c.height * 0.14,
      }, plan.figures);
      break;
    }

    case "day": {
      // Before the type, so the words are never printed over the picture: the
      // photograph occupies the foot of the page and the column above it was
      // shortened to match (see PHOTO_SHARE in plan.ts).
      if (plan.photo) {
        const image = images.get(plan.photo.photo.file);
        if (image) drawPhoto(page, frame, spec, plan.photo, image);
        else drawMissing(page, frame, spec, plan.photo);
      }
      let y = c.y + c.height - 4;
      text(page, frame, eyebrow(plan.dateLabel), c.x, y, type.caption, MUTED);
      y -= 8;
      for (const line of wrap(plan.title, type.heading, mm(c.width), "bold")) {
        text(page, frame, line, c.x, y, type.heading, INK, "F2");
        y -= (type.heading * 1.2) / mm(1);
      }
      text(page, frame, plan.location, c.x, y - 1, type.caption, ACCENT);
      y -= 9;
      if (plan.leg) {
        text(page, frame, plan.leg.text, c.x, y + 3, type.caption, MUTED, "F3");
        y -= 5;
      }
      rule(page, frame, c.x, y, Math.min(c.width, 30), RULE);
      y -= 8;
      y = block(page, frame, plan.lines, c.x, y, type.body, type.leading);
      if (plan.truncated) {
        text(page, frame, plan.continued, c.x, y, type.caption, MUTED, "F3");
      }
      if (plan.captions.length > 0) {
        let cy = c.y + 4 + (plan.captions.length - 1) * (type.caption * 1.5) / mm(1);
        rule(page, frame, c.x, cy + 6, Math.min(c.width, 20), RULE);
        for (const caption of plan.captions) {
          for (const line of wrap(caption, type.caption, mm(c.width)).slice(0, 1)) {
            text(page, frame, line, c.x, cy, type.caption, MUTED, "F3");
          }
          cy -= (type.caption * 1.5) / mm(1);
        }
      }
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "photos": {
      for (const placement of plan.placements) {
        const image = images.get(placement.photo.file);
        if (image) drawPhoto(page, frame, spec, placement, image);
        else drawMissing(page, frame, spec, placement);
      }
      if (plan.layout !== "full-bleed") folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "followers": {
      let fy = c.y + c.height * 0.72;
      text(page, frame, eyebrow(plan.heading), c.x, fy, type.caption, MUTED);
      fy -= 10;
      rule(page, frame, c.x, fy, Math.min(c.width, 30), ACCENT);
      fy -= 12;
      for (const line of wrap(plan.note, type.subheading, mm(c.width))) {
        text(page, frame, line, c.x, fy, type.subheading, INK);
        fy -= (type.subheading * 1.4) / mm(1);
      }
      fy -= 6;
      // Set as running text rather than a column of one name per line: forty
      // names down the left edge is a phone book, and these are people who
      // read somebody's days as they were written.
      for (const line of wrap(plan.names.join("  ·  "), type.body, mm(c.width))) {
        if (fy < c.y + 8) break;
        text(page, frame, line, c.x, fy, type.body, MUTED);
        fy -= (type.body * 1.6) / mm(1);
      }
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    // Three pages that are nothing but their charts — B565. Every mark was
    // measured in `lib/photobook/charts.ts` and the browser preview walks the
    // same list, so the composer cannot show a page the press will not print.
    case "transport":
    case "costs":
    case "analytics":
      drawShapes(page, frame, plan.shapes);
      folio(page, frame, spec, plan.number, plan.side);
      break;

    case "colophon": {
      let y = c.y + c.height * 0.42;
      // Standing on the block's own top, not at a fraction of the page —
      // B764, the same fault and the same fix as the title page's in B756.
      // The eyebrow's baseline is `y + 14`, so this is where the words
      // actually end whatever they say.
      const blockTop = y + 14 + (type.caption * 0.72) / mm(1);
      drawTravellers(page, (xMm, yMm) => [frame.x(xMm), frame.y(yMm)], {
        x: c.x,
        y: blockTop + 4,
        width: c.height * 0.17,
        height: c.height * 0.12,
      }, plan.figures);
      text(page, frame, eyebrow(plan.heading), c.x, y + 14, type.caption, MUTED);
      rule(page, frame, c.x, y + 8, Math.min(c.width, 30), ACCENT);
      for (const line of plan.lines) {
        if (line) {
          for (const wrapped of wrap(line, type.body, mm(c.width))) {
            text(page, frame, wrapped, c.x, y, type.body, line === plan.lines[0] ? INK : MUTED);
            y -= (type.body * 1.5) / mm(1);
          }
        } else {
          y -= (type.body * 0.9) / mm(1);
        }
      }
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "blank":
      break;
  }

  if (options.guides) guides(page, frame, spec, plan.side);
}

// ---------------------------------------------------------------------------
// A volume, and its cover
// ---------------------------------------------------------------------------

function loadAll(volume: BookVolume, options: RenderOptions) {
  const images = new Map<string, JpegImage | null>();
  const missing: string[] = [];
  const files = new Set<string>();
  for (const page of volume.pages) {
    if (page.kind === "photos") for (const p of page.placements) files.add(p.photo.file);
    // A day page carries one too, and forgetting it here prints a "missing"
    // box on every day of the book rather than failing anywhere visible.
    if (page.kind === "day" && page.photo) files.add(page.photo.photo.file);
  }
  if (volume.cover.frontPhoto) files.add(volume.cover.frontPhoto.file);
  for (const file of files) {
    try {
      images.set(file, readJpeg(options.loadImage(file)));
    } catch (err) {
      images.set(file, null);
      missing.push(`${file}: ${(err as Error).message}`);
    }
  }
  return { images, missing };
}

export function renderVolume(
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
): RenderedVolume {
  const { images, missing } = loadAll(volume, options);
  const builder = new PdfBuilder(options.document ?? {});
  drawInteriorPages(builder, volume, spec, options, images);
  return { pdf: builder.build(), pages: volume.pages.length, missing };
}

/**
 * The whole book as one document: the cover sheet, then every page — B1180.
 *
 * **This is the shape Gelato actually wants**, and the two-file split was ours
 * rather than theirs. Their own downloadable template is one file whose first
 * page is the wrap and whose remaining pages are the interior
 * (`docs/providers/gelato-templates/README.md`), and their uploader says so in
 * as many words when handed an interior on its own:
 *
 * ```
 * Product requires exactly 45 pages, while PDF contains 44 pages
 * Product requires that page 1 would be exactly 409.81 x 206.0 mm.
 *   Page size in provided PDF is 206.0 x 206.0 mm.
 * ```
 *
 * Both complaints are the same complaint: page 1 is missing, and page 1 is the
 * cover. 45 = 42 pages of book + 2 blank leaves + 1 cover, which is the
 * `pageCount + 3` the API had already been measured to want (B1173) — the two
 * surfaces agree, and we were the odd one out.
 *
 * `pages` stays the book's own count for the same reason it does in
 * `renderVolume`: it is what gets quoted, charged and declared. Neither the
 * cover nor the leaves are pages of the book.
 */
export function renderBook(
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
): RenderedVolume {
  const { images, missing } = loadAll(volume, options);
  const builder = new PdfBuilder(options.document ?? {});
  drawCoverPage(builder, volume, spec, options, images);
  drawInteriorPages(builder, volume, spec, options, images);
  return { pdf: builder.build(), pages: volume.pages.length, missing };
}

/**
 * The two blank leaves Gelato counts and we did not draw — B1173.
 *
 * Their prepress refuses a book whose files do not total `pageCount + 3`, and
 * says so exactly:
 *
 * ```
 * sent 46  →  counted 47 (46 + our 1 cover page), required 49
 * sent 42  →  counted 43 (42 + our 1 cover page), required 45
 * ```
 *
 * Measured twice against the live API, and confirmed from the other side: with
 * `pageCount: 40` and those same 43 pages, prepress said nothing about the
 * files at all. Their own downloadable template agrees — 31 pages for the
 * 28-page product, being one cover page and thirty interior ones
 * (`docs/providers/gelato-templates/README.md`).
 *
 * So the interior carries **two more pages than the book has**, and `pages` is
 * deliberately still `volume.pages.length`: that is the number quoted, charged
 * and declared, and the leaves are not pages of the book.
 *
 * **They go at the end**, which is a decision and not an obvious one. Putting
 * one at the front would move every page onto the other side of its leaf, and
 * a spread the planner paired would print across a turn. The end is the only
 * placement that leaves the book it laid out untouched.
 *
 * No draft order can catch a change here: prepress does not run on
 * `orderType: "draft"`, which is why this survived every order before the
 * first real one.
 */
const END_LEAVES = 2;

/**
 * Every page of the book, with the two leaves **before the last one** —
 * B1231.
 *
 * They used to go at the very end, and Gelato's preview showed what that
 * means: page 43 the colophon, then two sheets of white. A book that ends on
 * blank paper reads as though the printer ran out, and the colophon — the one
 * page that says who made this and when — is no longer the last thing anybody
 * sees.
 *
 * Moving them one page in fixes that and costs nothing, because **two is
 * even**: inserting an even number of pages anywhere leaves every page after
 * it on the same side of its leaf, so no spread the planner paired is broken.
 * One leaf would have turned the whole book over.
 *
 * The count is unchanged and still `pageCount + 2`, which is what Gelato
 * requires (B1173). Their "at least one page is empty" is a warning about
 * those two and stays — a blank leaf at the back of a book is ordinary, and
 * the alternative is failing their page count, which is not a warning.
 */
function drawInteriorPages(
  builder: PdfBuilder,
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
  images: Map<string, JpegImage | null>,
): void {
  const pages = volume.pages;
  const last = pages.length - 1;
  for (let i = 0; i < last; i++) drawPage(builder, pages[i], spec, options, images);
  addEndLeaves(builder, spec);
  // A one-page volume has nothing to put the leaves in front of; it gets them
  // after, which is the old behaviour and the only sensible one.
  if (last >= 0) drawPage(builder, pages[last], spec, options, images);
}

function addEndLeaves(builder: PdfBuilder, spec: BookSpec): void {
  const media = pageMediaBoxMm(spec);
  for (let i = 0; i < END_LEAVES; i++) {
    // Same media and the same whole-page TrimBox as every other interior page
    // — a leaf of a different size is a leaf the binder has to guess about.
    builder.addPage(mm(media.width), mm(media.height), {
      x: 0,
      y: 0,
      width: mm(media.width),
      height: mm(media.height),
    });
  }
}

/**
 * The cover, as one wide page: back cover, spine, front cover — and, for a
 * hardcover case, the wrap around the boards and a joint either side of the
 * spine that a softcover has neither of.
 *
 * Every provider below wants the cover as its own file, because it is printed
 * on different stock on a different machine. The whole shape comes from
 * `cover.geometry` (`lib/photobook/coverGeometry.ts`, B885) rather than from
 * `spec.size` and a bare spine width — a softcover's `wrapMm` and `joint` are
 * 0 and absent, which is what makes the two cases one code path rather than
 * a branch.
 */
/** Where a rotated line's ink sits relative to its baseline, as a fraction of
 * the font size — see the spine title in `renderCover`. Measured, not derived. */
const SPINE_INK_CENTRE_EM = 0.3;

export function renderCover(
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
): RenderedVolume {
  const { images, missing } = loadAll(volume, options);
  const builder = new PdfBuilder(options.document ?? {});
  drawCoverPage(builder, volume, spec, options, images);
  return { pdf: builder.build(), pages: 1, missing };
}

/**
 * The cover sheet, drawn into whichever document is being built — B1180.
 *
 * Split out of `renderCover` so `renderBook` can put it in front of the
 * interior in one file. Gelato's uploader wants exactly that: page 1 the
 * cover, then the pages. Its own template is the same shape, and its error
 * says so outright — *"Product requires that page 1 would be exactly
 * 409.81 x 206.0 mm"*.
 */
function drawCoverPage(
  builder: PdfBuilder,
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
  images: Map<string, JpegImage | null>,
): void {
  const cover = volume.cover;
  const geometry = cover.geometry;
  /**
   * TrimBox spans the whole sheet — the same as MediaBox and BleedBox.
   *
   * That is not what print convention says, and it is what Gelato's own
   * downloadable product template does. Every page of
   * `product_template_photobooks-softcover_pf_210x280…pdf` carries
   * `TrimBox == BleedBox == MediaBox`; the cover page is 428.72 x 286 mm and
   * the thirty interior pages are 216 x 286, which are exactly the sizes this
   * writer emits. The only thing that ever differed between our file and
   * their reference was this box.
   *
   * It is not cosmetic. Gelato positions artwork from the TrimBox, so a box
   * inset by the bleed made it rescale the sheet: submitting one hardcover
   * twice, once unaltered and once with the key renamed away, moved its flat
   * preview from 86.3% of the canvas to 100%. Matching the template is the
   * one reading of "what does Gelato expect" that comes from Gelato.
   *
   * The trim is not lost — `mapClipMm`, the guides and the PDF/X report all
   * compute it from `spec` and `CoverGeometry`, which is where it was always
   * really kept.
   */
  const page = builder.addPage(mm(geometry.sheetWidthMm), mm(geometry.sheetHeightMm), {
    x: 0,
    y: 0,
    width: mm(geometry.sheetWidthMm),
    height: mm(geometry.sheetHeightMm),
  });
  const type = typeScale(spec);

  // Trim-relative coordinates from here on, with the origin at the back
  // panel's own corner — inset from the sheet edge by the wrap (0 for
  // softcover) and the bleed, exactly as `frameFor` insets by the bleed alone
  // for an interior page.
  const inset = geometry.wrapMm + geometry.bleedMm;
  const frame: Frame = { x: (v) => mm(inset + v), y: (v) => mm(inset + v), len: mm };

  const panelW = geometry.back.widthMm;
  const panelH = geometry.back.heightMm;
  const jointW = geometry.joint?.widthMm ?? 0;
  const spineW = geometry.spineWidthMm;
  const spineX0 = panelW + jointW;
  const spineX1 = spineX0 + spineW;
  const frontX = spineX1 + jointW;
  const rightEdge = frontX + panelW;

  PdfBuilder.drawRect(page, 0, 0, mm(geometry.sheetWidthMm), mm(geometry.sheetHeightMm), PAPER);

  const photo = cover.frontPhoto ? images.get(cover.frontPhoto.file) : null;
  if (photo && cover.frontPhoto) {
    // Front panel, full bleed (and, for a hardcover, full wrap) on three
    // edges and up to the spine's joint on the fourth.
    const slot = { x: frontX, y: -inset, width: panelW + inset, height: panelH + inset * 2 };
    const draw = coverRect(photo, slot);
    PdfBuilder.drawImageClipped(page, photo, rect(frame, slot), rect(frame, draw));
    // A solid band for the title rather than type dropped straight onto a
    // photograph: transparency is the first thing a PDF/X preflight rejects,
    // and a knocked-out band is honest ink.
    // Up to the outer edge, not to the panel's own edge: a band that stops
    // there leaves a sliver of photograph above it that only appears once
    // the cover is cut (or, for a hardcover, wrapped), and only on some
    // copies.
    const band = {
      x: frontX,
      y: panelH - 46,
      width: panelW + inset,
      height: 46 + inset,
    };
    const b = rect(frame, band);
    PdfBuilder.drawRect(page, b.x, b.y, b.width, b.height, PAPER);
  }

  /**
   * A cover has a gutter too, and it had been using the outer margin for it.
   *
   * The front panel's left edge *is* the hinge — the spine on a softcover, the
   * joint on a case — so type set `safeMm` from it sits as close to the fold as
   * an interior page would ever put a word, and closer than that once the book
   * is bound and the first few millimetres curve away. An interior recto has
   * had `gutterMm` on that edge since the beginning; the cover simply never
   * asked for it, and the title looked all but cut off by the spine.
   *
   * The back panel is the mirror: its hinge is on the *right*, so its text
   * keeps the outer margin on the left and loses the gutter's width from the
   * measure instead.
   */
  const frontTextX = frontX + spec.gutterMm;
  const frontMeasure = mm(panelW - spec.gutterMm - spec.safeMm);

  let y = panelH - 18;
  for (const line of wrap(cover.title, type.heading, frontMeasure, "bold")) {
    text(page, frame, line, frontTextX, y, type.heading, INK, "F2");
    y -= (type.heading * 1.2) / mm(1);
  }
  if (cover.subtitle) {
    for (const line of wrap(cover.subtitle, type.caption, frontMeasure).slice(0, 2)) {
      text(page, frame, line, frontTextX, y, type.caption, MUTED, "F3");
      y -= (type.caption * 1.4) / mm(1);
    }
  }
  text(page, frame, eyebrow(cover.dates), frontTextX, y - 2, type.caption, ACCENT);

  // Back panel.
  let by = panelH - 24;
  for (const line of cover.backLines) {
    text(page, frame, line, spec.safeMm, by, type.body, INK);
    by -= (type.body * 1.5) / mm(1);
  }
  text(page, frame, eyebrow(cover.dates), spec.safeMm, spec.safeMm + 6, type.caption, MUTED);

  // Spine, but only when there is enough of it to read. Below about 6 mm the
  // binding tolerance is wider than the type, and text creeps onto the covers.
  //
  // Centring rotated type on the spine is not "add half the size to the
  // baseline", which is what this did and which put a 6 mm hardcover title
  // 2.2 mm from one hinge and 0.6 mm from the other — crooked on the finished
  // book, and the sort of thing only a measurement finds.
  //
  // Rotated text grows away from its baseline on one side only, so the ink
  // band's centre sits a fraction of the size off it. For Helvetica that is
  // about 0.3 em — theory says (cap 0.717 - descender 0.207) / 2 = 0.255, and
  // the extra comes from the digits and the middot in a spine title. It is
  // measured rather than derived: at 226-232 mm the title now lands
  // 227.9-230.1, which is 1.9 mm clear of each hinge.
  if (spineW >= 6) {
    PdfBuilder.drawTextRotated(
      page,
      toWinAnsi(cover.spineText),
      frame.x(spineX0 + spineW / 2 + (type.caption / mm(1)) * SPINE_INK_CENTRE_EM),
      frame.y(panelH / 2 - measure(cover.spineText, type.caption) / mm(1) / 2),
      type.caption,
      90,
      INK,
      "F2",
    );
  }

  if (options.guides) {
    // Every panel boundary — back/joint, joint/spine, spine/joint,
    // joint/front — de-duplicated so a softcover (no joint, `jointW` 0) draws
    // the same four lines it always did.
    const xs = [...new Set([0, panelW, spineX0, spineX1, frontX, rightEdge])];
    for (const x of xs) {
      PdfBuilder.drawLine(page, frame.x(x), frame.y(-inset), frame.x(x), frame.y(panelH + inset), 0.3, GUIDE);
    }
    PdfBuilder.drawLine(page, frame.x(-inset), frame.y(0), frame.x(rightEdge + inset), frame.y(0), 0.3, GUIDE);
    PdfBuilder.drawLine(page, frame.x(-inset), frame.y(panelH), frame.x(rightEdge + inset), frame.y(panelH), 0.3, GUIDE);
  }

}
