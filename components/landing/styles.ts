/**
 * The signed-out landing's two buttons and its mono kicker — B2506. Shared
 * with `paid/billing` (the pricing cards and `/prices`), so the page and its
 * price list draw one button, not two that drift.
 *
 * Yellow is the waymark: `navy-900` text on `yellow-400` in both themes, with
 * a navy edge so it holds on the dark ground too. Focus is blue-500, as
 * everywhere.
 */
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

export const PILL_PRIMARY =
  "inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-navy-900 " +
  "bg-yellow-400 px-6 text-[17px] font-bold text-navy-900 shadow-[0_3px_0_var(--color-navy-900)] " +
  "transition-colors hover:bg-yellow-300 " +
  FOCUS;

export const PILL_GHOST =
  "inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-ink-strong " +
  "px-6 text-[17px] font-bold text-ink-strong transition-colors hover:bg-surface-subtle " +
  FOCUS;

/** The smaller size, for the header row. */
export const PILL_SMALL = "min-h-11 px-4 text-[15px] shadow-none";

export const KICKER = "font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary";

export const TEXT_LINK =
  "font-bold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4 " + FOCUS;
