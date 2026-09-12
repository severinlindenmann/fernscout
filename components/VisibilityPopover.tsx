"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The card the visibility badge and its `?` open — B1591.
 *
 * It exists because both of them used to open *into the flow*: the `?` was a
 * `<details>` and the chooser replaced the badge, so pressing either shoved the
 * page down — on a trip that meant the date, the byline and everything under
 * them dropping about 220px, and losing the place you were reading.
 *
 * **Portalled to `document.body`, and that is not defensive.** Three separate
 * things make an in-place panel wrong here, and each of them alone would be
 * enough:
 *
 * - `StoryPager` wraps every day in a `motion.div` that animates `y`. A
 *   transform on an ancestor makes it the containing block for `position:
 *   fixed`, so a sheet pinned to the bottom of the viewport would pin itself
 *   to the middle of the card instead — and only while the animation runs,
 *   which is the worst kind of intermittent.
 * - The day's badge sits inside an `<h2>` and the journal's inside a
 *   `<summary>`. Both are phrasing content: a `<div>` in there is invalid, and
 *   inside a `<p>` the parser closes the paragraph early and the panel lands
 *   outside its own anchor, where nothing can open it. That happened twice
 *   while this was being designed.
 * - An ancestor with `overflow: hidden` clips an absolutely positioned child
 *   and nothing says so.
 *
 * A portal answers all three at once, and the trigger stays a plain `<button>`
 * — valid anywhere phrasing content is allowed.
 *
 * **Two shapes, one content.** At `sm` and up it is a card anchored under its
 * trigger, clamped to the viewport so it cannot run off the right edge. Below
 * that it slides up from the bottom as a sheet, because at 390px a card
 * anchored to a badge on the right has nowhere to be. The author chose the
 * sheet over edge-flipping.
 */

/** Tailwind's `sm`. Read once per placement rather than tracked as state — the
 *  only moments the answer can change are the ones that re-place it anyway. */
const WIDE = 640;
const CARD = 320;
const GAP = 8;

export default function VisibilityPopover({
  open,
  anchor,
  label,
  onClose,
  children,
}: {
  open: boolean;
  /** The button this belongs to — its rect is where the card is put, and a
   *  click inside it must not count as a click outside. */
  anchor: React.RefObject<HTMLElement | null>;
  /** Names the card for a screen reader — the trigger's own label. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [wide, setWide] = useState(true);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const isWide = window.innerWidth >= WIDE;
      setWide(isWide);
      const box = anchor.current?.getBoundingClientRect();
      if (!box || !isWide) return setAt(null);
      setAt({
        top: box.bottom + GAP,
        // Clamped rather than flipped: a card that would run off the right
        // edge slides left until it fits, which keeps its arrow roughly under
        // the badge and needs no second layout pass.
        left: Math.min(Math.max(GAP, box.left), window.innerWidth - CARD - GAP),
      });
    };
    place();
    // `true` — a scroll inside any scrolling ancestor moves the anchor, and
    // those events do not bubble.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    // `mousedown`, not `click`: a press that starts outside and releases inside
    // should still close, and this fires before the trigger's own click would
    // toggle it back open.
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, anchor]);

  // No mounted-yet guard, and none is needed: `open` only becomes true from a
  // press, so the server always leaves here before `document` is touched.
  if (!open) return null;

  const card = (
    <>
      {/* The sheet dims what is behind it; the anchored card does not, because
          it is small, attached to the thing it came from, and dimming a whole
          desktop page for a three-line question is a modal pretending. */}
      {!wide && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-[60] bg-navy-900/25 motion-safe:animate-[fadeIn_.15s_ease]"
        />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        style={wide && at ? { top: at.top, left: at.left, width: CARD } : undefined}
        className={
          wide
            ? "fixed z-[61] rounded-2xl border border-navy-200 bg-white p-3.5 text-left shadow-[0_12px_32px_-8px_rgba(30,41,59,0.28),0_2px_6px_rgba(30,41,59,0.08)]"
            : // The sheet: full width, its own rounded top, and capped so a long
              // card scrolls inside itself rather than running off the screen.
              "fixed inset-x-0 bottom-0 z-[61] max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-navy-200 bg-white p-4 pb-6 text-left shadow-[0_-8px_32px_-8px_rgba(30,41,59,0.3)]"
        }
      >
        {!wide && (
          <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-navy-200" />
        )}
        {children}
      </div>
    </>
  );

  return createPortal(card, document.body);
}
