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
  | "numbers"
  /** The party walking in at the foot of a chapter divider —
   * `includeFigureMarks`, B727. */
  | "figures";

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
  figures: (
    <>
      {/* A chapter divider: one word, and the pair arriving underneath it. */}
      <rect x="6" y="7" width="12" height="2.2" {...ink(0.5)} />
      <rect x="9" y="11" width="6" height="1" {...ink(0.3)} />
      {[9, 14].map((x) => (
        <g key={x}>
          <circle cx={x} cy="16" r="1.4" fill="currentColor" opacity="0.55" />
          <rect x={x - 1.4} y="18" width="2.8" height="3.4" fill="currentColor" opacity="0.55" />
        </g>
      ))}
      <rect x="6" y="21.6" width="12" height="0.6" {...ink(0.2)} />
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
 * The three formats, as books rather than as rectangles — B704, redrawn for
 * B727.
 *
 * The first version drew each format as a plain rectangle at its true
 * proportions, which is accurate and, in the owner's word, *misleading*: three
 * grey boxes of slightly different shapes next to the words "Quadratisch,
 * 21 × 21 cm" say nothing about the thing being bought. It is a printed book,
 * and at 56px a book still has all three of the parts that make it one — a
 * cover, a spine down one edge, and the block of pages showing at the other.
 *
 * The proportions are still the answer to the question, and are still true:
 * every format is drawn inside the same box, scaled by the longest edge any of
 * them has, which is also roughly how they compare in the hand.
 */
export function FormatShape({ sizeId, box = 56 }: { sizeId: string; box?: number }) {
  const size = BOOK_SIZES[sizeId] ?? BOOK_SIZES["square-210"];
  const longest = Math.max(
    ...Object.values(BOOK_SIZES).map((s) => Math.max(s.trimWidthMm, s.trimHeightMm)),
  );
  // Room for the spine and the page block, which stand outside the cover.
  const scale = box * 0.82;
  const w = (size.trimWidthMm / longest) * scale;
  const h = (size.trimHeightMm / longest) * scale;
  const spine = Math.max(w * 0.09, 2.5);
  const pages = Math.max(w * 0.06, 2);
  const x = (box - (w + spine + pages)) / 2 + spine;
  const y = (box - h) / 2;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true" className="shrink-0">
      {/* The page block, showing past the fore edge — thin rules rather than a
          solid, so it reads as paper and not as a second cover. */}
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={x + w}
          y={y + 1.5 + i * ((h - 3) / 3)}
          width={pages}
          height={Math.max((h - 3) / 3 - 1, 0.6)}
          fill="currentColor"
          opacity="0.25"
        />
      ))}
      {/* The spine, darker: it is the edge in shadow, and it is the part that
          carries the title on a real one. */}
      <rect x={x - spine} y={y} width={spine} height={h} fill="currentColor" opacity="0.5" />
      <rect x={x} y={y} width={w} height={h} fill="currentColor" opacity="0.18" />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      {/* A photograph on the cover, which is what every one of these books
          has, and the quickest way to read the drawing as a book. */}
      <rect
        x={x + w * 0.14}
        y={y + h * 0.14}
        width={w * 0.72}
        height={h * 0.5}
        fill="currentColor"
        opacity="0.45"
      />
      <rect x={x + w * 0.14} y={y + h * 0.74} width={w * 0.46} height={Math.max(h * 0.05, 1)} fill="currentColor" opacity="0.35" />
    </svg>
  );
}
