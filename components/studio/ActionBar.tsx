"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A studio page's own bottom action slot — B1992.
 *
 * The studio has no unscrollable page (no `h-screen`, no `overflow-hidden`),
 * so a phone's own scroll always reaches the true end of one — but the
 * owner asked, separately, for a page's actions to be reachable *without*
 * scrolling there. This is that: `position: sticky; bottom: 0`, rendered as
 * the last thing in a page's own content.
 *
 * Sticky rather than fixed, and that difference is the point. A `fixed`
 * element (`PushPrompt`'s own history, this same ticket) needs something
 * else to reserve room for it or it sits on top of content instead of below
 * it. A sticky element that is the last node in the flow needs nothing
 * reserved: it only pins to the viewport edge while there is still page
 * above it left to scroll past, and settles back into ordinary flow the
 * moment there is not — which is exactly "never covers content when the
 * page is short" without a special case for short pages at all.
 *
 * Measured at 390px against the studio hub and the photobook chooser before
 * writing this (see the task file): the header is `sticky top-0`, 65px
 * tall, in its own stacking context — this bar's own `bottom: 0` can never
 * collide with it, whatever a page's content does.
 *
 * From `md` up (B2076) the bar is either absent (`desktop` null — the hub,
 * whose grid holds the same actions) or a static, right-aligned row under
 * the page's column (`desktop` is that column's `md:max-w-*`): no sticking,
 * no border, no blur — just "← Studio" and the one primary where a desktop
 * owner looks for them, instead of only the header's small crumb.
 *
 * Up to three actions, each a full child — a caller keeps its own href,
 * label, icon and loudness, and this component only lays them out evenly.
 * A fourth would not fit a 44px-tall row at 390px without shrinking a tap
 * target below the minimum this repository holds everywhere else.
 *
 * `bottom` is the showcase bar's published height rather than 0 (B1996): on
 * a showcase journal that bar is fixed to the viewport edge, and this one
 * stacks above it instead of underneath.
 */
export default function ActionBar({ children, revealAfterScroll = 0, desktop = null }: {
  children: ReactNode;
  revealAfterScroll?: number;
  /** The page column's `md:max-w-*` to line the desktop row up with, or null for no row at `md`. */
  desktop?: string | null;
}) {
  // A boolean, not the raw scroll offset: the bar only cares which side of
  // the threshold the page is on, and storing the offset would re-render it
  // on every scroll frame for nothing.
  const [pastThreshold, setPastThreshold] = useState(false);
  useEffect(() => {
    if (revealAfterScroll <= 0) return;
    const update = () => setPastThreshold(window.scrollY >= revealAfterScroll);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [revealAfterScroll]);
  const hidden = revealAfterScroll > 0 && !pastThreshold;
  return (
    <div
      inert={hidden}
      aria-hidden={hidden || undefined}
      className={`sticky bottom-[var(--fs-showcase-bar,0px)] z-20 mt-6 flex items-stretch gap-2 border-t border-line-quiet
                 bg-surface-base/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3
                 backdrop-blur motion-safe:transition-transform [&>*]:min-w-0
                 ${desktop ? `md:static md:mx-auto md:mt-0 md:w-full md:justify-end md:gap-3 md:border-t-0 md:bg-transparent md:pb-8 md:backdrop-blur-none ${desktop}` : "md:hidden"}
                 ${hidden ? "translate-y-full pointer-events-none" : "translate-y-0"}`}
    >
      {children}
    </div>
  );
}
