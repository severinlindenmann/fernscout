/**
 * The book's charts, as geometry — B565.
 *
 * Everything on a summary page is drawn twice: once by `render.ts` in raw PDF
 * operators and once by `preview.ts` as SVG for the browser. When those two
 * each did their own arithmetic they drifted, and the composer then showed a
 * page the printer would not produce — which is the one failure the preview
 * exists to prevent. `graticule.ts` is the existing precedent, extracted after
 * the map drifted for exactly this reason.
 *
 * So: **compute once, render twice.** These functions take numbers and a box
 * in millimetres and return a flat list of primitives in millimetres, y
 * upwards from the trim corner — the same coordinate space `RectMm` uses
 * everywhere else in this folder. Both renderers walk that list and neither
 * does any arithmetic of its own. A test pins them to the same numbers.
 *
 * Pure, like `plan.ts`: no filesystem, no PDF writer, no server. `measure()`
 * from `text.ts` is the one thing consulted, because right-aligning a label is
 * geometry and has to agree between the two renderers.
 *
 * The visual language is the site's own — `components/charts/Charts.tsx`. One
 * hue for one quantity, tints rather than hues for the parts of a whole, thin
 * marks, recessive axes, and a label beside the thing rather than a number on
 * every mark. A book that charts a trip in a different idiom than the journal
 * it came from looks like two products.
 */

import { mm, type RectMm } from "./spec.ts";
import { measure } from "./text.ts";

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

export type Rgb = { r: number; g: number; b: number };

/**
 * The accent, in two weights of one hue — B702.
 *
 * The ochre is the waymark's own (`--color-yellow-600`, `#d69b0a`); it used to
 * be `#2b5c85`, a blue belonging to nothing here.
 *
 * Two weights because one constant cannot do both of this accent's jobs.
 * `ACCENT` carries *ink*: the rule under a heading, the route line, a day's
 * location, the eyebrow on the cover — small type at caption size, which at
 * the bright ochre would be about 3:1 against paper and therefore not
 * readable. `TINT_BASE` fills *areas*, where the bright one is exactly right
 * and where nothing has to be read out of it.
 *
 * Same hue, two lightnesses, so a chart and the rule above it still look like
 * one book.
 */
const ACCENT: Rgb = { r: 0.561, g: 0.396, b: 0.078 };
const TINT_BASE: Rgb = { r: 0.839, g: 0.608, b: 0.039 };

/**
 * Six tints of the one accent, darkest first.
 *
 * Not six hues. A budget is one quantity split up, so the segments belong to
 * each other; six colours would say they were six unrelated things, and a book
 * printed on uncoated stock cannot be trusted to keep them distinguishable
 * anyway. Lightening one ink always survives the press.
 */
function tintOf(index: number): Rgb {
  const t = Math.min(Math.max(index, 0), 5) * 0.145;
  return {
    r: TINT_BASE.r + (1 - TINT_BASE.r) * t,
    g: TINT_BASE.g + (1 - TINT_BASE.g) * t,
    b: TINT_BASE.b + (1 - TINT_BASE.b) * t,
  };
}

/**
 * The palette, and the only copy of it.
 *
 * `render.ts` reads these rather than keeping its own constants, and
 * `preview.ts` turns them into CSS with `cssTone`. Two ink tables would be two
 * things to keep in step, and the composer would eventually be showing a page
 * in colours the press was never asked for.
 *
 * RGB because that is what the PDF writer can honestly emit, and chosen to
 * survive conversion to CMYK: nothing more saturated than a four-colour press
 * can hold, and a soft near-black rather than a flat key plate.
 */
export const PALETTE = {
  ink: { r: 0.106, g: 0.129, b: 0.161 },
  muted: { r: 0.42, g: 0.45, b: 0.49 },
  rule: { r: 0.82, g: 0.83, b: 0.85 },
  /** The empty part of a bar's track. Lighter than `rule`, so a bar drawn in
   * `rule` — the budget, against what was spent — still reads as a bar. */
  track: { r: 0.92, g: 0.92, b: 0.93 },
  /** A wash behind a row: present, never competing with the type. Warm, so it
   * belongs to the same book as the accent above it — it was a blue-grey. */
  faint: { r: 0.976, g: 0.945, b: 0.867 },
  accent: ACCENT,
  paper: { r: 1, g: 1, b: 1 },
  tint0: tintOf(0),
  tint1: tintOf(1),
  tint2: tintOf(2),
  tint3: tintOf(3),
  tint4: tintOf(4),
  tint5: tintOf(5),
} satisfies Record<string, Rgb>;

