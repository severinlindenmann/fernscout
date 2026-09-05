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
import { contentBoxMm, type BookSpec, type RectMm } from "./spec.ts";
import {
  mapClipMm,
  mapProjector,
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

/**
 * The cost page, in the same shape the renderer draws it.
 *
 * It used to be a two-column table here and a stacked bar with a budget
 * comparison on paper — so the preview said the page was fine and the printed
 * page was a different page. This file exists to stop exactly that, and the
 * cost page is the one it had quietly stopped doing it for.
 *
 * The tints match `categoryTint` in render.ts: the same accent, lightened in
 * the same steps.
 */
function costsHtml(
  heading: string,
  costs: { baseCurrency: string; total: number; byCategory: { category: string; amount: number }[]; budget?: { total: number } },
  money: (n: number) => string,
  type: ReturnType<typeof typeScale>,
  /** Passed in rather than rebuilt: it closes over the page's own scale, and a
   * second copy of that formula is a second thing to get wrong. */
  pt: (size: number) => string,
): string {
  const shown = costs.byCategory.slice(0, 6);
  const sum = shown.reduce((n, r) => n + r.amount, 0);
  const tint = (i: number) => {
    const k = Math.min(i, 5) * 0.145;
    const mix = (v: number) => Math.round((v + (1 - v) * k) * 255);
    return `rgb(${mix(0.17)},${mix(0.36)},${mix(0.52)})`;
  };
  const bar = shown
    .map(
      (r, i) =>
        `<span style="display:inline-block;height:100%;width:${sum > 0 ? (r.amount / sum) * 100 : 0}%;background:${tint(i)}"></span>`,
    )
    .join("");
  const key = shown
    .map(
      (r, i) =>
        `<tr><td><span style="display:inline-block;width:0.7em;height:0.7em;background:${tint(i)}"></span> ` +
        `${escape(r.category)}</td><td>${money(r.amount)}</td></tr>`,
    )
    .join("");
  const most = costs.budget ? Math.max(costs.budget.total, costs.total) : costs.total;
  const budget = costs.budget
    ? `<p class="muted eyebrow" style="${pt(type.caption)}">Budget and what happened</p>` +
      [
        ["Budgeted", costs.budget.total, "#d9d7d2"],
        ["Spent", costs.total, "rgb(43,92,133)"],
      ]
        .map(
          ([label, value, colour]) =>
            `<p style="${pt(type.caption)};margin:0">${label} — ${money(value as number)}</p>` +
            `<div style="height:0.5em;width:${((value as number) / most) * 100}%;background:${colour}"></div>`,
        )
        .join("")
    : "";
  return (
    `<p class="muted eyebrow" style="${pt(type.caption)}">${escape(heading)}</p>` +
    `<h1 style="${pt(type.display)}">${money(costs.total)}</h1>` +
    `<div style="display:flex;height:1.2em;width:100%">${bar}</div>` +
    `<table>${key}</table>` +
    budget
  );
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
  half: "left" | "right",
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

  const dots = points
    .map((p) => {
      const [x, y] = to(p.x, p.y);
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.1" class="stop"/>`;
    })
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

function pageHtml(
  spec: BookSpec,
  page: BookPage,
  outDir: string,
  resolveFile: (file: string) => string,
  srcFor: SrcFor | undefined,
): string {
  const type = typeScale(spec);
  const scale = 100 / (spec.size.trimHeightMm + spec.bleedMm * 2);
  const pt = (size: number) => `font-size:${(size * scale * 0.352778).toFixed(3)}cqh`;
  const parts: string[] = [];

  switch (page.kind) {
    case "title":
      parts.push(
        `<div style="position:absolute;left:${((spec.safeMm / (spec.size.trimWidthMm + spec.bleedMm * 2)) * 100).toFixed(3)}%;` +
          `bottom:52%">${travellersSvg(20, page.figures)}</div>`,
      );
      parts.push(
        textBlock(
          spec,
          page,
          `<div class="stack"><h1 style="${pt(type.display)}">${escape(page.title)}</h1>` +
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
        `<div style="position:absolute;left:${((spec.safeMm / (spec.size.trimWidthMm + spec.bleedMm * 2)) * 100).toFixed(3)}%;` +
          `bottom:52%">${travellersSvg(12, page.figures)}</div>`,
      );
      parts.push(
        textBlock(
          spec,
          page,
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
      parts.push(routeSvg(spec, page.view, page.points, page.half));
      if (page.half === "right") {
        parts.push(`<div class="mapcap">${escape(page.caption)}</div>`);
      }
      break;

    case "chapter":
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

    case "transport":
      parts.push(
        textBlock(
          spec,
          page,
          `<p class="muted eyebrow" style="${pt(type.caption)}">${escape(page.heading)}</p>` +
            page.modes
              .map(
                (m) =>
                  `<p><span class="accent" style="${pt(type.display)}"><strong>${m.days}</strong></span> ` +
                  `<span style="${pt(type.subheading)}">${escape(m.label)}</span></p>`,
              )
              .join("") +
            (page.note
              ? `<hr><p class="muted" style="${pt(type.caption)}">${escape(page.note)}</p>`
              : ""),
        ),
      );
      break;

    case "costs": {
      const money = (n: number) => `${page.costs.baseCurrency} ${Math.round(n).toLocaleString("en-GB")}`;
      parts.push(
        textBlock(
          spec,
          page,
          costsHtml(page.heading, page.costs, money, type, pt),
        ),
      );
      break;
    }

    case "blank":
      parts.push(`<div class="blank">blank</div>`);
      break;
  }

  const trim = {
    left: `${((spec.bleedMm / (spec.size.trimWidthMm + spec.bleedMm * 2)) * 100).toFixed(3)}%`,
    top: `${((spec.bleedMm / (spec.size.trimHeightMm + spec.bleedMm * 2)) * 100).toFixed(3)}%`,
  };
  return (
    `<figure class="page ${page.side}">` +
    `<div class="sheet">${parts.join("")}` +
    `<div class="trim" style="left:${trim.left};right:${trim.left};top:${trim.top};bottom:${trim.top}"></div>` +
    `</div>` +
    `<figcaption>${page.number} · ${page.kind}${page.kind === "photos" ? ` · ${page.layout}` : ""}</figcaption>` +
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
): string {
  const spec = book.spec;
  const ratio = (spec.size.trimWidthMm + spec.bleedMm * 2) / (spec.size.trimHeightMm + spec.bleedMm * 2);
  const volumes = book.volumes
    .map(
      (volume: BookVolume) =>
        `<section><h2>${escape(volume.title)} — ${volume.interiorPages} pages, ` +
        `spine ${volume.spineWidthMm.toFixed(1)} mm</h2>` +
        `<div class="spreads">${volume.pages.map((p) => pageHtml(spec, p, outDir, resolveFile, srcFor)).join("")}</div>` +
        `</section>`,
    )
    .join("");

  // Folded away by default. They matter, but a list of forty is not what you
  // opened this page to look at.
  const warnings = book.warnings.length
    ? `<details class="warnings"><summary>${book.warnings.length} warning(s)</summary>` +
      `<ul>${book.warnings
        .map((w) => `<li><code>${escape(w.code)}</code> ${escape(w.detail)}</li>`)
        .join("")}</ul></details>`
    : `<p class="muted nowarn">No warnings.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(book.title)} — photobook preview</title>
<style>
  :root { color-scheme: light dark; --ink:#1b2129; --muted:#6b7280; --accent:#2c5c85; --paper:#fff; --bg:#e7e5e1; }
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
  .spreads { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:1.25rem; }
  figure { margin:0; }
  figcaption { font-size:11px; color:var(--muted); margin-top:.35rem; }
  .sheet { position:relative; aspect-ratio:${ratio.toFixed(4)}; background:var(--paper);
           container-type:size; overflow:hidden; box-shadow:0 1px 3px #0003,0 8px 24px #0002; }
  .page.left .sheet { box-shadow:inset 6px 0 12px -10px #0006,0 1px 3px #0003; }
  .trim { position:absolute; outline:1px dashed #d33a; pointer-events:none; }
  .copy { position:absolute; display:flex; flex-direction:column; justify-content:flex-start;
          gap:.15em; overflow:hidden; color:var(--ink); }
  .copy .stack { margin-top:auto; margin-bottom:20%; }
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
  .map { position:absolute; inset:0; width:100%; height:100%; }
  .map .land { fill:#eceae7; stroke:#d6d3ce; stroke-width:.3; }
  .map .graticule { fill:none; stroke:#dedbd6; stroke-width:.25; }
  .map .route { fill:none; stroke:var(--accent); stroke-width:1.6;
                stroke-linecap:round; stroke-linejoin:round; }
  .map .stop { fill:var(--accent); stroke:#fff; stroke-width:.5; }
  .mapcap { position:absolute; right:6%; bottom:5%; font-size:2.6cqh; font-style:italic;
            color:var(--muted); }
  .blank { position:absolute; inset:0; display:grid; place-items:center; color:#0000001a; }
</style></head><body>
<header>
  <h1>${escape(book.title)}</h1>
  <p class="muted">${book.volumes.length} volume(s) · ${book.photoCount} photographs ·
     ${escape(spec.size.name)} · ${spec.bleedMm} mm bleed · ${spec.dpi} DPI target</p>
  <p class="muted">Dashed line is the trim. Everything outside it is bleed and gets cut off.</p>
</header>
${warnings}
${volumes}
</body></html>
`;
}
