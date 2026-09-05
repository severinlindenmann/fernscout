import "server-only";
import { isEnabled } from "../capabilities";
import { isOwner } from "../contacts/session";
import { getUser } from "../users";
import type { PostcardEntry, Trip } from "../types";

/**
 * May the person reading this page start a postcard from it, and with what
 * signature — B441.
 *
 * One question, asked in one place, because the gallery page must not ask it
 * itself. That page decides *draft visibility* a few lines earlier, and
 * `test/draft-audience.test.ts` fails any file under `app/[user]/` that
 * mentions a draft and calls `isOwner` — the shape by which somebody
 * accidentally decides who may read an unpublished day from who owns the
 * journal. The rule is a good one and the honest way past it is to have no
 * `isOwner` call in the page at all, not to add the page to an allowlist.
 *
 * The answer is `undefined` for everybody who may not, so a caller gets
 * nothing to render rather than a flag to remember to check. The gallery is a
 * public reader page: on a public trip that is the whole internet, and a
 * control that exists only to tell a guest no should not have rendered.
 *
 * **This decides what is shown and nothing else.** `POST …/postcards` and
 * `GET …/postcards/recipients` each ask `isOwner` for themselves, so being
 * wrong here would be a cosmetic bug rather than a way in.
 */
export async function postcardEntryFor(trip: Trip): Promise<PostcardEntry | undefined> {
  const username = trip.username;
  const user = getUser(username);
  // Postcards need somebody to post to, so contacts is as load-bearing as the
  // capability named after the feature.
  if (!user || !isEnabled("postcards", username) || !isEnabled("contacts", username)) {
    return undefined;
  }
  if (!(await isOwner(username))) return undefined;

  return {
    username,
    trip: trip.id,
    // The one field of an order that is the same every time, so it is read
    // here rather than asked for in a box in front of somebody who wanted this
    // to be quick. Nickname first — it is what a journal calls its author in
    // its own voice, which is what belongs at the bottom of a postcard.
    from: user.owner.nickname || user.owner.name || user.title,
  };
}
