"use client";

import { useCallback, useEffect, useRef } from "react";
import { animate, useMotionValue, type MotionValue } from "motion/react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * The drag-and-snap decision every bottom sheet in this app shares — B2327's
 * single close gesture on `MobileDaySheet`, generalised to any number of
 * snap points for the map page's three-point sheet (B2427,
 * docs/plans/map-redesign.md §3 Phase 2 item 2). One shared implementation
 * rather than two: `MobileDaySheet` calls `nearestSnapIndex` for its own
 * open/closed decision (see the comment there), and `components/map/
 * MobileMapSheet.tsx` drives its full peek/half/full drag through
 * `useSnapDrag`.
 */

/** A drag faster than this (px/s) always wins over position — a flick, not a
 * settle. 500 is `MobileDaySheet`'s original close-fling speed (B2327). */
const FLING_VELOCITY = 500;

/**
 * Which snap a drag settles on.
 *
 * Position alone decides it, against a per-boundary threshold — the
 * fraction of the gap between two adjacent snaps, measured from the lower
 * one, where the boundary between them sits. Defaulting every boundary to
 * 0.5 (the midpoint) is "settle on whichever snap you ended up closer to".
 * `MobileDaySheet`'s own two-point sheet passes `[0.75]`: dragged past a
 * quarter of the panel's height used to close it, a lower bar than a plain
 * midpoint would give, and this reproduces that exactly (heights `[0,
 * fullHeight]`, boundary at `0.75 * fullHeight` — the same as "offset past
 * 25%").
 *
 * A fast-enough drag (`FLING_VELOCITY`) skips the position check entirely
 * and always moves exactly one snap in the direction thrown, clamped to the
 * ends — also matching the original: a fast downward fling always closed,
 * regardless of how far the sheet had actually moved.
 */
export function nearestSnapIndex(
  heights: readonly number[],
  draggedHeight: number,
  velocity: number,
  startIndex: number,
  thresholds?: readonly number[],
): number {
  const last = heights.length - 1;
  if (Math.abs(velocity) > FLING_VELOCITY) {
    const dir = velocity > 0 ? -1 : 1; // positive velocity: finger moving down, sheet shrinking
    return Math.min(last, Math.max(0, startIndex + dir));
  }
  for (let i = 0; i < last; i++) {
    const frac = thresholds?.[i] ?? 0.5;
    const boundary = heights[i] + (heights[i + 1] - heights[i]) * frac;
    if (draggedHeight <= boundary) return i;
  }
  return last;
}

export interface UseSnapDragOptions {
  /** Pixel heights of each snap point, ascending — index 0 is the smallest
   * ("peek"), the last is the tallest ("full"). Recomputed by the caller
   * (typically from the viewport height) rather than measured here. */
  heights: readonly number[];
  index: number;
  onIndexChange: (index: number) => void;
  reducedMotion?: boolean | null;
  /** See `nearestSnapIndex` — per-boundary fraction, default the midpoint. */
  thresholds?: readonly number[];
}

export interface SnapDrag {
  /** The panel's live height — bind to `style.height` on the dragged panel. */
  height: MotionValue<number>;
  /** Spread onto the drag handle. */
  bind: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
  };
}

const SPRING = { type: "spring", stiffness: 420, damping: 38 } as const;

/**
 * Drives one panel's height between `heights[index]` and settles a drag on
 * whichever snap `nearestSnapIndex` picks. The caller owns `index` (so a
 * keyboard cycle or an outside change animates the same way a drag does) —
 * this hook only turns a pointer drag into an index change and animates the
 * rest of the time.
 */
export function useSnapDrag({
  heights,
  index,
  onIndexChange,
  reducedMotion,
  thresholds,
}: UseSnapDragOptions): SnapDrag {
  const height = useMotionValue(heights[index] ?? 0);
  const drag = useRef<{
    id: number;
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  // Only settles the height here when nothing is actively being dragged —
  // an in-progress drag drives `height` itself, and re-animating on top of
  // it from an `index` that hasn't changed yet would fight the finger.
  useEffect(() => {
    if (drag.current) return;
    const controls = animate(height, heights[index] ?? 0, reducedMotion ? { duration: 0 } : SPRING);
    return () => controls.stop();
  }, [index, heights, height, reducedMotion]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag.current = {
        id: e.pointerId,
        startY: e.clientY,
        startHeight: height.get(),
        lastY: e.clientY,
        lastT: performance.now(),
        velocity: 0,
      };
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      d.velocity = ((e.clientY - d.lastY) / dt) * 1000; // px/s, positive = finger moving down
      d.lastY = e.clientY;
      d.lastT = now;
      const dy = e.clientY - d.startY; // dragging down shrinks the panel
      const clamped = Math.min(heights[heights.length - 1], Math.max(heights[0], d.startHeight - dy));
      height.set(clamped);
    },
    [height, heights],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      const next = nearestSnapIndex(heights, height.get(), d.velocity, index, thresholds);
      if (next === index) {
        animate(height, heights[index], reducedMotion ? { duration: 0 } : SPRING);
      } else {
        onIndexChange(next);
      }
    },
    [height, heights, index, onIndexChange, reducedMotion, thresholds],
  );

  return {
    height,
    bind: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
