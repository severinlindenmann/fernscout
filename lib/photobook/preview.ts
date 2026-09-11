/**
 * A web preview built from the same page plan as the PDF.
 *
 * Not a second layout engine — that would be two things to keep in step and one
 * of them would drift. Every rectangle on this page is the same `RectMm` the
 * renderer draws, expressed as a percentage of the page instead of in points,
 * so if a photograph is in the wrong place here it is in the wrong place on
 * paper too. Which is the point: it is much cheaper to notice on screen.
 *
 * The output is one self-contained HTML file next to the PDFs, with the photos
 * referenced by relative path so it can be opened straight from the folder.
 *
 * `BookPhoto.file` is a handle rather than a path — the source writes it
 * relative to the content root so the plan stays machine-independent (B25) —
 * so the caller passes in whatever turns one back into a real file.
 */

import path from "node:path";
import { contentBoxMm, mm, type BookSpec, type PageSide, type RectMm } from "./spec.ts";
import { measure } from "./text.ts";
import {
  mapClipMm,
  mapProjector,
  routeLabelPlacements,
  typeScale,
  type BookPage,
  type BookPhoto,
  type BookVolume,
  type MappedPoint,
  type Photobook,
  type RouteView,
} from "./plan.ts";
import { landPaths } from "./worldland.ts";
import { graticuleStep } from "./graticule.ts";
import { cssTone, type ChartShape } from "./charts.ts";
import { vehicleSvg } from "./vehicles.ts";
import { travellersSvg } from "./travellers.ts";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Where the browser fetches one photograph from.
 *
 * Two page kinds draw images now — `photos` and a `day` sharing its page with
 * one — and they must resolve a file identically or the preview stops being
 * evidence about the printed page.
 */
function imageSrc(
  photo: BookPhoto,
  outDir: string,
  resolveFile: (file: string) => string,
  srcFor?: SrcFor,
): string {
  if (srcFor) return srcFor(photo);
  return path.relative(outDir, resolveFile(photo.file)).split(path.sep).join("/");
}

/** trim-relative mm → percentages of the bleed box, with y flipped for CSS. */
function style(spec: BookSpec, r: RectMm): string {
  const w = spec.size.trimWidthMm + spec.bleedMm * 2;
  const h = spec.size.trimHeightMm + spec.bleedMm * 2;
  const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  return [
    `left:${pct((r.x + spec.bleedMm) / w)}`,
    `bottom:${pct((r.y + spec.bleedMm) / h)}`,
    `width:${pct(r.width / w)}`,
    `height:${pct(r.height / h)}`,
  ].join(";");
}

/**
 * A page's charts, from the same geometry the PDF draws — B565.
 *
 * Not a second layout: `lib/photobook/charts.ts` produced this list of marks
 * in millimetres and `render.ts` walks the identical one. The single
 * conversion here is the one `routeSvg` also makes — trim-relative
 * millimetres with y upwards become the media box with y downwards — so a bar
 * in the wrong place on this page is in the wrong place on paper too. Which is
 * the point: it is much cheaper to notice on screen.
 *
 * The browser will not set Helvetica to the same pixel and does not need to:
 * every x this file is given was already resolved to a left edge by
 * `charts.ts`, using the renderer's own width function, so both agree about
 * *placement*, which is the part that has to match.
 */
