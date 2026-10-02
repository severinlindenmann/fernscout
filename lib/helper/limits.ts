/**
 * Limits a day's write-up/describe calls still take — B2223/B1983.
 *
 * Client-safe (no `server-only`), so the wizard can bound input and promise
 * a resize width before the tap, and the route that actually runs the call
 * uses the identical numbers.
 */

/** The longest `notes` one write-up takes, in characters — B2223. A write-up
 *  is flat-priced against a plan's AI days while the operator pays per input
 *  token, so something has to bound the input. 12,000 characters is about
 *  2,000 words, more than ten times the longest real day measured on
 *  2026-09-25 (about 1,000 characters), and about 3,000 input tokens. It
 *  lives here, client-safe, so the polish link and the route use the same
 *  number. */
export const WRITE_DAY_NOTES_MAX_CHARS = 12_000;

/** The longest `location`, `country`, `from` or `to` a write-up takes — B2223
 *  review F2. These go into the prompt beside the notes. Each is a place
 *  name, so 200 characters leaves room to spare, and anything longer is
 *  input the operator pays for that the price does not cover. */
export const WRITE_DAY_FACT_MAX_CHARS = 200;

/** The longest `title` a `translate` call takes — security review follow-up
 *  to B2675, the same reasoning as `WRITE_DAY_FACT_MAX_CHARS` above: it goes
 *  into the prompt beside the notes, and a day's own `title` is never longer
 *  than this either (`title: z.string().trim().min(1).max(200)`,
 *  `lib/api/v2/schemas/day.ts`), so nothing truthful is ever refused by it. */
export const WRITE_DAY_TITLE_MAX_CHARS = 200;

/** The width a photograph is resized to before it is sent: the widest of
 *  `MEDIA_WIDTHS` short of the full 2000px original — plenty for a model to
 *  read a scene, at a fraction of the bytes.
 *
 *  Here rather than in `describe-photos/route.ts` since B1983, because the
 *  consent panel now promises this number to the person pressing the button
 *  and a promise kept beside the resize cannot drift from it. */
export const DESCRIBE_PHOTO_WIDTH = 1080;
