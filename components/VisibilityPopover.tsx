"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { nearestSnapIndex } from "./SnapSheet";

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

/**
 * The phone's bottom sheet — B2333. It is the day sheet's drag (B2327) on this
 * sheet: pull from the strip around the handle (the body scrolls, so nothing
 * else starts a drag), past a quarter of its height or a fast flick closes it
 * through the same `onClose` as Cancel, anything less springs back. It is its
 * own component so each open mounts a fresh offset, and so `usePresence` can
 * hold it in the tree while it slides out. `busy` makes it inert: a drag must
 * not close a sheet that is saving.
 */
function Sheet({
  label,
  busy,
  onClose,
  children,
}: {
  label: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const [present, safeToRemove] = usePresence();
  const y = useMotionValue(window.innerHeight);
  const height = useRef(window.innerHeight);
  const scrim = useTransform(() => Math.min(1, Math.max(0, 1 - y.get() / height.current)));

  useLayoutEffect(() => {
    height.current = ref.current?.offsetHeight ?? window.innerHeight;
    if (reduced) {
      y.set(0);
      return;
    }
    y.set(height.current);
    animate(y, 0, { duration: 0.32, ease: [0.32, 0.72, 0, 1] });
  }, [y, reduced]);

  useEffect(() => {
    if (present) return;
    if (reduced) return safeToRemove?.();
    const run = animate(y, height.current, {
      duration: 0.22,
      ease: "easeOut",
      onComplete: safeToRemove ?? undefined,
    });
    return () => run.stop();
  }, [present, reduced, y, safeToRemove]);

  return (
    <>
      <motion.div
        aria-hidden
        onClick={busy ? undefined : onClose}
        style={{ opacity: scrim }}
        className="fixed inset-0 z-[60] bg-overlay-strong/25"
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        style={{ y }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.4, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_e, info) => {
          const h = ref.current?.offsetHeight ?? 300;
          // Same decision and spring as MobileDaySheet: `[0, h]` is closed and
          // open, `[0.75]` is "past a quarter closes".
          if (nearestSnapIndex([0, h], h - info.offset.y, info.velocity.y, 1, [0.75]) === 0) onClose();
          else if (reduced) y.set(0);
          else animate(y, 0, { type: "spring", stiffness: 400, damping: 36 });
        }}
        // The sheet: full width, its own rounded top, and capped so a long
        // card scrolls inside itself rather than running off the screen.
        className="fixed inset-x-0 bottom-0 z-[61] max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line-quiet bg-surface-raised p-4 pb-6 text-left shadow-[0_-8px_32px_-8px_rgba(30,41,59,0.3)]"
      >
        <div
          onPointerDown={(e) => {
            if (!busy) controls.start(e);
          }}
          className="-mx-4 -mt-4 mb-1 flex h-7 touch-none justify-center pt-4"
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-surface-selected" />
        </div>
        {children}
      </motion.div>
    </>
  );
}

export default function VisibilityPopover({
  open,
  anchor,
  label,
  busy = false,
  onClose,
  children,
}: {
  open: boolean;
  /** The button this belongs to — its rect is where the card is put, and a
   *  click inside it must not count as a click outside. */
  anchor: React.RefObject<HTMLElement | null>;
  /** Names the card for a screen reader — the trigger's own label. */
  label: string;
  /** Saving: Escape, a click outside and a drag all leave the sheet open. */
  busy?: boolean;
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
      if (event.key === "Escape" && !busy) onClose();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The phone sheet has its own scrim, and its body is not `panel`.
      if (busy || !wide || panel.current?.contains(target) || anchor.current?.contains(target)) return;
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
  }, [open, onClose, anchor, busy, wide]);

  // Rendered only once it has opened, so the server never reaches `document`.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && wide && (
        // The anchored card does not dim the page: it is small, attached to
        // the thing it came from, and dimming a whole desktop page for a
        // three-line question is a modal pretending.
        <div
          key="card"
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-label={label}
          style={at ? { top: at.top, left: at.left, width: CARD } : undefined}
          className="fs-pop fixed z-[61] origin-top rounded-2xl border border-line-quiet bg-surface-raised p-3.5 text-left shadow-[0_12px_32px_-8px_rgba(30,41,59,0.28),0_2px_6px_rgba(30,41,59,0.08)]"
        >
          {children}
        </div>
      )}
      {open && !wide && (
        <Sheet key="sheet" label={label} busy={busy} onClose={onClose}>
          {children}
        </Sheet>
      )}
    </AnimatePresence>,
    document.body,
  );
}