function chartSvg(spec: BookSpec, shapes: readonly ChartShape[]): string {
  const width = spec.size.trimWidthMm + spec.bleedMm * 2;
  const height = spec.size.trimHeightMm + spec.bleedMm * 2;
  const X = (v: number) => (v + spec.bleedMm).toFixed(2);
  const Y = (v: number) => (spec.size.trimHeightMm + spec.bleedMm - v).toFixed(2);
  const mmPerPt = 1 / mm(1);
  const parts: string[] = [];

  for (const shape of shapes) {
    if (shape.kind === "vehicle") {
      // The vehicle carries its own palette, so it is placed rather than
      // toned — B737. `vehicleSvg` puts the group where the shape says, in
      // the same millimetres every other shape here is written in.
      parts.push(vehicleSvg(shape.mode, X(shape.x), Y(shape.y), shape.widthMm));
      continue;
    }
    const colour = cssTone(shape.tone);
    switch (shape.kind) {
      case "rect":
        if (shape.width <= 0 || shape.height <= 0) break;
        parts.push(
          `<rect x="${X(shape.x)}" y="${Y(shape.y + shape.height)}" ` +
            `width="${shape.width.toFixed(2)}" height="${shape.height.toFixed(2)}" fill="${colour}"/>`,
        );
        break;
      case "line":
        parts.push(
          `<line x1="${X(shape.x1)}" y1="${Y(shape.y1)}" x2="${X(shape.x2)}" y2="${Y(shape.y2)}" ` +
            `stroke="${colour}" stroke-width="${shape.widthMm}"` +
            (shape.dashMm ? ` stroke-dasharray="${shape.dashMm} ${shape.dashMm}"` : "") +
            `/>`,
        );
        break;
      case "polyline":
        parts.push(
          `<polyline points="${shape.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}" ` +
            `fill="none" stroke="${colour}" stroke-width="${shape.widthMm}" ` +
            `stroke-linecap="round" stroke-linejoin="round"` +
            (shape.dashMm ? ` stroke-dasharray="${shape.dashMm} ${shape.dashMm}"` : "") +
            `/>`,
        );
        break;
      case "area":
        if (shape.points.length < 2) break;
        parts.push(
          `<polygon points="${[
            `${X(shape.points[0].x)},${Y(shape.baselineY)}`,
            ...shape.points.map((p) => `${X(p.x)},${Y(p.y)}`),
            `${X(shape.points[shape.points.length - 1].x)},${Y(shape.baselineY)}`,
          ].join(" ")}" fill="${colour}"/>`,
        );
        break;
      case "dot":
        parts.push(
          `<circle cx="${X(shape.x)}" cy="${Y(shape.y)}" r="${shape.radiusMm}" fill="${colour}"/>`,
        );
        break;
      case "text":
        parts.push(
          // `xml:space` because the book's small caps are letter-spaced by
          // inserting real spaces (`eyebrowText`), and SVG collapses runs of
          // whitespace by default — which turned "WHAT IT COST" into
          // "WHATITCOST" in the preview and nowhere else.
          `<text xml:space="preserve" x="${X(shape.x)}" y="${Y(shape.y)}" fill="${colour}" ` +
            `font-size="${(shape.sizePt * mmPerPt).toFixed(2)}"` +
            (shape.weight === "bold" ? ` font-weight="700"` : "") +
            (shape.weight === "italic" ? ` font-style="italic"` : "") +
            `>${escape(shape.text)}</text>`,
        );
        break;
    }
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${parts.join("")}</svg>`;
}

/**
 * The route map, from the same projection the PDF uses.
 *
 * `mapProjector` returns trim-relative millimetres with y upwards; SVG wants
 * the media box with y downwards, which is the one conversion here. Everything
 * else — the scale, the window, which half of the world this page shows — is
 * shared, so the preview cannot drift away from the printed page.
 */
function routeSvg(
  spec: BookSpec,
  view: RouteView,
  points: MappedPoint[],
  half: "left" | "right" | "full",
  side: PageSide,
): string {
  const map = mapProjector(view, spec, half);
  const width = spec.size.trimWidthMm + spec.bleedMm * 2;
  const height = spec.size.trimHeightMm + spec.bleedMm * 2;
  const to = (mx: number, my: number): [number, number] => {
    const [x, y] = map.project(mx, my);
    return [x + spec.bleedMm, spec.size.trimHeightMm + spec.bleedMm - y];
  };

  const pad = 5;
  const land = landPaths()
    .filter(
      (l) =>
        l.maxX >= map.window.x - pad &&
        l.minX <= map.window.x + map.window.width + pad &&
        l.maxY >= map.window.y - pad &&
        l.minY <= map.window.y + map.window.height + pad,
    )
    .map((l) => svgPath(l.d, to))
    .join(" ");

  // The same graticule the renderer draws, and for the same reason: a spread
  // framed on one country is otherwise a grey rectangle. Without it here the
  // preview would show a page the printer will not produce.
  const step = graticuleStep(map.window.width);
  const firstLine = (v: number) => Math.ceil(v / step) * step;
  const lines: string[] = [];
  for (let gx = firstLine(map.window.x); gx < map.window.x + map.window.width; gx += step) {
    const [x0, y0] = to(gx, map.window.y);
    const [x1, y1] = to(gx, map.window.y + map.window.height);
    lines.push(`M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`);
  }
  for (let gy = firstLine(map.window.y); gy < map.window.y + map.window.height; gy += step) {
    const [x0, y0] = to(map.window.x, gy);
    const [x1, y1] = to(map.window.x + map.window.width, gy);
    lines.push(`M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`);
  }
  const graticule = lines.join(" ");

  const route = points
    .map((p, i) => {
      const [x, y] = to(p.x, p.y);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join("");

  const projected = points.map((p) => {
    const [x, y] = to(p.x, p.y);
    return { location: p.location, x, y };
  });

  const dots = projected
    .map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.1" class="stop"/>`)
    .join("");

  /**
   * The stops, named — by the same rule the renderer uses.
   *
   * The printed map has always labelled its stops and this one never did, so
   * reading a spread to check the map, the first question was "which stop is
   * that?" and the preview could not say. B519.
   *
   * `routeLabelPlacements` (plan.ts) is the rule itself, shared rather than
   * copied since B552 so the two cannot drift the way B519 found them.
   * `measure()` is the renderer's own width function and is pure, so both
   * agree about *which* side a name goes — which is the part that has to
   * match. The browser will not set Helvetica to the same pixel, and it does
   * not need to: this page is evidence about placement, not a proof of
   * kerning.
   */
  const type = typeScale(spec);
  const box = contentBoxMm(spec, side);
  const leftEdge = box.x + spec.bleedMm;
  const rightEdge = box.x + box.width + spec.bleedMm;
  // See render.ts's `drawRoutePage`: a stop belongs to this page by its own
  // trim, gutter included, so one in the gutter band still belongs to
  // exactly one page rather than to neither (B1000).
  const ownerEdges = { left: spec.bleedMm, right: spec.size.trimWidthMm + spec.bleedMm };
  const captionMm = type.caption / mm(1);
  const labels = routeLabelPlacements(
    projected,
    leftEdge,
    rightEdge,
    2.2,
    9,
    (location) => measure(location, type.caption, "bold") / mm(1),
    ownerEdges,
  )
    .map(
      (p) =>
        `<text x="${p.anchorX.toFixed(2)}" y="${(p.y + captionMm * 0.35).toFixed(2)}" ` +
        `class="stopname" style="font-size:${captionMm.toFixed(2)}px">${escape(p.location)}</text>`,
    )
    .join("");

  const clip = mapClipMm(spec, half);
  return (
    `<svg class="map" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `<clipPath id="c-${half}-${points.length}"><rect x="${clip.x + spec.bleedMm}" y="0" ` +
    `width="${clip.width}" height="${height}"/></clipPath>` +
    `<g clip-path="url(#c-${half}-${points.length})">` +
    `<path class="land" d="${land}"/>` +
    `<path class="graticule" d="${graticule}"/>` +
    (points.length >= 2 ? `<path class="route" d="${route}"/>` : "") +
    dots +
    labels +
    `</g></svg>`
  );
}

/** SVG path data, re-projected. The baked outline is already SVG, so this is a
 * coordinate swap rather than a conversion. */
function svgPath(d: string, to: (x: number, y: number) => [number, number]): string {
  const out: string[] = [];
  let op = "L";
  for (const token of d.match(/[MLZ]|-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) ?? []) {
    if (token === "M" || token === "L") {
      op = token;
      continue;
    }
    if (token === "Z") {
      out.push("Z");
      continue;
    }
    const [sx, sy] = token.split(",");
    const [x, y] = to(Number(sx), Number(sy));
    out.push(`${op}${x.toFixed(2)},${y.toFixed(2)}`);
    op = "L";
  }
  return out.join("");
}

function textBlock(spec: BookSpec, page: BookPage, html: string, klass = "copy"): string {
  const c = contentBoxMm(spec, page.side);
  return `<div class="${klass}" style="${style(spec, c)}">${html}</div>`;
}

/** Where the browser should fetch each photograph from. */
export type SrcFor = (photo: BookPhoto) => string;

/**
 * What the line under a page says — B562.
 *
 * A callback for the same reason `SrcFor` is one: this file is the single
 * layout, and the words belong to whoever is showing it. The composer hands
 * in the reader's own language ("Day 1 · Denver, and a truck", "The route
 * map"); the CLI hands in nothing and keeps the page kind, because that
 * reader is a technician looking at a folder of print files.
 */
export type CaptionFor = (page: BookPage) => string;

/**
 * Groups a volume's pages into spreads: page one alone (it is a recto, and
 * there is no page zero to face it), then the rest in facing pairs — 2-3,
 * 4-5, and so on, exactly as `sideOf()` already has them.
 *
 * A remainder falls out of the arithmetic rather than being special-cased: if
 * the pairs run out with one page left over, that last group is a single
 * page rather than a dropped one. Generic over the element type so a unit
 * test can hand it plain numbers instead of a real `BookPage`.
 */
export function spreadsOf<T>(pages: T[]): T[][] {
  if (pages.length === 0) return [];
  const groups: T[][] = [[pages[0]]];
  for (let i = 1; i < pages.length; i += 2) {
    groups.push(pages.slice(i, i + 2));
  }
  return groups;
}

function pageHtml(
  spec: BookSpec,
  page: BookPage,
  outDir: string,
  resolveFile: (file: string) => string,
  srcFor: SrcFor | undefined,
  captionFor: CaptionFor | undefined,
): string {
  const type = typeScale(spec);
  const scale = 100 / (spec.size.trimHeightMm + spec.bleedMm * 2);
  const pt = (size: number) => `font-size:${(size * scale * 0.352778).toFixed(3)}cqh`;
  const parts: string[] = [];

  switch (page.kind) {
    case "title":
      parts.push(
        textBlock(
          spec,
          page,
          // The party stands *in* the title's own stack rather than at a
          // percentage of the page — B756. Absolutely positioned, it was two
          // numbers that had to agree by coincidence, and a party of five
          // came down through a title long enough to wrap. In the flow it
          // cannot overlap: the browser is doing the arithmetic the PDF does
          // by hand in `render.ts`.
          `<div class="stack">${travellersSvg(20, page.figures)}` +
            `<h1 style="${pt(type.display)}">${escape(page.title)}</h1>` +
            (page.tagline ? `<p class="muted" style="${pt(type.subheading)}">${escape(page.tagline)}</p>` : "") +
            `<hr><p style="${pt(type.caption)}">${escape(page.dates)}</p>` +
            `<p class="muted" style="${pt(type.caption)}">${escape(page.travellers)}</p>` +
            (page.volume ? `<p class="muted" style="${pt(type.caption)}">${escape(page.volume)}</p>` : "") +
            `</div>`,
        ),
      );
      break;

    // Two pages of the same shape — a heading and some lines — but only one
    // of them signs the book off, so they no longer share a body.
    case "colophon":
      parts.push(
        textBlock(
          spec,
          page,
          // In the flow, above the heading — B764. Absolutely positioned at
          // 52% of the page they landed in the middle of a text block that
          // starts at the *top* of the content box, so the last page had the
          // party standing on its own colophon. Same fault as the title
          // page's, same fix, and invisible until B740 made the figures show
          // in the preview at all.
          `${travellersSvg(12, page.figures)}` +
            `<h2 style="${pt(type.caption)}">${escape(page.heading)}</h2>` +
            page.lines.map((l) => `<p style="${pt(type.body)}">${escape(l) || "&nbsp;"}</p>`).join(""),
        ),
      );
      break;

    case "intro":
      parts.push(
        textBlock(
          spec,
          page,
          `<h2 style="${pt(type.caption)}">${escape(page.heading)}</h2>` +
            page.lines.map((l) => `<p style="${pt(type.body)}">${escape(l) || "&nbsp;"}</p>`).join(""),
        ),
      );
      break;

    case "route":
      parts.push(routeSvg(spec, page.view, page.points, page.half, page.side));
      if (page.half === "right" || page.half === "full") {
        parts.push(`<div class="mapcap">${escape(page.caption)}</div>`);
      }
      break;

    case "chapter":
      // The party, arriving in this country — B727, and missing here until
      // B740. `render.ts` draws them at 6% of the content box from the foot;
      // this is the same place, spelled as CSS. A page kind drawn in one
      // renderer and not the other is the exact drift `charts.ts` opens by
      // warning about, and the owner's report was "I turned the figures on and
      // I do not see any" — they were in the PDF and nowhere they could look.
      parts.push(
        `<div style="position:absolute;left:${((spec.safeMm / (spec.size.trimWidthMm + spec.bleedMm * 2)) * 100).toFixed(3)}%;` +
          `bottom:8%">${travellersSvg(14, page.figures)}</div>`,
      );
      parts.push(
        textBlock(
          spec,
          page,
          `<div class="stack"><p class="muted" style="${pt(type.caption)}">${escape(page.label)}</p>` +
            `<h1 style="${pt(type.display)}">${escape(page.country)}</h1><hr>` +
            `<p style="${pt(type.subheading)}">${escape(page.dates)}</p>` +
            `<p class="muted" style="${pt(type.caption)}">${escape(page.stats)}</p></div>`,
        ),
      );
      break;

    case "day":
      if (page.photo) {
        const src = imageSrc(page.photo.photo, outDir, resolveFile, srcFor);
        parts.push(
          `<div class="slot" style="${style(spec, page.photo.clip)}">` +
            `<img src="${escape(src)}" alt="" style="${imgStyle(page.photo.clip, page.photo.draw)}">` +
            `</div>`,
        );
      }
      parts.push(
        textBlock(
          spec,
          page,
          `<p class="muted eyebrow" style="${pt(type.caption)}">${escape(page.dateLabel)}</p>` +
            `<h2 style="${pt(type.heading)}">${escape(page.title)}</h2>` +
            `<p class="accent" style="${pt(type.caption)}">${escape(page.location)}</p>` +
            (page.leg
              ? `<p class="muted" style="${pt(type.caption)}">${escape(page.leg.text)}</p>`
              : "") +
            page.lines.map((l) => `<p style="${pt(type.body)}">${escape(l) || "&nbsp;"}</p>`).join("") +
            page.captions
              .map((c) => `<p class="muted caption" style="${pt(type.caption)}">${escape(c)}</p>`)
              .join(""),
        ),
      );
      break;

    case "photos":
      for (const p of page.placements) {
        const src = imageSrc(p.photo, outDir, resolveFile, srcFor);
        parts.push(
          `<div class="slot" style="${style(spec, p.clip)}">` +
            `<img src="${escape(src)}" alt="" style="${imgStyle(p.clip, p.draw)}">` +
            `</div>`,
        );
        if (p.caption && p.captionBox) {
          parts.push(
            `<div class="cap" style="${style(spec, p.captionBox)};${pt(type.caption)}">${escape(p.caption)}</div>`,
          );
        }
      }
      break;

    case "followers":
      parts.push(
        textBlock(
          spec,
          page,
          `<p class="muted eyebrow" style="${pt(type.caption)}">${escape(page.heading)}</p><hr>` +
            `<p style="${pt(type.subheading)}">${escape(page.note)}</p>` +
            `<p class="muted" style="${pt(type.body)}">${escape(page.names.join("  \u00b7  "))}</p>`,
        ),
      );
      break;

    // Nothing but their charts, drawn from the geometry the PDF uses — B565.
    case "transport":
    case "costs":
    case "analytics":
      parts.push(chartSvg(spec, page.shapes));
      break;

    case "blank":
      parts.push(`<div class="blank">blank</div>`);
      break;
  }

  const trim = {
    left: `${((spec.bleedMm / (spec.size.trimWidthMm + spec.bleedMm * 2)) * 100).toFixed(3)}%`,
    top: `${((spec.bleedMm / (spec.size.trimHeightMm + spec.bleedMm * 2)) * 100).toFixed(3)}%`,
  };
  // The composer's drill-in (B534) reads this off the same HTML string the
  // preview already returned, rather than asking the server a second way: a
  // page's kind, and its date when it has one (a "day" page, or a "photos"
  // page carrying the date `materialise` set from the draft — see
  // `BookPage`'s "photos" variant). Harmless on the CLI's own copy of this
  // file, which nothing listens to.
  const date = page.kind === "day" || page.kind === "photos" ? page.date : undefined;
  return (
    `<figure class="page ${page.side}" data-kind="${escape(page.kind)}"${date ? ` data-date="${escape(date)}"` : ""}>` +
    // Everything printed on the page sits in one layer inside the sheet, so
    // that a phone reader pinching it has a single thing to transform and the
    // sheet stays the window it is seen through — B1421. It is a plain
    // `position:absolute;inset:0` box, so every percentage inside it (and the
    // sheet's own container query units) resolves exactly as it did.
    `<div class="sheet"><div class="zoom">${parts.join("")}` +
    `<div class="trim" style="left:${trim.left};right:${trim.left};top:${trim.top};bottom:${trim.top}"></div>` +
    `</div></div>` +
    `<figcaption>${page.number} · ${escape(
      captionFor ? captionFor(page) : page.kind + (page.kind === "photos" ? ` · ${page.layout}` : ""),
    )}</figcaption>` +
    `</figure>`
  );
}