export type Tone = keyof typeof PALETTE;

export const rgbOf = (tone: Tone): Rgb => PALETTE[tone];

/** The same ink as a CSS colour, for the browser's copy of the page. */
export function cssTone(tone: Tone): string {
  const c = PALETTE[tone];
  const to255 = (v: number) => Math.round(v * 255);
  return `rgb(${to255(c.r)},${to255(c.g)},${to255(c.b)})`;
}

const TINTS: Tone[] = ["tint0", "tint1", "tint2", "tint3", "tint4", "tint5"];
const tintTone = (index: number): Tone => TINTS[Math.min(Math.max(index, 0), 5)];

// ---------------------------------------------------------------------------
// What a chart is made of
// ---------------------------------------------------------------------------

/** A point in trim-relative millimetres, y upwards. */
export type PointMm = { x: number; y: number };

export type ChartShape =
  | ({ kind: "rect"; tone: Tone } & RectMm)
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      tone: Tone;
      widthMm: number;
      /** Dash length in mm. Absent is solid. */
      dashMm?: number;
    }
  /** An open polyline — the top of an area, or a reference curve. */
  | { kind: "polyline"; points: PointMm[]; tone: Tone; widthMm: number; dashMm?: number }
  /** The same run of points, closed down to `baselineY` and filled. */
  | { kind: "area"; points: PointMm[]; baselineY: number; tone: Tone }
  | { kind: "dot"; x: number; y: number; radiusMm: number; tone: Tone }
  | {
      kind: "text";
      /** The left edge. Right-aligned text is resolved here so both renderers
       * put it in the same place — see the note at the top of this file. */
      x: number;
      /** The baseline. */
      y: number;
      text: string;
      sizePt: number;
      tone: Tone;
      weight: "regular" | "bold" | "italic";
    };

/** Points to millimetres. The type scale is in points; every box here is mm. */
const ptToMm = (points: number): number => points / mm(1);

/** Letter-spaced small capitals — the book's eyebrow, faked as `render.ts` does. */
function eyebrowText(value: string): string {
  return value.toUpperCase().split("").join(" ");
}

type TypeScale = {
  display: number;
  heading: number;
  subheading: number;
  body: number;
  caption: number;
};

// ---------------------------------------------------------------------------
// Primitives used more than once
// ---------------------------------------------------------------------------

function label(
  x: number,
  y: number,
  text: string,
  sizePt: number,
  tone: Tone,
  weight: "regular" | "bold" | "italic" = "regular",
): ChartShape {
  return { kind: "text", x, y, text, sizePt, tone, weight };
}

/** The same, hung off its right edge. Resolved to a left edge here. */
function labelRight(
  rightMm: number,
  y: number,
  text: string,
  sizePt: number,
  tone: Tone,
  weight: "regular" | "bold" | "italic" = "regular",
): ChartShape {
  const width = ptToMm(measure(text, sizePt, weight === "bold" ? "bold" : "regular"));
  return label(rightMm - width, y, text, sizePt, tone, weight);
}

type BarRow = {
  label: string;
  /** Already formatted — money, nights, a count. This module never formats. */
  valueText: string;
  value: number;
  tone?: Tone;
};

/**
 * A labelled row with a proportional bar under it — the site's `BarList`.
 *
 * One hue, horizontal, so a long name stays readable and the eye compares
 * lengths on a common baseline. Returns the shapes and the y the next row
 * starts at, so a page composes downward without a second copy of the spacing.
 */
