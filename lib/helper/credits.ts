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
 *  fractional spend (`lib/credits.ts` throws on one).
 *
 *  Exported since B840 so the pricing table can print the number that charges
 *  rather than a second copy of it in a translation string.
 *
 *  **Per day, which is what makes a per-photograph rate wrong.** B1983's QA
 *  run measured 12 photographs costing 4 credits and read it as 0.33 a
 *  picture; it was `alps-2024` — twelve photographs over four days, one
 *  credit each. The composer's estimate sums this function per day rather
 *  than multiplying a rate, which is the same arithmetic the describe route
 *  spends by. */
/** @public open core: paid/ uses this (tagged by open-core/split). */
export const PHOTOS_PER_CREDIT = 10;

/** What one write-up costs, in credits — repriced to 0.05 by B2186 (was 1):
 *  one Haiku call on a paragraph costs the operator well under a cent, and a
 *  whole credit (CHF 0.20) was the owner's own complaint. Credits have been
 *  fractional to the hundredth since B987, so this is a plain price, not a
 *  rounding compromise. Here rather than in `lib/helper/model.ts` (which
 *  `import "server-only"`) because the wizard has to show this price from a
 *  client component before the tap, same reason `PHOTOS_PER_CREDIT` is here;
 *  `model.ts` re-exports it for its existing server-side callers. */
export const WRITE_DAY_CREDITS = 0.05;

/** The longest `notes` one write-up takes, in characters — B2223. The price
 *  above is flat while the operator pays per input token, so something has to
 *  bound the input. 12,000 characters is about 2,000 words, more than ten
 *  times the longest real day measured on 2026-09-25 (about 1,000
 *  characters), and about 3,000 input tokens, which still costs less than
 *  the price. It lives here, client-safe, so the polish link and the route
 *  use the same number. */
export const WRITE_DAY_NOTES_MAX_CHARS = 12_000;

/** The longest `location`, `country`, `from` or `to` a write-up takes — B2223
 *  review F2. These go into the prompt beside the notes. Each is a place
 *  name, so 200 characters leaves room to spare, and anything longer is
 *  input the operator pays for that the price does not cover. */
export const WRITE_DAY_FACT_MAX_CHARS = 200;

/** Zero photographs cost zero credits; the route refuses the call outright
 *  before it would ever compute this. */
export function creditsForPhotos(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / PHOTOS_PER_CREDIT);
}

/** The width a photograph is resized to before it is sent: the widest of
 *  `MEDIA_WIDTHS` short of the full 2000px original — plenty for a model to
 *  read a scene, at a fraction of the bytes.
 *
 *  Here rather than in `describe-photos/route.ts` since B1983, because the
 *  consent panel now promises this number to the person pressing the button
 *  and a promise kept beside the resize cannot drift from it. */
export const DESCRIBE_PHOTO_WIDTH = 1080;

/**
 * How much of a describe run a balance actually covers — B1983.
 *
 * The route spends **a day at a time**, so a short balance buys a prefix of
 * the days rather than an arbitrary number of photographs: offering "the
 * first 18 pictures" when the next day costs more than is left would be an
 * offer the route refuses. Returns the days that fit, how many photographs
 * that is, and what they cost.
 */
/** @public open core: paid/ uses this (tagged by open-core/split). */
export function affordableDays<D extends { count: number }>(
  days: readonly D[],
  balance: number,
): { days: D[]; photos: number; credits: number } {
  const taken: D[] = [];
  let credits = 0;
  let photos = 0;
  for (const day of days) {
    const next = credits + creditsForPhotos(day.count);
    if (next > balance) break;
    taken.push(day);
    credits = next;
    photos += day.count;
  }
  return { days: taken, photos, credits };
}
