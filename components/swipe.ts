/**
 * What a horizontal drag across an open photograph meant.
 *
 * Pure, and separate from the component, because the thresholds are the whole
 * of this decision and a threshold nobody can run is a threshold nobody can
 * argue with. `components/Lightbox.tsx` calls it from `onDragEnd`; the test
 * calls it with the numbers a phone actually produces.
 *
 * Two ways to move a picture, because a reader does both (B16):
 *
 *  - **Far enough.** A deliberate drag that carries the photograph most of the
 *    way across and lets go. 60px is short enough to work with a thumb on a
 *    narrow phone and long enough that a tap that slid a little does nothing.
 *  - **Fast enough.** A flick, which is barely a drag at all — it can end
 *    twenty pixels from where it started. Velocity is what makes that a
 *    gesture rather than a twitch, so a short movement still has to be quick.
 *
 * Direction follows the finger: dragging the picture to the right pulls the
 * previous one in from the left, which is how every photo viewer on a phone
 * behaves. When a long drag ends in a flick the other way, velocity wins — it
 * is the more recent statement of what the reader wanted.
 */

/** A drag this long is a swipe however slowly it happened. */
export const SWIPE_DISTANCE = 60;

/** Pixels per second at which a short drag counts as a flick. */
export const SWIPE_VELOCITY = 400;

/** Below this, nothing is a gesture — it is a tap that moved. */
export const SWIPE_MIN_DISTANCE = 16;

export type SwipeIntent = "prev" | "next" | null;

export function swipeIntent(offsetX: number, velocityX: number): SwipeIntent {
  const flick =
    Math.abs(velocityX) >= SWIPE_VELOCITY && Math.abs(offsetX) >= SWIPE_MIN_DISTANCE
      ? Math.sign(velocityX)
      : 0;
  const drag = Math.abs(offsetX) >= SWIPE_DISTANCE ? Math.sign(offsetX) : 0;
  const direction = flick || drag;
  if (direction === 0) return null;
  return direction > 0 ? "prev" : "next";
}