function barRows(
  box: RectMm,
  topY: number,
  rows: BarRow[],
  type: TypeScale,
  opts: { barMm?: number; gapMm?: number; scaleTo?: number } = {},
): { shapes: ChartShape[]; y: number } {
  const barMm = opts.barMm ?? 2.4;
  const gapMm = opts.gapMm ?? 4.5;
  const most = opts.scaleTo ?? Math.max(...rows.map((r) => r.value), 1);
  const shapes: ChartShape[] = [];
  let y = topY;
  for (const row of rows) {
    shapes.push(label(box.x, y, row.label, type.caption, "ink"));
    shapes.push(labelRight(box.x + box.width, y, row.valueText, type.caption, "muted"));
    y -= ptToMm(type.caption) * 0.6 + barMm;
    // The track, then the bar. A track means a short bar still reads as a
    // measurement against something rather than as a stray mark.
    shapes.push({ kind: "rect", x: box.x, y, width: box.width, height: barMm, tone: "track" });
    shapes.push({
      kind: "rect",
      x: box.x,
      y,
      width: most > 0 ? Math.max((row.value / most) * box.width, 0) : 0,
      height: barMm,
      /** A bar is a fill; the ink accent is for rules and type — B702. */
      tone: row.tone ?? "tint0",
    });
    y -= gapMm;
  }
  return { shapes, y };
}

export type Column = {
  /** Bottom and top of the mark, in the value's own units. A day with no
   * reading is `undefined` and draws nothing — see `columns`. */
  span?: { lo: number; hi: number };
};

/**
 * A run of columns across a plot — daily spend, or a daily high-and-low band.
 *
 * **A gap is a gap.** A column with no span draws nothing at all: no zero, no
 * interpolation, no bridging to the next reading. AGENTS.md is explicit that
 * a measurement nobody took must not be invented, and a chart wanting an even
 * rhythm does not soften that.
 */
export function columns(
  plot: RectMm,
  data: Column[],
  scale: { min: number; max: number },
  /** A fill, so a tint rather than the ink accent — B702. */
  tone: Tone = "tint0",
): ChartShape[] {
  if (data.length === 0) return [];
  const span = scale.max - scale.min || 1;
  const step = plot.width / data.length;
  // A hairline gap between columns while there is room for one; past about a
  // hundred days there is not, and a solid band is better than a grey smear.
  const gap = Math.min(step * 0.25, 0.6);
  const width = Math.max(step - gap, 0.25);
  const yFor = (v: number) => plot.y + ((v - scale.min) / span) * plot.height;
  const shapes: ChartShape[] = [];
  data.forEach((column, i) => {
    if (!column.span) return;
    const lo = yFor(Math.min(column.span.lo, column.span.hi));
    const hi = yFor(Math.max(column.span.lo, column.span.hi));
    shapes.push({
      kind: "rect",
      x: plot.x + i * step,
      y: lo,
      // A day whose low and high are the same still has to be visible.
      height: Math.max(hi - lo, 0.5),
      width,
      tone,
    });
  });
  return shapes;
}

/**
 * A dashed reference line across a plot — an average, or a budget.
 *
 * Deliberately **unlabelled**. A caption hung on the right-hand end of it
 * lands on top of whatever the last few days did, which is exactly where the
 * eye is; the site puts the same thing in a key under the plot and so does
 * `legendRow` below.
 */
function referenceLine(
  plot: RectMm,
  value: number,
  scale: { min: number; max: number },
  tone: Tone = "muted",
): ChartShape[] {
  const span = scale.max - scale.min || 1;
  const y = plot.y + ((value - scale.min) / span) * plot.height;
  return [
    { kind: "line", x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y, tone, widthMm: 0.25, dashMm: 1.2 },
  ];
}

/**
 * The key for whatever the plot drew that is not the data — one short row
 * under the axis, each entry preceded by the mark it names.
 *
 * Under rather than beside, and a dash rather than a block where the line was
 * dashed, so a reader matches it to the plot without being told which is
 * which.
 */
function legendRow(
  box: RectMm,
  y: number,
  items: { text: string; tone: Tone; dashed?: boolean }[],
  type: TypeScale,
): ChartShape[] {
  const shapes: ChartShape[] = [];
  let x = box.x;
  for (const item of items) {
    if (item.dashed) {
      shapes.push({
        kind: "line",
        x1: x,
        y1: y + 0.8,
        x2: x + 5,
        y2: y + 0.8,
        tone: item.tone,
        widthMm: 0.35,
        dashMm: 1.2,
      });
    } else {
      shapes.push({ kind: "rect", x, y: y + 0.2, width: 5, height: 1.4, tone: item.tone });
    }
    x += 7;
    shapes.push(label(x, y, item.text, type.caption, "muted"));
    x += ptToMm(measure(item.text, type.caption)) + 8;
  }
  return shapes;
}

