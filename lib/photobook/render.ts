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
  MAP_SPACE,
  labelOf,
  mapClipMm,
  mapProjector,
  typeScale,
  type BookPage,
  type BookVolume,
  type MappedPoint,
  type PhotoPlacement,
  type RouteView,
} from "./plan.ts";
import { measure, toWinAnsi, wrap } from "./text.ts";
import { landPaths, toPdfPath } from "./worldland.ts";

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
const INK = { r: 0.106, g: 0.129, b: 0.161 };
const MUTED = { r: 0.42, g: 0.45, b: 0.49 };
const RULE = { r: 0.82, g: 0.83, b: 0.85 };
const PAPER = { r: 1, g: 1, b: 1 };
const ACCENT = { r: 0.17, g: 0.36, b: 0.52 };
const LAND = { r: 0.925, g: 0.918, b: 0.902 };
/** Faint enough to be structure rather than decoration; it must never compete
 * with the route. */
const GRATICULE = { r: 0.87, g: 0.86, b: 0.84 };

/** Degrees between graticule lines, in MAP_SPACE units, for a window this
 * wide. `MAP_SPACE.width` is 1000 units to 360°, so one degree is 2.78 units.
 * Picks the first interval that leaves fewer than about eight lines. */
function graticuleStep(windowWidth: number): number {
  const perDegree = MAP_SPACE.width / 360;
  for (const degrees of [1, 2, 5, 10, 20, 30, 45, 60]) {
    if (windowWidth / (degrees * perDegree) <= 8) return degrees * perDegree;
  }
  return 60 * perDegree;
}
const LAND_EDGE = { r: 0.84, g: 0.83, b: 0.81 };
const GUIDE = { r: 0.9, g: 0.2, b: 0.5 };

export type ImageLoader = (file: string) => Uint8Array;

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

