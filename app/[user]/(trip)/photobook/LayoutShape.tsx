import type { DayLayout } from "@/lib/photobook/options";

/**
 * What each arrangement looks like, as a drawing — B703.
 *
 * "Raster", "Paar", "Held" are words for something visual, and the only way
 * to find out what one meant was to pick it and watch the whole book re-plan.
 * These are shown *beside the name*, always, rather than on hover: a phone
 * cannot hover, and the information is the point rather than a flourish.
 *
 * Deliberately schematic, and deliberately not the day's own photographs. It
 * is a picture of the *shape* — how many frames, how big, where the words go
 * — which is the question the picker is asking. A thumbnail of the real day
 * would answer a different one and would change every time a photograph moved.
 *
 * The viewBox is one square page, `SIDE` wide, in the same 21x21 proportion
 * `BOOK_SIZES.square` prints at. Frames are `currentColor` at low opacity;
 * text is a stack of rules at a lower one, so the two read as different
 * things at 28px without needing a second colour.
 */
const SIDE = 24;
const PAD = 3;

/** A frame, in the page's own units. */
type Frame = { x: number; y: number; w: number; h: number };

/** Frames per layout, plus how many lines of prose the shape shows. */
const SHAPES: Record<DayLayout, { frames: Frame[]; lines: number }> = {
  // The planner deciding: one big and two small, the mixed rhythm `auto`
  // actually produces rather than a question mark.
  auto: {
    frames: [
      { x: PAD, y: PAD, w: SIDE - PAD * 2, h: 10 },
      { x: PAD, y: 15, w: 8, h: 6 },
      { x: 13, y: 15, w: 8, h: 6 },
    ],
    lines: 0,
  },
  // Full bleed: no margin at all, which is the whole of what a hero is.
  hero: { frames: [{ x: 0, y: 0, w: SIDE, h: SIDE }], lines: 0 },
  single: { frames: [{ x: PAD, y: PAD, w: SIDE - PAD * 2, h: 12 }], lines: 3 },
  pair: {
    frames: [
      { x: PAD, y: PAD, w: 8, h: 12 },
      { x: 13, y: PAD, w: 8, h: 12 },
    ],
    lines: 2,
  },
  grid: {
    frames: [
      { x: PAD, y: PAD, w: 8, h: 7 },
      { x: 13, y: PAD, w: 8, h: 7 },
      { x: PAD, y: 12, w: 8, h: 7 },
      { x: 13, y: 12, w: 8, h: 7 },
    ],
    lines: 0,
  },
  text: { frames: [], lines: 6 },
};

export default function LayoutShape({ layout }: { layout: DayLayout }) {
  const { frames, lines } = SHAPES[layout];
  // Under the frames, or from the top when there are none.
  const firstLine = (frames.at(-1)?.y ?? 0) + (frames.at(-1)?.h ?? 0) + (frames.length ? 3 : PAD);
  return (
    <svg
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      width="28"
      height="28"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="0" y="0" width={SIDE} height={SIDE} fill="currentColor" opacity="0.06" />
      {frames.map((f, i) => (
        <rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} fill="currentColor" opacity="0.55" />
      ))}
      {Array.from({ length: lines }, (_, i) => (
        <rect
          key={`l${i}`}
          x={PAD}
          y={firstLine + i * 2.2}
          // The last line stops short, the way a paragraph does.
          width={i === lines - 1 ? (SIDE - PAD * 2) * 0.6 : SIDE - PAD * 2}
          height="1"
          fill="currentColor"
          opacity="0.3"
        />
      ))}
    </svg>
  );
}