/**
 * A single-series area with its line on top — the site's `CumulativeArea`.
 *
 * One hue, no legend, because there is one quantity. `reference` is drawn
 * behind it as a dashed line on the same scale; a budget shown on its own
 * scale would make being under budget look like being over it.
 */
function areaSeries(
  plot: RectMm,
  values: number[],
  scale: { min: number; max: number },
  reference?: number[],
): ChartShape[] {
  if (values.length === 0) return [];
  const span = scale.max - scale.min || 1;
  const xFor = (i: number) =>
    plot.x + (values.length === 1 ? plot.width / 2 : (i / (values.length - 1)) * plot.width);
  const yFor = (v: number) => plot.y + ((v - scale.min) / span) * plot.height;
  const points = values.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
  const shapes: ChartShape[] = [
    { kind: "area", points, baselineY: plot.y, tone: "tint4" },
  ];
  if (reference && reference.length === values.length) {
    shapes.push({
      kind: "polyline",
      points: reference.map((v, i) => ({ x: xFor(i), y: yFor(v) })),
      tone: "muted",
      widthMm: 0.35,
      dashMm: 1.4,
    });
  }
  shapes.push({ kind: "polyline", points, tone: "accent", widthMm: 0.6 });
  return shapes;
}

/** Faint horizontal rules behind a plot, at quarters. Structure, not decoration. */
function gridLines(plot: RectMm, divisions = 4): ChartShape[] {
  const shapes: ChartShape[] = [];
  for (let i = 1; i <= divisions; i += 1) {
    const y = plot.y + (i / divisions) * plot.height;
    shapes.push({
      kind: "line",
      x1: plot.x,
      y1: y,
      x2: plot.x + plot.width,
      y2: y,
      tone: "rule",
      widthMm: 0.15,
    });
  }
  return shapes;
}

/**
 * A heading with the accent rule under it, as every other page in the book
 * sets one. Returns the y the page's first element starts at.
 */
function pageHeading(
  box: RectMm,
  heading: string,
  type: TypeScale,
): { shapes: ChartShape[]; y: number } {
  const y = box.y + box.height - 6;
  return {
    shapes: [
      label(box.x, y, eyebrowText(heading), type.caption, "muted"),
      {
        kind: "line",
        x1: box.x,
        y1: y - 6,
        x2: box.x + Math.min(box.width, 40),
        y2: y - 6,
        tone: "accent",
        widthMm: 0.6,
      },
    ],
    y: y - 6,
  };
}

/** A small caps label introducing a panel within a page. */
function panelLabel(box: RectMm, y: number, text: string, type: TypeScale): ChartShape[] {
  return [label(box.x, y, eyebrowText(text), type.caption, "muted")];
}

/** The two dates under a plot that runs across the whole trip. */
function axisDates(plot: RectMm, y: number, first: string, last: string, type: TypeScale): ChartShape[] {
  return [
    label(plot.x, y, first, type.caption, "muted", "italic"),
    labelRight(plot.x + plot.width, y, last, type.caption, "muted", "italic"),
  ];
}

/**
 * A round number at or above `value`, for an axis nobody wants to read.
 *
 * 1, 2 or 5 times a power of ten, which is the interval a person would have
 * chosen. Kept here rather than in either renderer for the reason the whole
 * module exists.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------

export type TransportMode = { mode: string; label: string; days: number };

/**
 * *How we got about* — B565.
 *
 * It was a column of numbers and a sentence: "3 days driving", hung off the
 * middle of an otherwise empty page. A number on its own says nothing about
 * proportion, which is the only interesting thing here — a trip that flew once
 * and drove for eighteen days is a different trip from one that did both nine
 * times, and the two printed identically apart from the digits.
 *
 * So the number keeps its size, and gains a bar underneath at its share of the
 * most-used mode. The block is set from a little above the middle, as it was:
 * the page carries a handful of rows, and hung from the head it reads as a
 * page somebody forgot to finish.
 */