function imgStyle(clip: RectMm, draw: RectMm): string {
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
  return [
    "position:absolute",
    `left:${pct(draw.x - clip.x, clip.width)}`,
    `bottom:${pct(draw.y - clip.y, clip.height)}`,
    `width:${pct(draw.width, clip.width)}`,
    `height:${pct(draw.height, clip.height)}`,
  ].join(";");
}

export function renderPreview(
  book: Photobook,
  outDir: string,
  /** `BookPhoto.file` → a real path. Identity for a source that already
   * hands over absolute ones, which is what a test usually does. */
  resolveFile: (file: string) => string = (file) => file,
  /**
   * Where the browser should fetch each photograph from.
   *
   * The CLI writes a folder and wants relative paths; the site serves
   * `/<user>/media/…` and has no folder. One callback rather than two
   * renderers — this file exists precisely so there is one layout, and a
   * second copy of it for the web would be the drift it was written to avoid.
   */
  srcFor?: SrcFor,
  /**
   * **Bare** — the composer's own copy of this document, B548.
   *
   * The same spreads, with everything around them removed: the header naming
   * bleed and a DPI target, the `<code>`-tagged warning list, the per-volume
   * "spine 1.8 mm" heading, the page-kind figcaptions, the single-page
   * toggle. All of that is a print technician's readout, and it was being
   * shown to whoever opened the composer on a phone — where it filled the
   * screen and the book itself was a letterbox underneath.
   *
   * The spreads also lie in a horizontal snap strip rather than a column, so
   * the frame is exactly one spread tall (`ratio`, from the preview route)
   * and the book is swiped rather than scrolled inside a box.
   *
   * The CLI's own copy — `scripts/photobook.ts`, written next to the PDFs —
   * is unchanged and keeps all of it: that reader *is* a technician.
   */
  opts: { bare?: boolean; captionFor?: CaptionFor } = {},
): string {
  const bare = opts.bare === true;
  const captionFor = opts.captionFor;
  const spec = book.spec;
  const ratio = (spec.size.trimWidthMm + spec.bleedMm * 2) / (spec.size.trimHeightMm + spec.bleedMm * 2);
  const spreadsFor = (volume: BookVolume) =>
    spreadsOf(volume.pages)
      .map((group) => {
        const cls = group.length === 1 ? "spread solo" : "spread";
        return `<div class="${cls}">${group
          .map((p) => pageHtml(spec, p, outDir, resolveFile, srcFor, captionFor))
          .join("")}</div>`;
      })
      .join("");

  // Bare: one strip for the whole book. A second volume is a page-count
  // accident, not something to swipe past a heading for — and two strips
  // would make the frame twice as tall as the one spread it is sized for.
  const volumes = bare
    ? `<section><div class="spreads">${book.volumes.map(spreadsFor).join("")}</div></section>`
    : book.volumes
        .map(
          (volume: BookVolume) =>
            `<section><h2>${escape(volume.title)} — ${volume.interiorPages} pages, ` +
            `spine ${volume.spineWidthMm.toFixed(1)} mm</h2>` +
            `<div class="spreads">${spreadsFor(volume)}</div></section>`,
        )
        .join("");

  // Folded away by default. They matter, but a list of forty is not what you
  // opened this page to look at.
  const warnings = bare
    ? ""
    : book.warnings.length
    ? `<details class="warnings"><summary>${book.warnings.length} warning(s)</summary>` +
      `<ul>${book.warnings
        .map((w) => `<li><code>${escape(w.code)}</code> ${escape(w.detail)}</li>`)
        .join("")}</ul></details>`
    : `<p class="muted nowarn">No warnings.</p>`;

  const header = `<header>
  <h1>${escape(book.title)}</h1>
  <p class="muted">${book.volumes.length} volume(s) · ${book.photoCount} photographs ·
     ${escape(spec.size.name)} · ${spec.bleedMm} mm bleed · ${spec.dpi} DPI target</p>
  <p class="muted">Dashed line is the trim. Everything outside it is bleed and gets cut off.</p>
  <p class="muted">Page one is a recto and sits alone; after that pages face each other across
     the fold, which is how the book is actually read.</p>
  <div class="viewToggle">
    <button type="button" id="view-toggle">Single pages</button>
  </div>
</header>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(book.title)} — photobook preview</title>
<style>
  /* Three of these are the printed inks and are read from the one palette
     rather than written again — B702. This block used to hardcode
     \`--accent:#2c5c85\`, which was not even the same blue the PDF was drawing
     beside it, so the composer showed a page in a colour the press was never
     asked for. \`--paper\` and \`--bg\` are the screen's own, not the book's. */
  :root { color-scheme: light dark; --ink:${cssTone("ink")}; --muted:${cssTone("muted")};
          --accent:${cssTone("accent")}; --paper:#fff; --bg:#e7e5e1; }
  @media (prefers-color-scheme: dark) { :root { --bg:#17181a; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",sans-serif; }
  header { max-width:70ch; margin:0 auto 2rem; }
  h1 { margin:0 0 .25rem; }
  .warnings, .nowarn { max-width:70ch; margin:0 auto 2rem; }
  .warnings summary { cursor:pointer; color:var(--muted); }
  .warnings ul { padding-left:1.2rem; margin:.5rem 0 0; }
  .warnings li { margin:.25rem 0; font-size:.9em; }
  .warnings code { background:#0001; padding:0 .25em; border-radius:3px; }
  section { max-width:1400px; margin:0 auto 3rem; }
  section > h2 { font-size:1rem; font-weight:600; color:var(--muted); }
  figure { margin:0; min-width:0; }
  figcaption { font-size:11px; color:var(--muted); margin-top:.35rem; }
  .sheet { position:relative; aspect-ratio:${ratio.toFixed(4)}; background:var(--paper);
           container-type:size; overflow:hidden; box-shadow:0 1px 3px #0003,0 8px 24px #0002; }
  /* One layer holding everything printed on the page, so a pinch has one
     thing to move and the sheet stays the window — B1421. Untransformed by
     default, which is every reader who never pinches. */
  .zoom { position:absolute; inset:0; transform-origin:center center; }
  .page.left .sheet { box-shadow:inset 6px 0 12px -10px #0006,0 1px 3px #0003; }
  .page.right .sheet { box-shadow:inset -6px 0 12px -10px #0006,0 1px 3px #0003; }

  /* Single-page view: the flat grid this preview always had. The .spread
     wrapper added for the spread view is unwrapped with display:contents so
     every page still lands as its own grid cell. */
  body[data-view="pages"] .spreads { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:1.25rem; }
  body[data-view="pages"] .spread { display:contents; }

  /* Spread view: pages stacked as facing pairs, page one alone because there
     is no page zero to face it. The fold is drawn once per pair rather than
     simulated per photo — a shaded band at the seam, over both halves, which
     is the cheapest thing that reads as a gutter. */
  body[data-view="spreads"] .spreads { display:flex; flex-direction:column; align-items:center; gap:2.5rem; }
  body[data-view="spreads"] .spread { display:flex; width:min(920px,100%); }
  body[data-view="spreads"] .spread.solo { width:min(460px,50%); }
  body[data-view="spreads"] .spread figure { flex:1 1 0; }
  body[data-view="spreads"] .spread:not(.solo) { position:relative; }
  body[data-view="spreads"] .spread:not(.solo)::before {
    content:""; position:absolute; top:0; bottom:0; left:50%; width:16px; margin-left:-8px;
    background:linear-gradient(90deg,transparent,#0002 40%,#0005 50%,#0002 60%,transparent);
    pointer-events:none; z-index:1;
  }

  .viewToggle { margin-top:.75rem; }
  .viewToggle button { font:inherit; padding:.35em .8em; border:1px solid #0002; border-radius:6px;
                        background:var(--paper); color:var(--ink); cursor:pointer; }
  .trim { position:absolute; outline:1px dashed #d33a; pointer-events:none; }
  .copy { position:absolute; display:flex; flex-direction:column; justify-content:flex-start;
          gap:.15em; overflow:hidden; color:var(--ink); }
  .copy .stack { margin-top:auto; margin-bottom:20%; }
  /* A party standing on the block it belongs to — B756, B764.
     align-self, because .copy is a flex column: without it the svg box is
     stretched to the full column width and preserveAspectRatio centres the
     drawing inside it, so the preview put the figures in the middle of a page
     the PDF draws them at the margin of. The preview is evidence about paper
     or it is nothing. (No backticks in here: this block is inside a template
     literal, and one closed it — a 500 on every preview.) */
  .copy .stack > svg, .copy > svg { margin-bottom:0.6em; align-self:flex-start; }
  .copy h1 { font-weight:700; line-height:1.12; margin:0; }
  .copy h2 { font-weight:700; margin:0 0 .35em; }
  .copy p { margin:0 0 .3em; line-height:1.5; }
  .copy hr { border:0; border-top:2px solid var(--accent); width:40%; margin:.6em 0; }
  .copy table { width:100%; border-collapse:collapse; font-size:.9em; }
  .copy td { border-bottom:1px solid #0001; padding:.15em 0; }
  .copy td:last-child { text-align:right; color:var(--muted); }
  .muted { color:var(--muted); }
  .accent { color:var(--accent); }
  .eyebrow { letter-spacing:.18em; text-transform:uppercase; }
  .caption { font-style:italic; }
  .slot { position:absolute; overflow:hidden; background:#0000000a; }
  .slot img { object-fit:fill; }
  .cap { position:absolute; color:var(--muted); font-style:italic; overflow:hidden;
         display:flex; align-items:flex-end; }
  .chart { position:absolute; inset:0; width:100%; height:100%; }
  /* The book's own face, so a chart page previews as the page it will be
     rather than in the browser's UI font. */
  .chart text { font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; }
  .map { position:absolute; inset:0; width:100%; height:100%; }
  .map .land { fill:#eceae7; stroke:#d6d3ce; stroke-width:.3; }
  .map .graticule { fill:none; stroke:#dedbd6; stroke-width:.25; }
  .map .route { fill:none; stroke:var(--accent); stroke-width:1.6;
                stroke-linecap:round; stroke-linejoin:round; }
  .map .stop { fill:var(--accent); stroke:#fff; stroke-width:.5; }
  /* Paint-order so the halo sits behind the glyphs rather than over them. */
  .map .stopname { fill:#1f2937; stroke:#fff; stroke-width:.6; paint-order:stroke;
                   font-weight:600; }
  .mapcap { position:absolute; right:6%; bottom:5%; font-size:2.6cqh; font-style:italic;
            color:var(--muted); }
  .blank { position:absolute; inset:0; display:grid; place-items:center; color:#0000001a; }
  /* Drillable pages — B534. Only pages the composer can open a level-2 view
     for get the affordance; a page nobody can drill into (a "blank", or any
     front matter — title, route, costs, colophon — which has no controls of
     its own; those live in the whole-book settings, one tap from level 1;
     B563) stays inert. */
  figure.drillable .sheet { cursor:pointer; }
  figure.drillable .sheet:hover { outline:2px solid var(--accent); outline-offset:2px; }

  /* Bare — the composer's frame, B548. One spread wide, one spread tall, and
     the next one peeping in at the edge so it reads as something to swipe.
     The scrollbar is hidden rather than the overflow: the strip *is* the
     navigation, and a visible bar under the book at 390px is the letterbox
     look this ticket exists to remove. */
  body.bare { padding:0; background:transparent; }
  body.bare section { margin:0; max-width:none; }
  /* A height to centre in is the symmetric-spacing fix — B561. The frame is one spread
     tall at *full* width, but a spread is 96% of it and the strip is padded,
     so the pages are a little shorter than the frame. Without a height to
     centre in, the flex line sat at the top and every one of those spare
     pixels fell below the book: no gap above it, a visible one under it, and
     a composition that reads as broken. */
  body.bare[data-view="spreads"] .spreads {
    flex-direction:row; align-items:center; gap:.5rem; padding:0 .375rem;
    min-height:100svh;
    overflow-x:auto; overscroll-behavior-x:contain;
    scroll-snap-type:x mandatory; scrollbar-width:none;
  }
  body.bare[data-view="spreads"] .spreads::-webkit-scrollbar { display:none; }
  body.bare[data-view="spreads"] .spread { flex:0 0 96%; width:auto; scroll-snap-align:center; }
  /* Page one still stands alone, but it takes a whole snap step: every stop
     on the strip shows one thing, and half a cover beside a spread reads as a
     layout accident rather than as the recto it is. */
  body.bare[data-view="spreads"] .spread.solo { justify-content:center; }
  body.bare[data-view="spreads"] .spread.solo figure { flex:0 0 50%; }
  body.bare figcaption { display:none; }
  /* The dashed trim rectangle is a pre-press guide, and the sentence that
     explained it went with the header. Left on, it is a red dashed box
     around every page of somebody's holiday. The CLI's copy keeps both. */
  body.bare .trim { display:none; }
  /* And the word "blank" watermarked on an empty page: English whatever the
     book's language, and the warning above the frame already says in the
     reader's own words that the book ends with empty pages. */
  body.bare .blank { color:transparent; }
  /* Except the one B550 marks: a facing page that belongs to another day is
     dimmed, and this is the word that says why. */
  body.bare figure[data-other] figcaption { display:block; text-align:center; }

  /* Reading the book — B561. The same document as the strip, one class
     different: the spreads unwrap into a column and are scrolled rather than
     swiped, at the full width of whatever is showing them. This is the last
     look somebody takes before spending money, so it is also the one place a
     caption is worth the room — where each page came from, in the reader's
     own words (B562).

     Not a second preview: the composer already holds this HTML, and asking
     the server again for the same book laid out differently would be a
     second request shape to keep in step with the first. */
  body.bare.read[data-view="spreads"] .spreads {
    flex-direction:column; align-items:center; gap:1.5rem;
    min-height:0; height:100svh; padding:1rem .75rem 3rem;
    overflow-x:hidden; overflow-y:auto; overscroll-behavior-y:contain;
    scroll-snap-type:y proximity;
  }
  /* Never taller than the screen showing it — a spread you cannot see the
     whole of is not a spread. The cap is written from the book's own shape,
     which is the same number the composer sizes its frame from. */
  body.bare.read[data-view="spreads"] .spread {
    flex:0 0 auto; width:100%; max-width:calc(76svh * ${(ratio * 2).toFixed(4)});
    scroll-snap-align:center;
  }
  body.bare.read[data-view="spreads"] .spread.solo { width:min(50%, calc(38svh * ${(ratio * 2).toFixed(4)})); }
  body.bare.read[data-view="spreads"] .spread.solo figure { flex:1 1 auto; }
  body.bare.read figcaption { display:block; text-align:center; }
  /* Reading, not arranging: a tap here must not swap the level underneath
     the reader. The drill-in belongs to the strip. The script below also
     declines to bind the drill listener in this document at all, which is
     what lets the phone rules give a page its taps back for zooming. */
  body.bare.read figure { pointer-events:none; }

  /* A phone is not wide enough for two pages — B1421.
     640px and under, a stop is one page: the spread unwraps with the
     same display:contents the single-page view has always used, and each page
     takes the full width. A square page goes from about 190px to 390px on a
     phone, four times the area, and this is the last look somebody takes
     before paying for a printed object.

     The fold band is drawn down the middle of a spread and goes with it —
     but the seam is not lost. .page.left / .page.right keep the inset
     shadow on the gutter edge, so a split page still says which side of the
     fold it is on and B518's class of fault (a route map in the gutter) is
     still visible one page at a time. Above this width nothing changes:
     facing pages, band and all. */
  @media (max-width:640px) {
    body.bare.read[data-view="spreads"] .spread,
    body.bare.read[data-view="spreads"] .spread.solo { display:contents; }
    /* The band is drawn down the middle of a spread, and a display:contents
       element still generates its pseudo — with position:relative no longer
       having any effect on it, so the absolute box escapes to the viewport
       and paints a dark stripe down the whole screen. Seen at 390px before
       it was removed. The gutter shadow on the page is what carries the
       seam here. */
    body.bare.read[data-view="spreads"] .spread::before { display:none; }
    body.bare.read[data-view="spreads"] .page {
      flex:0 0 auto; width:100%; max-width:calc(76svh * ${ratio.toFixed(4)});
      scroll-snap-align:center;
      /* Zoomable, and only here. pan-y leaves the one-finger swipe to the
         scroller — the book still scrolls — and hands two-finger gestures to
         the script, which is the only way to have both. */
      pointer-events:auto; touch-action:pan-y;
    }
  }
</style></head><body${bare ? ' class="bare"' : ""} data-view="spreads">
${bare ? "" : header}${warnings}
${volumes}
<script>
  // The only script in the file, and it does one thing: flip which of the two
  // CSS layouts above applies. No framework and no build step — this has to
  // open from a file:// URL with nothing else running. Absent in bare mode,
  // where there is no toggle to bind to.
  var toggle = document.getElementById("view-toggle");
  if (toggle) toggle.addEventListener("click", function () {
    var spreads = document.body.dataset.view === "spreads";
    document.body.dataset.view = spreads ? "pages" : "spreads";
    this.textContent = spreads ? "Spreads" : "Single pages";
  });
  // B534's drill-in: tell whoever is embedding this (the composer, in an
  // iframe) which spread was tapped. Posted rather than navigated, because
  // this document has no idea it is inside one — opened straight from a
  // folder, as the CLI leaves it, nothing is listening and this is a no-op.
  //
  // Not in the reading view. That document is the same string with one class
  // added, and a tap in it must not swap the level underneath the reader —
  // which used to be guaranteed by pointer-events:none on the figure alone.
  // B1421 gives a page its taps back on a phone so it can be pinched, so the
  // guarantee moves here, where it is stronger: the listener is never bound.
  var READING = document.body.classList.contains("read");
  var DRILLABLE = ["day", "photos"];
  if (!READING) document.querySelectorAll("figure[data-kind]").forEach(function (fig) {
    var kind = fig.dataset.kind;
    if (DRILLABLE.indexOf(kind) === -1) return;
    fig.classList.add("drillable");
    fig.addEventListener("click", function () {
      parent.postMessage(
        { source: "fernscout-photobook-preview", kind: kind, date: fig.dataset.date || null },
        "*",
      );
    });
  });

  // Pinch and double-tap one page — B1421.
  //
  // A phone shows one page at a time and it is still a 21 cm object at about
  // 390px, so the last look before paying for print needs a way in closer.
  // The book is an iframe, and no browser zooms an iframe's contents on their
  // own — a pinch inside one scales the whole dialog, Order button and all —
  // so the gesture is handled here or not at all.
  //
  // Bound in the reading document only; at wider widths the CSS above leaves
  // pointer-events:none in place and none of this can fire, which is the
  // intended shape rather than an accident: a desktop spread is already large.
  if (READING) document.querySelectorAll("figure.page").forEach(function (fig) {
    var layer = fig.querySelector(".zoom");
    if (!layer) return;
    var MAX = 3, scale = 1, tx = 0, ty = 0, pts = {}, n = 0, start = null, lastTap = 0;

    function apply() {
      // Panning is clamped to the sheet, so a zoomed page cannot be dragged
      // off its own paper and left showing the ground behind it.
      var lim = (fig.getBoundingClientRect().width * (scale - 1)) / 2;
      tx = Math.max(-lim, Math.min(lim, tx));
      ty = Math.max(-lim, Math.min(lim, ty));
      layer.style.transform = scale === 1 ? "" : "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    }

    function spanOfTwo() {
      var a = null, b = null;
      for (var id in pts) { if (!a) a = pts[id]; else if (!b) b = pts[id]; }
      return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }

    fig.addEventListener("pointerdown", function (e) {
      if (!pts[e.pointerId]) n++;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (n === 2) start = { d: spanOfTwo(), s: scale };
      else if (n === 1 && scale > 1) {
        fig.setPointerCapture(e.pointerId);
        start = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      }
    });

    fig.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (n === 2 && start) {
        e.preventDefault();
        scale = Math.max(1, Math.min(MAX, start.s * (spanOfTwo() / start.d)));
        apply();
      } else if (n === 1 && scale > 1 && start && start.tx !== undefined) {
        e.preventDefault();
        tx = start.tx + (e.clientX - start.x);
        ty = start.ty + (e.clientY - start.y);
        apply();
      }
    });

    function release(e) {
      if (pts[e.pointerId]) { delete pts[e.pointerId]; n--; }
      if (n < 2) start = null;
      // Anything within a hair of life size goes back to exactly life size,
      // so a page is never left a per cent off and slightly soft.
      if (scale <= 1.02) { scale = 1; tx = ty = 0; apply(); }
    }
    fig.addEventListener("pointerup", release);
    fig.addEventListener("pointercancel", release);

    // The same gesture on a phone and on a trackpad, and the way back out.
    // Zooms toward the tap rather than the middle, because what somebody
    // wants a closer look at is rarely in the centre of the page.
    fig.addEventListener("click", function (e) {
      var gap = e.timeStamp - lastTap;
      lastTap = e.timeStamp;
      if (gap >= 350) return;
      // A tap that has been acted on is not half of the next pair, or three
      // taps in a row zoom in and straight back out again.
      lastTap = 0;
      if (scale > 1) { scale = 1; tx = ty = 0; }
      else {
        var box = fig.getBoundingClientRect();
        scale = 2.5;
        tx = (box.left + box.width / 2 - e.clientX) * (scale - 1);
        ty = (box.top + box.height / 2 - e.clientY) * (scale - 1);
      }
      apply();
    });
  });
</script>
</body></html>
`;
}
