import { BOOK_SIZES } from "@/lib/photobook/spec";

/**
 * The pages a whole-book decision adds or takes away, drawn — B704.
 *
 * `LayoutShape` (B703) does this for the six arrangements *inside* a day.
 * These are the same idea one level up, for the questions the first-book flow
 * asks: what shape is the book, are there words in it, and which of the four
 * extra kinds of page does it carry. Same vocabulary deliberately — grey
 * frames for photographs, thin rules for prose, one flat wash for the page —
 * so somebody who has seen one picker recognises the other.
 *
 * Schematic, and never the trip's own photographs. "What does a chapter
 * divider look like" must have the same answer for every trip, and a real
 * spread would need the whole planner to run for each card of a picker.
 * The one screen where a real photograph *is* the question — the cover — uses
 * real photographs and none of this.
 */

/** The page every shape is drawn on, in its own units. */
const W = 24;
const H = 24;
const PAD = 3;

const ink = (opacity: number) => ({ fill: "currentColor", opacity: String(opacity) });

/** A stack of rules standing in for prose. */
function Lines({ from, count, x = PAD, width = W - PAD * 2 }: { from: number; count: number; x?: number; width?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <rect
          key={i}
          x={x}
          y={from + i * 2.2}
          // A paragraph's last line stops short; without this a text block
          // reads as a grey box rather than as writing.
          width={i === count - 1 ? width * 0.6 : width}
          height="1"
          {...ink(0.3)}
        />
      ))}
    </>
  );
}

export type BookShapeKind =
  /** A day with its prose and captions — `includeText` on. */
  | "text"
  /** The same day as photographs and a date — `includeText` off. */
  | "noText"
  /** The route spread — `includeMap`. */
  | "map"
  /** A country's divider — `includeChapters`. */
  | "chapters"
  /** The title page, with the people on it — `includeNames`. */
  | "names"
  /** A page of bars — `includeCosts` and `includeCharts`. */
  | "numbers";

const SHAPES: Record<BookShapeKind, React.ReactNode> = {
  text: (
    <>
      <rect x={PAD} y={PAD} width={W - PAD * 2} height="10" {...ink(0.55)} />
      <Lines from={16} count={4} />
    </>
  ),
  noText: (
    <>
      <rect x={PAD} y={PAD} width={W - PAD * 2} height="13" {...ink(0.55)} />
      {/* The date is all that is left, and it is deliberately still there:
          an album that cannot say when it was is worse than one with a
          heading. */}
      <rect x={PAD} y={19} width="7" height="1" {...ink(0.3)} />
    </>
  ),
  map: (
    <>
      <rect x="0" y="0" width={W} height={H} {...ink(0.1)} />
      <path d="M5 18 L10 12 L15 14 L19 7" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.6" />
      {[
        [5, 18],
        [10, 12],
        [15, 14],
        [19, 7],
      ].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r="1.1" {...ink(0.7)} />
      ))}
    </>
  ),
  chapters: (
    <>
      {/* One word, centred, on an otherwise empty page — which is what a
          divider is and why it costs a leaf. */}
      <rect x="6" y="10" width="12" height="2.4" {...ink(0.55)} />
      <rect x="9" y="14" width="6" height="1" {...ink(0.3)} />
    </>
  ),
  names: (
    <>
      <rect x={PAD} y="5" width="14" height="2.4" {...ink(0.55)} />
      <rect x={PAD} y="9" width="8" height="1" {...ink(0.3)} />
      {/* Two figures: a head and a body each, at this size. */}
      {[9, 14].map((x) => (
        <g key={x} {...ink(0.5)}>
          <circle cx={x} cy="15" r="1.4" fill="currentColor" />
          <rect x={x - 1.4} y="17" width="2.8" height="4" fill="currentColor" />
        </g>
      ))}
    </>
  ),
  numbers: (
    <>
      <rect x={PAD} y={PAD} width="10" height="2" {...ink(0.3)} />
      {[12, 9, 6].map((h, i) => (
        <rect key={i} x={PAD + i * 6} y={21 - h} width="4.5" height={h} {...ink(0.55)} />
      ))}
      <rect x={PAD} y="21" width={W - PAD * 2} height="0.6" {...ink(0.3)} />
    </>
  ),
};

export default function BookShape({ kind, size = 40 }: { kind: BookShapeKind; size?: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect x="0" y="0" width={W} height={H} fill="currentColor" opacity="0.06" />
      {SHAPES[kind]}
    </svg>
  );
}

/**
 * The three formats, drawn against each other at their true proportions —
 * B704.
 *
 * The point of the card is the *shape*, and a square and an A4 landscape
 * shown at the same box size are the one thing this picker must not do. So
 * every format is drawn inside the same 40-unit square, scaled by its own
 * longer edge, which is also roughly how they compare in the hand.
 */
export function FormatShape({ sizeId, box = 44 }: { sizeId: string; box?: number }) {
  const size = BOOK_SIZES[sizeId] ?? BOOK_SIZES["square-210"];
  const longest = Math.max(...Object.values(BOOK_SIZES).map((s) => Math.max(s.trimWidthMm, s.trimHeightMm)));
  const w = (size.trimWidthMm / longest) * box;
  const h = (size.trimHeightMm / longest) * box;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true" className="shrink-0">
      <rect
        x={(box - w) / 2}
        y={(box - h) / 2}
        width={w}
        height={h}
        fill="currentColor"
        opacity="0.12"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1"
      />
    </svg>
  );
}
