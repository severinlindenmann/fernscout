import "server-only";
import { isEnabled } from "../capabilities";
import { isOwner } from "../contacts/session";
import type { PhotobookEntry, Trip } from "../types";

/**
 * May the person reading this page order a book of it.
 *
 * One question in one file, for the reason `lib/postcard/entry.ts` gives at
 * length: the gallery page decides draft visibility a few lines earlier, and
 * `test/draft-audience.test.ts` fails any file under `app/[user]/` that
 * mentions a draft and calls `isOwner`. The honest way past that rule is to
 * have no `isOwner` call in the page, not to add the page to an allowlist.
 *
 * `undefined` for everybody who may not, so a caller has nothing to render
 * rather than a flag to remember to check. Credits are as load-bearing as the
 * capability named after the feature: a Pay button on a journal that cannot
 * be paid from is a button that lies.
 *
 * This decides what is *shown*. Both routes ask for themselves.
 */
export async function photobookEntryFor(trip: Trip): Promise<PhotobookEntry | undefined> {
  const username = trip.username;
  if (!isEnabled("photobook", username) || !isEnabled("credits", username)) return undefined;
  if (!(await isOwner(username))) return undefined;
  return { username, trip: trip.id };
}
