import Link from "next/link";
import { MessageSquare, Send } from "lucide-react";

/**
 * The way from a page into the room that can answer — B1007.
 *
 * It was three drawings of one door. In the owner block it was an underlined
 * link under a rule (B844, moved by B877, made a link into the room by B979);
 * on `/agent` it was another underlined link under the yellow button (B901);
 * and the draft banner said "tell your agent to publish it" while offering
 * nothing to press at all. Three weights for one intent is the drift B877
 * cleaned up inside the owner block, one level up.
 *
 * The fault in the owner block specifically was geometry rather than colour:
 * `min-h-11` on an `inline-block` gives a 44px tap target only as wide as its
 * text, so the target was real and invisible, beside tiles that are filled
 * rectangles. On a draft day the block often draws exactly one tile, so the
 * rule separated one tile from one underlined line — and separated nothing.
 *
 * So: one geometry, three tones. Full width, ≥52px, an icon plate, a line
 * that says what happens and a line that says what happens next.
 *
 * **The tone is the job, not the taste.**
 *
 * - `coral` is what is waiting to be decided. It is the draft banner's own
 *   colour, and it is drawn only while the day is not on the site — so the
 *   block gets quieter as the work finishes rather than louder.
 * - `yellow` is the general way in, under the rule, where B877 put it. The
 *   tiles above it are still the shortcuts.
 * - `quiet` is the same row where the page has already spent its one bright
 *   thing — `/agent`, whose yellow button is the day somebody came to write.
 *
 * It draws a link and never a button, because none of these three does
 * anything by itself: each opens the room where a person says what they want
 * and an agent does it. The gate is the caller's — see `OwnerTools`.
 */
export default function AgentRow({
  href,
  tone,
  title,
  hint,
}: {
  href: string;
  tone: "coral" | "yellow" | "quiet";
  title: string;
  /** The second line. Absent draws a single centred line instead. */
  hint?: string;
}) {
  const Icon = tone === "coral" ? Send : MessageSquare;
  return (
    <Link href={href} className={`${ROW[tone].row} ${ROW_BASE}`}>
      <span className={`${PLATE_BASE} ${ROW[tone].plate}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-bold leading-4 ${ROW[tone].title}`}>
          {title}
        </span>
        {hint && (
          <span className={`mt-px block text-[11px] leading-4 ${ROW[tone].hint}`}>
            {hint}
          </span>
        )}
      </span>
      <span aria-hidden className={`shrink-0 ${ROW[tone].title}`}>
        {/* A chevron rather than an arrow: this leads somewhere on the site,
            and the arrow is what the brand uses for leaving it. */}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </span>
    </Link>
  );
}

const ROW_BASE =
  "flex w-full min-h-[52px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors";

const PLATE_BASE = "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg";

const ROW = {
  coral: {
    row: "border-coral-600 bg-coral-300 hover:border-navy-900",
    plate: "bg-white text-coral-600",
    title: "text-navy-900",
    hint: "text-navy-900",
  },
  yellow: {
    row: "border-yellow-600 bg-yellow-300 hover:bg-yellow-400",
    plate: "bg-yellow-400 text-yellow-950",
    title: "text-yellow-950",
    hint: "text-yellow-950",
  },
  quiet: {
    row: "border-navy-200 bg-white hover:border-navy-500",
    plate: "bg-yellow-300 text-yellow-950",
    title: "text-navy-900",
    hint: "text-navy-600",
  },
} as const;
