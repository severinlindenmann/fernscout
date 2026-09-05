import { HEAD_WIDTH_RATIO, figureHeight } from "./render";
import { AGE_SCALE, type Figure } from "./vocabulary";

/**
 * Where each traveller stands.
 *
 * A party is a composition, not a row. Evenly spaced figures on one line read
 * as a police line-up; people standing together overlap at the shoulders and
 * some of them are further back. Both halves of that are here.
 *
 * Everything is **derived from the figure's index**, never from a random
 * number. The hero, the preview endpoint and the photobook all have to agree
 * about where a family stood, and a layout that reshuffles on refresh is a bug
 * that looks like a feature for about a day.
 */

/** The front rank stands this much nearer: lower on the ground, and larger. */
const FRONT_SCALE = 1.06;
const BACK_SCALE = 0.94;
const DROP_RATIO = 0.07;

/**
 * How close two figures may stand, as a fraction of a figure's width.
 *
 * **This floor is geometry, not taste.** A head spans half a figure
 * (`HEAD_WIDTH_RATIO`), so two figures closer than 0.5 have their heads
 * touching and one is drawn squarely over another — which reads as a
 * rendering fault rather than as depth. 0.62 leaves a clear sliver between
 * every pair of heads at every party size up to `MAX_FIGURES`, with the front
 * rank's 6% enlargement already counted in.
 *
 * Bodies may cross. Heads may not. `test/travellers-layout.test.ts` asserts
 * exactly that, at every size, because it is the kind of invariant that dies
 * quietly the first time somebody tightens the spacing by eye.
 */
export const MIN_STEP = 0.62;

/** The step closes as the party grows, and goes below a figure's width. */
export function stepFraction(count: number): number {
  const wanted =
    count <= 2 ? 1.0 : count <= 3 ? 0.86 : count <= 4 ? 0.74 : count <= 5 ? 0.68 : 0.64;
  return Math.max(MIN_STEP, wanted);
}

const isYoung = (f: Figure) => f.age === "child" || f.age === "teen";

/**
 * Which figures stand in front, by index.
 *
 * Children and teenagers, always and at any party size: `AGE_SCALE` makes them
 * shorter, so behind an adult they are simply gone. Two parents and two
 * children is four figures with the children in front, not a row of four.
 *
 * With no children, four or more alternate — five friends stand some in front
 * and some behind. One to three adults stay a single row, because a couple
 * side by side should not be staggered into a tableau.
 */
export function frontRank(figures: Figure[]): boolean[] {
  if (figures.some(isYoung)) return figures.map(isYoung);
  if (figures.length >= 4) return figures.map((_, i) => i % 2 === 1);
  return figures.map(() => false);
}

export type Placement = {
  /** Index into the original `figures` array. */
  index: number;
  figure: Figure;
  front: boolean;
  /** Left edge, in the same units as `width`. */
  x: number;
  /** How far the feet sit above the composition's baseline. */
  bottom: number;
  /** Depth scale, on top of whatever `age` already did. */
  scale: number;
  /** Seconds to delay this figure's gait, so a group never bobs in lockstep. */
  delay: number;
};

export type Arrangement = {
  placements: Placement[];
  width: number;
  height: number;
  /** The width each figure is drawn at. */
  figureWidth: number;
};

/**
 * Lay out a party at a given figure width.
 *
 * **Every figure gets its own column, and depth alternates along the line.**
 * The obvious implementation is to centre each rank and nudge the front one
 * half a step into the gaps, and it is wrong in a way that only appears at
 * particular counts: with two behind and three in front, both ranks land on
 * exactly the same x and the adults disappear entirely behind the children.
 * Interleaving one sequence from the longer rank instead keeps the children
 * *among* the adults — which is what a family standing together looks like —
 * and makes "nobody is hidden" a property of the arrangement rather than
 * something to remember to check.
 */
export function arrangeParty(figures: Figure[], figureWidth: number): Arrangement {
  if (figures.length === 0) {
    return { placements: [], width: 0, height: 0, figureWidth };
  }

  const height = figureHeight(figureWidth);
  const front = frontRank(figures);
  const step = figureWidth * stepFraction(figures.length);
  const drop = Math.max(4, Math.round(height * DROP_RATIO));

  const back = figures.map((_, i) => i).filter((i) => !front[i]);
  const fore = figures.map((_, i) => i).filter((i) => front[i]);

  const [lead, other] = back.length >= fore.length ? [back, fore] : [fore, back];
  const sequence: number[] = [];
  lead.forEach((index, i) => {
    sequence.push(index);
    if (i < other.length) sequence.push(other[i]);
  });

  const x: number[] = [];
  sequence.forEach((index, column) => {
    x[index] = column * step;
  });

  // The back rank is listed first so it paints first and the front rank
  // overlaps it. Painting order is the third of the three depth cues, with
  // the drop and the scale; any one of them alone reads as a mistake.
  const placements = [...back, ...fore].map((index) => ({
    index,
    figure: figures[index],
    front: front[index],
    x: x[index],
    bottom: front[index] ? 0 : drop,
    scale: front[index] ? FRONT_SCALE : BACK_SCALE,
    delay: index * 0.23,
  }));

  return {
    placements,
    width: (sequence.length - 1) * step + figureWidth,
    height: Math.round(height * FRONT_SCALE) + drop,
    figureWidth,
  };
}

/**
 * The largest figure width whose party still fits `available`.
 *
 * Figures shrink together rather than the composition overflowing — the hero
 * on a phone is narrower than five figures at their nominal size, and the
 * alternative is a page that scrolls sideways.
 */
export function fitPartyWidth(count: number, available: number, nominal = 106): number {
  if (count <= 0) return nominal;
  const needed = (count - 1) * stepFraction(count) * nominal + nominal;
  if (needed <= available) return nominal;
  return Math.max(40, Math.floor((nominal * available) / needed));
}

/**
 * The smallest gap between any two adjacent heads, as a fraction of a figure
 * width. Positive means no head is drawn over another.
 *
 * Exported for the test that is the acceptance criterion for the overlap, and
 * kept here rather than in the test so the number and the rule that produces
 * it live together.
 */
export function tightestHeadGap(figures: Figure[], figureWidth = 106): number {
  const { placements } = arrangeParty(figures, figureWidth);
  const heads = placements
    .map((p) => {
      const scale = p.scale * AGE_SCALE[p.figure.age ?? "adult"];
      return {
        centre: p.x + figureWidth / 2,
        halfWidth: (figureWidth * HEAD_WIDTH_RATIO * scale) / 2,
      };
    })
    .sort((a, b) => a.centre - b.centre);

  let worst = Number.POSITIVE_INFINITY;
  for (let i = 1; i < heads.length; i++) {
    const gap = heads[i].centre - heads[i - 1].centre - (heads[i].halfWidth + heads[i - 1].halfWidth);
    worst = Math.min(worst, gap);
  }
  return heads.length < 2 ? Number.POSITIVE_INFINITY : worst / figureWidth;
}