export function transportShapes(
  box: RectMm,
  heading: string,
  modes: TransportMode[],
  note: string | undefined,
  type: TypeScale,
): ChartShape[] {
  const rowMm = ptToMm(type.display) + 9;
  const blockMm = 14 + modes.length * rowMm + (note ? 8 : 0);
  // Optically centred — a shade above true centre, which is where a block of
  // type wants to sit on a page — and never above the top of the content box.
  let y = Math.min(box.y + box.height * 0.48 + blockMm / 2, box.y + box.height - 8);
  const shapes: ChartShape[] = [label(box.x, y, eyebrowText(heading), type.caption, "muted")];
  y -= 14;

  const most = Math.max(...modes.map((m) => m.days), 1);
  for (const mode of modes) {
    shapes.push(label(box.x, y, String(mode.days), type.display, "accent", "bold"));
    const numberWidth = ptToMm(measure(String(mode.days), type.display, "bold"));
    shapes.push(label(box.x + numberWidth + 3, y, mode.label, type.subheading, "ink"));
    const barY = y - 5;
    shapes.push({ kind: "rect", x: box.x, y: barY, width: box.width, height: 1.2, tone: "track" });
    shapes.push({
      kind: "rect",
      x: box.x,
      y: barY,
      width: (mode.days / most) * box.width,
      height: 1.2,
      tone: "tint0",
    });
    y -= rowMm;
  }

  if (note) {
    y += 3;
    shapes.push({
      kind: "line",
      x1: box.x,
      y1: y + 5,
      x2: box.x + Math.min(box.width, 30),
      y2: y + 5,
      tone: "rule",
      widthMm: 0.4,
    });
    shapes.push(label(box.x, y, note, type.caption, "muted", "italic"));
  }
  return shapes;
}

export type CostsInput = {
  baseCurrency: string;
  total: number;
  preparation: number;
  onTheRoad: number;
  perDay: number;
  byCategory: { category: string; amount: number }[];
  byCountry: { country: string; amount: number; nights: number }[];
  budget?: { total: number; days: number };
};