function drawRoutePage(
  page: Page,
  frame: Frame,
  spec: BookSpec,
  view: RouteView,
  points: MappedPoint[],
  half: "left" | "right",
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
  // on a long trip the names simply overlap.
  let lastLabel: { x: number; y: number } | null = null;
  //
  // A label runs to the right of its dot unless that would take it off the
  // paper, in which case it runs to the left. Without this the names at the
  // edges of the spread were cut in half by the trim and by the gutter —
  // "Archa", "s National Park" — which the preview cannot show you because
  // its labels are HTML and simply overflow.
  const box = contentBoxMm(spec, half);
  const leftEdge = frame.x(box.x);
  const rightEdge = frame.x(box.x + box.width);
  plotted.forEach((p, i) => {
    // Both halves draw every stop, so each page can carry the whole route
    // line across its own edge. Only the page a dot actually lands on names
    // it: labelling from the facing page is what printed "onal Park" and
    // "National Park" against the fold, one fragment per stop that belonged
    // to the other leaf.
    if (p.x < leftEdge || p.x > rightEdge) return;
    const far = !lastLabel || Math.hypot(p.x - lastLabel.x, p.y - lastLabel.y) > mm(9);
    if (!far && i !== plotted.length - 1) return;
    const width = measure(p.location, type.caption, "bold");
    // Bounded by the content box, which already carries the gutter on the
    // correct side for this page. Not the clip box: that runs into the bleed
    // and across the fold, so a label can sit well inside it and still be
    // guillotined off the finished page or swallowed by the binding. A name
    // goes to the right of its dot, to the left if it will not fit there, and
    // is pushed back inside the margin if it fits on neither — a stop in the
    // corner of a spread is still a stop somebody drove to.
    const right = p.x + mm(2.2);
    const left = p.x - mm(2.2) - width;
    const x =
      right + width <= rightEdge
        ? right
        : left >= leftEdge
          ? left
          : Math.min(Math.max(right, leftEdge), rightEdge - width);
    PdfBuilder.drawText(
      page,
      toWinAnsi(p.location),
      x,
      p.y - mm(1),
      type.caption,
      INK,
      "F2",
    );
    lastLabel = { x: p.x, y: p.y };
  });

  PdfBuilder.popClip(page);

  if (half === "right") {
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
  const trimMm = { x: spec.bleedMm, y: spec.bleedMm, width: spec.size.trimWidthMm, height: spec.size.trimHeightMm };
  const page = builder.addPage(mm(media.width), mm(media.height), {
    x: mm(trimMm.x),
    y: mm(trimMm.y),
    width: mm(trimMm.width),
    height: mm(trimMm.height),
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
      let y = c.y + c.height * 0.34;
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
      drawRoutePage(page, frame, spec, plan.view, plan.points, plan.half, plan.caption);
      break;

    case "chapter": {
      const lines = wrap(plan.country, type.display, mm(c.width), "bold");
      let y = c.y + c.height * 0.5;
      text(
        page,
        frame,
        eyebrow(`Chapter ${plan.index} of ${plan.of}`),
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
        text(page, frame, "(continued on the website)", c.x, y, type.caption, MUTED, "F3");
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

    case "transport": {
      // Set from a little above the middle rather than the top corner: the
      // page carries three or four short lines, and hung from the head it
      // reads as the top of a page somebody forgot to finish.
      const block = plan.modes.length * ((type.display * 1.5) / mm(1)) + 24;
      let ty = c.y + c.height * 0.62 + block / 2;
      text(page, frame, eyebrow(plan.heading), c.x, ty, type.caption, MUTED);
      ty -= 14;
      for (const mode of plan.modes) {
        text(page, frame, String(mode.days), c.x, ty, type.display, ACCENT, "F2");
        text(
          page,
          frame,
          mode.label,
          c.x + measure(String(mode.days), type.display, "bold") / mm(1) + 3,
          ty,
          type.subheading,
          INK,
        );
        ty -= (type.display * 1.5) / mm(1);
      }
      if (plan.note) {
        rule(page, frame, c.x, ty + 6, Math.min(c.width, 30), RULE);
        for (const line of wrap(plan.note, type.caption, mm(c.width))) {
          text(page, frame, line, c.x, ty - 2, type.caption, MUTED, "F3");
          ty -= (type.caption * 1.4) / mm(1);
        }
      }
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "costs": {
      const costs = plan.costs;
      const money = (n: number) => `${costs.baseCurrency} ${Math.round(n).toLocaleString("en-GB")}`;
      let y = c.y + c.height - 6;
      text(page, frame, eyebrow(plan.heading), c.x, y, type.caption, MUTED);
      y -= 6;
      rule(page, frame, c.x, y, Math.min(c.width, 40), ACCENT);
      y -= 16;
      text(page, frame, money(costs.total), c.x, y, type.display, INK, "F2");
      y -= 8;
      text(page, frame, "total, everything included", c.x, y, type.caption, MUTED, "F3");
      y -= 14;

      const rows: [string, string][] = [
        ["Before we left", money(costs.preparation)],
        ["On the road", money(costs.onTheRoad)],
        ["Per day on the road", money(costs.perDay)],
      ];
      if (costs.budget) rows.push(["Budgeted", money(costs.budget.total)]);
      for (const [label, value] of rows) {
        text(page, frame, label, c.x, y, type.body, INK);
        textRight(page, frame, value, c.x + c.width, y, type.body, INK);
        y -= 3;
        rule(page, frame, c.x, y, c.width, RULE);
        y -= 7;
      }

      if (costs.byCategory.length > 0) {
        y -= 6;
        text(page, frame, eyebrow("Where it went"), c.x, y, type.caption, MUTED);
        y -= 8;
        const biggest = Math.max(...costs.byCategory.map((x) => x.amount));
        for (const row of costs.byCategory.slice(0, 8)) {
          const barWidth = biggest > 0 ? (row.amount / biggest) * (c.width * 0.45) : 0;
          text(page, frame, row.category, c.x, y, type.caption, INK);
          const r = rect(frame, { x: c.x + c.width * 0.4, y: y - 0.6, width: barWidth, height: 2.4 });
          PdfBuilder.drawRect(page, r.x, r.y, r.width, r.height, ACCENT);
          textRight(page, frame, money(row.amount), c.x + c.width, y, type.caption, MUTED);
          y -= 7;
        }
      }

      if (costs.byCountry.length > 0 && y > c.y + 24) {
        y -= 4;
        text(page, frame, eyebrow("By country"), c.x, y, type.caption, MUTED);
        y -= 8;
        for (const row of costs.byCountry.slice(0, 6)) {
          text(page, frame, `${row.country} — ${row.nights} days`, c.x, y, type.caption, INK);
          textRight(page, frame, money(row.amount), c.x + c.width, y, type.caption, MUTED);
          y -= 6;
        }
      }
      folio(page, frame, spec, plan.number, plan.side);
      break;
    }

    case "colophon": {
      let y = c.y + c.height * 0.42;
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
  for (const page of volume.pages) drawPage(builder, page, spec, options, images);
  return { pdf: builder.build(), pages: volume.pages.length, missing };
}

/**
 * The cover, as one wide page: back cover, spine, front cover.
 *
 * Every provider below wants the cover as its own file, because it is printed
 * on different stock on a different machine. The spine width comes from the
 * interior page count, which is why the interior has to be planned first.
 */
export function renderCover(
  volume: BookVolume,
  spec: BookSpec,
  options: RenderOptions,
): RenderedVolume {
  const { images, missing } = loadAll(volume, options);
  const cover = volume.cover;
  const builder = new PdfBuilder(options.document ?? {});
  const page = builder.addPage(mm(cover.widthMm), mm(cover.heightMm), {
    x: mm(spec.bleedMm),
    y: mm(spec.bleedMm),
    width: mm(cover.widthMm - spec.bleedMm * 2),
    height: mm(cover.heightMm - spec.bleedMm * 2),
  });
  const frame = frameFor(spec);
  const type = typeScale(spec);
  const trimW = spec.size.trimWidthMm;
  const trimH = spec.size.trimHeightMm;
  const frontX = trimW + cover.spineWidthMm;

  PdfBuilder.drawRect(page, 0, 0, mm(cover.widthMm), mm(cover.heightMm), PAPER);

  const photo = cover.frontPhoto ? images.get(cover.frontPhoto.file) : null;
  if (photo && cover.frontPhoto) {
    // Front panel, full bleed on three edges and up to the spine on the fourth.
    const slot = { x: frontX, y: -spec.bleedMm, width: trimW + spec.bleedMm, height: trimH + spec.bleedMm * 2 };
    const scale = Math.max(slot.width / photo.width, slot.height / photo.height);
    const draw = {
      x: slot.x + (slot.width - photo.width * scale) / 2,
      y: slot.y + (slot.height - photo.height * scale) / 2,
      width: photo.width * scale,
      height: photo.height * scale,
    };
    PdfBuilder.drawImageClipped(page, photo, rect(frame, slot), rect(frame, draw));
    // A solid band for the title rather than type dropped straight onto a
    // photograph: transparency is the first thing a PDF/X preflight rejects,
    // and a knocked-out band is honest ink.
    // Up to the top bleed, not to the trim: a band that stops at the trim
    // leaves a sliver of photograph above it that only appears once the cover
    // is cut, and only on some copies.
    const band = {
      x: frontX,
      y: trimH - 46,
      width: trimW + spec.bleedMm,
      height: 46 + spec.bleedMm,
    };
    const b = rect(frame, band);
    PdfBuilder.drawRect(page, b.x, b.y, b.width, b.height, PAPER);
  }

  let y = trimH - 18;
  for (const line of wrap(cover.title, type.heading, mm(trimW - spec.safeMm * 2), "bold")) {
    text(page, frame, line, frontX + spec.safeMm, y, type.heading, INK, "F2");
    y -= (type.heading * 1.2) / mm(1);
  }
  if (cover.subtitle) {
    for (const line of wrap(cover.subtitle, type.caption, mm(trimW - spec.safeMm * 2)).slice(0, 2)) {
      text(page, frame, line, frontX + spec.safeMm, y, type.caption, MUTED, "F3");
      y -= (type.caption * 1.4) / mm(1);
    }
  }
  text(page, frame, eyebrow(cover.dates), frontX + spec.safeMm, y - 2, type.caption, ACCENT);

  // Back panel.
  let by = trimH - 24;
  for (const line of cover.backLines) {
    text(page, frame, line, spec.safeMm, by, type.body, INK);
    by -= (type.body * 1.5) / mm(1);
  }
  text(page, frame, eyebrow(cover.dates), spec.safeMm, spec.safeMm + 6, type.caption, MUTED);

  // Spine, but only when there is enough of it to read. Below about 6 mm the
  // binding tolerance is wider than the type, and text creeps onto the covers.
  if (cover.spineWidthMm >= 6) {
    PdfBuilder.drawTextRotated(
      page,
      toWinAnsi(cover.spineText),
      frame.x(trimW + cover.spineWidthMm / 2 + type.caption / mm(1) / 2),
      frame.y(trimH / 2 - measure(cover.spineText, type.caption) / mm(1) / 2),
      type.caption,
      90,
      INK,
      "F2",
    );
  }

  if (options.guides) {
    for (const x of [0, trimW, trimW + cover.spineWidthMm, trimW * 2 + cover.spineWidthMm]) {
      PdfBuilder.drawLine(page, frame.x(x), frame.y(-spec.bleedMm), frame.x(x), frame.y(trimH + spec.bleedMm), 0.3, GUIDE);
    }
    PdfBuilder.drawLine(page, frame.x(-spec.bleedMm), frame.y(0), frame.x(trimW * 2 + cover.spineWidthMm + spec.bleedMm), frame.y(0), 0.3, GUIDE);
    PdfBuilder.drawLine(page, frame.x(-spec.bleedMm), frame.y(trimH), frame.x(trimW * 2 + cover.spineWidthMm + spec.bleedMm), frame.y(trimH), 0.3, GUIDE);
  }

  return { pdf: builder.build(), pages: 1, missing };
}
