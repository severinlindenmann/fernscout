/**
 * What describing a day's photographs costs — B687.
 *
 * Pure and client-safe (no `server-only`): the wizard has to say the price on
 * the button *before* the tap, from the photo count it already has, and the
 * route that actually spends has to compute the identical number. One
 * function, so the two cannot drift into charging a different price than the
 * one shown.
 */

/** One credit buys a caption for this many photographs, rounding up — never a
 *  fractional spend (`lib/credits.ts` throws on one). */
const PHOTOS_PER_CREDIT = 10;

/** Zero photographs cost zero credits; the route refuses the call outright
 *  before it would ever compute this. */
export function creditsForPhotos(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / PHOTOS_PER_CREDIT);
}