export type CostsLabels = {
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

/**
 * *What it cost* — B565.
 *
 * It was a six-row table with a total over it. The money is the same money;
 * what changed is that the page now answers the question a reader actually
 * has — what did it mostly go on, and how did that compare with the plan —
 * before they have read a single figure.
 *
 * Three things, in order of how much anybody cares: the total, where it went,
 * and how that sat against the budget. The per-country breakdown comes last
 * and is dropped rather than crushed when the page runs out of room, which is
 * what the y-guards below are.
 */
export function costsShapes(
  box: RectMm,
  heading: string,
  costs: CostsInput,
  labels: CostsLabels,
  money: (n: number) => string,
  type: TypeScale,
): ChartShape[] {
  const head = pageHeading(box, heading, type);
  const shapes = [...head.shapes];
  let y = head.y - 16;

  shapes.push(label(box.x, y, money(costs.total), type.display, "ink", "bold"));
  y -= 7;
  shapes.push(label(box.x, y, labels.total, type.caption, "muted", "italic"));
  y -= 16;

  /**
   * Three figures across the page rather than three rows of a table.
   *
   * The same numbers, and a shape a reader takes in at a glance instead of
   * scanning a rule-separated list of right-aligned amounts. A label above its
   * own figure also stops being a caption to the row above it, which is what a
   * two-column table of four rows starts to look like at this size.
   */
  const stats: [string, number][] = [
    [labels.before, costs.preparation],
    [labels.onRoad, costs.onTheRoad],
    [labels.perDay, costs.perDay],
  ];
  const columnWidth = box.width / stats.length;
  stats.forEach(([text, value], i) => {
    const x = box.x + i * columnWidth;
    shapes.push(label(x, y, text, type.caption, "muted"));
    shapes.push(label(x, y - ptToMm(type.subheading) - 1.5, money(value), type.subheading, "ink", "bold"));
  });
  y -= ptToMm(type.subheading) + 12;
  shapes.push({
    kind: "line",
    x1: box.x,
    y1: y,
    x2: box.x + box.width,
    y2: y,
    tone: "rule",
    widthMm: 0.3,
  });
  y -= 12;

  if (costs.byCategory.length > 0) {
    shapes.push(...panelLabel(box, y, labels.where, type));
    y -= 10;

    /**
     * One bar, divided in proportion, rather than a column of numbers. A
     * reader wants to know what the money mostly went on, and a stacked bar
     * answers that immediately. Drawn from rectangles because the PDF writer
     * has rectangles; a pie is harder to read than a bar anyway.
     */
    const shown = costs.byCategory.slice(0, 6);
    const sum = shown.reduce((n, r) => n + r.amount, 0);
    const barMm = 8;
    // A hairline of paper between segments, the site's 2px surface gap.
    const gapMm = 0.5;
    let x = box.x;
    shown.forEach((row, i) => {
      const w = sum > 0 ? (row.amount / sum) * box.width : 0;
      shapes.push({
        kind: "rect",
        x,
        y: y - barMm,
        width: Math.max(w - gapMm, 0),
        height: barMm,
        tone: tintTone(i),
      });
      x += w;
    });
    y -= barMm + 9;

    // The key, two to a row, in the order of the bar. Direct labels rather
    // than a legend somewhere else on the page.
    const half = Math.ceil(shown.length / 2);
    const rowMm = 6;
    shown.forEach((row, i) => {
      const column = i < half ? 0 : 1;
      const rowY = y - (i % half) * rowMm;
      const x0 = box.x + column * (box.width / 2);
      shapes.push({
        kind: "rect",
        x: x0,
        y: rowY - 0.3,
        width: 2.6,
        height: 2.6,
        tone: tintTone(i),
      });
      shapes.push(label(x0 + 4.5, rowY, row.category, type.caption, "ink"));
      shapes.push(
        labelRight(
          x0 + box.width / 2 - (column === 0 ? 6 : 0),
          rowY,
          money(row.amount),
          type.caption,
          "muted",
        ),
      );
    });
    y -= half * rowMm + 7;
  }

  // Budgeted against spent, on one scale — the only honest way to show one
  // number against another. A percentage alone hides which way round they are.
  if (costs.budget && costs.budget.total > 0 && y > box.y + 34) {
    shapes.push(...panelLabel(box, y, labels.budgetVsActual, type));
    y -= 10;
    const rows: BarRow[] = [
      { label: labels.budgeted, valueText: money(costs.budget.total), value: costs.budget.total, tone: "tint4" },
      { label: labels.spent, valueText: money(costs.total), value: costs.total, tone: "tint0" },
    ];
    const bars = barRows(box, y, rows, type, {
      barMm: 3.5,
      gapMm: 5,
      scaleTo: Math.max(costs.budget.total, costs.total),
    });
    shapes.push(...bars.shapes);
    y = bars.y - 6;
  }

  if (costs.byCountry.length > 0 && y > box.y + 18) {
    shapes.push(...panelLabel(box, y, labels.byCountry, type));
    y -= 9;
    // As many as fit, largest first, rather than a fixed five squeezed in.
    const room = Math.max(Math.floor((y - box.y - 2) / 8.5), 0);
    const rows: BarRow[] = costs.byCountry.slice(0, Math.min(room, 5)).map((row) => ({
      label: `${row.country} — ${row.nights} ${labels.nights}`,
      valueText: money(row.amount),
      value: row.amount,
      tone: "tint3",
    }));
    shapes.push(...barRows(box, y, rows, type, { barMm: 2.4, gapMm: 4.5 }).shapes);
  }

  return shapes;
}

export type SpendPanel = {
  heading: string;
  /** One entry per day of the trip, in order. */
  byDay: { date: string; amount: number; cumulative: number }[];
  /** The first and last dates, already written the way the book writes a
   * date. Formatting is the planner's — this module draws. */
  firstLabel: string;
  lastLabel: string;
  /** Planned cumulative spend, same length as `byDay`, when there is a budget. */
  budgetCurve?: number[];
  budgetLabel: string;
  cumulativeLabel: string;
  dailyLabel: string;
  averageLabel: string;
};

export type WeatherPanel = {
  heading: string;
  firstLabel: string;
  lastLabel: string;
  /** Every day of the trip in order — a day with no reading has no values,
   * and that is what puts the gap in the chart. Never filled in. */
  byDay: { date: string; tempMin?: number; tempMax?: number; precipitation?: number }[];
  avgHigh?: number;
  avgLow?: number;
  highLowLabel: string;
  rainLabel: string;
  avgHighLabel: string;
  avgLowLabel: string;
  /** "12 days had no reading", already in the book's language and already
   * counted by `summariseWeather`. */
  missingNote?: string;
  /** "Measured by Open-Meteo" — a licence condition, not a courtesy. */
  credit?: string;
};

/**
 * The spend spread — cumulative against the budget, then the daily rhythm.
 *
 * Two plots on one axis: the top one is the story (did we hold to the plan),
 * the bottom one is the texture (which days were the expensive ones). Neither
 * is a table, and together they are the page a book of photographs can carry.
 */
export function spendPageShapes(box: RectMm, panel: SpendPanel, money: (n: number) => string, type: TypeScale): ChartShape[] {
  const head = pageHeading(box, panel.heading, type);
  const shapes = [...head.shapes];
  let y = head.y - 16;
  if (panel.byDay.length === 0) return shapes;

  // --- cumulative, with the budget behind it
  shapes.push(...panelLabel(box, y, panel.cumulativeLabel, type));
  y -= 8;
  const areaPlot: RectMm = { x: box.x, y: y - box.height * 0.32, width: box.width, height: box.height * 0.32 };
  const cumulativeMax = niceMax(
    Math.max(...panel.byDay.map((d) => d.cumulative), ...(panel.budgetCurve ?? [0])),
  );
  shapes.push(...gridLines(areaPlot));
  shapes.push(
    ...areaSeries(
      areaPlot,
      panel.byDay.map((d) => d.cumulative),
      { min: 0, max: cumulativeMax },
      panel.budgetCurve,
    ),
  );
  shapes.push(
    labelRight(
      box.x + box.width,
      areaPlot.y + areaPlot.height + 2,
      money(panel.byDay[panel.byDay.length - 1].cumulative),
      type.caption,
      "ink",
      "bold",
    ),
  );
  y = areaPlot.y - 5;
  shapes.push(...axisDates(areaPlot, y, panel.firstLabel, panel.lastLabel, type));
  if (panel.budgetCurve) {
    y -= 6;
    shapes.push(...legendRow(box, y, [{ text: panel.budgetLabel, tone: "muted", dashed: true }], type));
  }
  y -= 18;

  // --- what each day cost
  shapes.push(...panelLabel(box, y, panel.dailyLabel, type));
  y -= 8;
  const columnPlot: RectMm = { x: box.x, y: y - box.height * 0.2, width: box.width, height: box.height * 0.2 };
  const spent = panel.byDay.filter((d) => d.amount > 0);
  const average = spent.length > 0 ? spent.reduce((n, d) => n + d.amount, 0) / spent.length : 0;
  const dailyMax = niceMax(Math.max(...panel.byDay.map((d) => d.amount), average));
  shapes.push(
    ...columns(
      columnPlot,
      panel.byDay.map((d) => ({ span: d.amount > 0 ? { lo: 0, hi: d.amount } : undefined })),
      { min: 0, max: dailyMax },
    ),
  );
  if (average > 0) shapes.push(...referenceLine(columnPlot, average, { min: 0, max: dailyMax }));
  shapes.push({
    kind: "line",
    x1: columnPlot.x,
    y1: columnPlot.y,
    x2: columnPlot.x + columnPlot.width,
    y2: columnPlot.y,
    tone: "rule",
    widthMm: 0.3,
  });
  y = columnPlot.y - 5;
  shapes.push(...axisDates(columnPlot, y, panel.firstLabel, panel.lastLabel, type));
  if (average > 0) {
    y -= 6;
    shapes.push(
      ...legendRow(box, y, [{ text: `${panel.averageLabel} ${money(average)}`, tone: "muted", dashed: true }], type),
    );
  }

  return shapes;
}

/**
 * The weather spread — the daily high and low, and the rain under it.
 *
 * Every value here came out of a day's own `weatherData`, which is a measured
 * reading at that day's coordinates. **Nothing is inferred and no gap is
 * filled.** A day nobody has a reading for draws no column, so the run of
 * missing days is visible as itself; the note under the chart says how many
 * there were, and the credit names the archive, because attribution is a
 * licence condition wherever a reading is drawn.
 */
export function weatherPageShapes(box: RectMm, panel: WeatherPanel, type: TypeScale): ChartShape[] {
  const head = pageHeading(box, panel.heading, type);
  const shapes = [...head.shapes];
  let y = head.y - 16;
  const days = panel.byDay;
  if (days.length === 0) return shapes;

  const temps = days.flatMap((d) => [d.tempMin, d.tempMax].filter((v): v is number => v !== undefined));
  if (temps.length > 0) {
    shapes.push(...panelLabel(box, y, panel.highLowLabel, type));
    y -= 10;
    const plot: RectMm = { x: box.x, y: y - box.height * 0.36, width: box.width, height: box.height * 0.36 };
    // Rounded outward to whole fives so the axis is a number somebody would
    // have chosen, and so no column is clipped by the frame.
    const lo = Math.floor(Math.min(...temps) / 5) * 5;
    const high = Math.ceil(Math.max(...temps) / 5) * 5;
    const scale = { min: lo, max: high === lo ? lo + 5 : high };
    shapes.push(...gridLines(plot, 3));
    shapes.push(
      ...columns(
        plot,
        days.map((d) => ({
          span:
            d.tempMin !== undefined || d.tempMax !== undefined
              ? { lo: d.tempMin ?? d.tempMax!, hi: d.tempMax ?? d.tempMin! }
              : undefined,
        })),
        scale,
        "tint1",
      ),
    );
    if (panel.avgHigh !== undefined) shapes.push(...referenceLine(plot, panel.avgHigh, scale));
    if (panel.avgLow !== undefined) shapes.push(...referenceLine(plot, panel.avgLow, scale));
    // The two ends of the scale, once, at the left — cheaper than a tick per
    // line, and it keeps the plot free of numbers nobody reads.
    shapes.push(label(box.x, plot.y + plot.height + 2, `${scale.max}\u00b0`, type.caption, "muted"));
    shapes.push(label(box.x, plot.y - 5, `${scale.min}\u00b0`, type.caption, "muted"));
    y = plot.y - 10;
    shapes.push(...axisDates(plot, y, panel.firstLabel, panel.lastLabel, type));
    y -= 6;
    shapes.push(
      ...legendRow(
        box,
        y,
        [
          ...(panel.avgHigh !== undefined
            ? [{ text: `${panel.avgHighLabel} ${panel.avgHigh}\u00b0`, tone: "muted" as Tone, dashed: true }]
            : []),
          ...(panel.avgLow !== undefined
            ? [{ text: `${panel.avgLowLabel} ${panel.avgLow}\u00b0`, tone: "muted" as Tone, dashed: true }]
            : []),
        ],
        type,
      ),
    );
    y -= 18;
  }

  const rain = days.filter((d) => d.precipitation !== undefined);
  if (rain.length > 0) {
    shapes.push(...panelLabel(box, y, panel.rainLabel, type));
    y -= 10;
    const plot: RectMm = { x: box.x, y: y - box.height * 0.14, width: box.width, height: box.height * 0.14 };
    const max = niceMax(Math.max(...rain.map((d) => d.precipitation ?? 0), 1));
    shapes.push(
      ...columns(
        plot,
        // A dry day that *was* measured is a zero and draws nothing visible;
        // a day nobody measured is undefined and draws nothing at all. The
        // difference is the whole rule, and the baseline below is what makes
        // the first of them still read as a day rather than as a hole.
        days.map((d) => ({
          span: d.precipitation !== undefined && d.precipitation > 0 ? { lo: 0, hi: d.precipitation } : undefined,
        })),
        { min: 0, max },
        "accent",
      ),
    );
    shapes.push({
      kind: "line",
      x1: plot.x,
      y1: plot.y,
      x2: plot.x + plot.width,
      y2: plot.y,
      tone: "rule",
      widthMm: 0.3,
    });
    shapes.push(labelRight(plot.x + plot.width, plot.y + plot.height + 2, `${max} mm`, type.caption, "muted"));
    y = plot.y - 10;
  }

  // What is not on the chart, said in words: the days nobody measured, and
  // who measured the rest. Set at the foot of the page, where a credit goes.
  const notes = [panel.missingNote, panel.credit].filter(Boolean) as string[];
  if (notes.length > 0) {
    // At the foot, where a credit belongs, rather than trailing whatever the
    // last plot happened to leave — a page that ends in a colophon line reads
    // as finished, and this one is a licence condition besides.
    let ny = box.y + 2 + (notes.length - 1) * 5.5;
    shapes.push({
      kind: "line",
      x1: box.x,
      y1: ny + 6,
      x2: box.x + Math.min(box.width, 30),
      y2: ny + 6,
      tone: "rule",
      widthMm: 0.4,
    });
    for (const line of notes) {
      shapes.push(label(box.x, ny, line, type.caption, "muted", "italic"));
      ny -= 5.5;
    }
  }

  return shapes;
}
