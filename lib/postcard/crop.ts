import { MAX_CROP_ZOOM } from "./spec";
import type { Crop } from "./orders";

/**
 * The arithmetic behind dragging a rectangle on a postcard's photograph —
 * B627. Its own file because the drag control is a client component and this
 * is the part worth testing without a browser in the room.
 *
 * A crop is an anchor and a zoom, and it reads as a linear map from a
 * fraction of the *frame* to a fraction of the plain cover-crop:
 *
 *     c = f / zoom + x · (1 − 1 / zoom)
 *
 * per axis, which is exactly what `coverRect` draws and what CSS
 * `object-position` plus `transform-origin` shows. Dragging a rectangle is
 * then composing that map with the rectangle's own — one multiplication and
 * one addition, rather than a second geometry nobody can check against the
 * first.
 */
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export const CENTRE: Crop = { x: 0.5, y: 0.5, zoom: 1 };

/** The crop as `c = a·f + b`, one axis. */
export function view(anchor: number, zoom: number): { a: number; b: number } {
  return { a: 1 / zoom, b: anchor * (1 - 1 / zoom) };
}

/**
 * The crop that shows `[from, from + size]` of what the frame shows now —
 * one axis, all three numbers fractions of the frame.
 */
export function zoomInto(
  anchor: number,
  zoom: number,
  from: number,
  size: number,
): { anchor: number; zoom: number } {
  const { a, b } = view(anchor, zoom);
  const a2 = a * size;
  const b2 = a * from + b;
  const next = Math.min(MAX_CROP_ZOOM, 1 / a2);
  // At zoom 1 the anchor cannot be recovered from the map — every anchor
  // draws the same picture — so centre it, which is what it means.
  return next <= 1 ? { anchor: 0.5, zoom: 1 } : { anchor: clamp(b2 / (1 - 1 / next)), zoom: next };
}
