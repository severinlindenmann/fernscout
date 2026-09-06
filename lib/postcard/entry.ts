import "server-only";
import { isEnabled } from "../capabilities";
import { isOwner } from "../contacts/session";
import { namesOnTrip } from "../tripPeople";
import { partyFor } from "../travellers/parse";
import type { Figure } from "../travellers/vocabulary";
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

  // A default, not the field's whole story — the preview page's `from` box
  // stays free text the owner can overwrite. Owner first, then whoever else
  // was on the trip (`peopleOf`'s own membership, buddies included — B629),
  // joined the same way `travellerFullNamesOf` joins a credit line. A trip
  // with nobody else on it signs exactly as it always has.
  return {
    username,
    trip: trip.id,
    from: (await namesOnTrip(trip)).join(" & "),
  };
}

/**
 * Who prints beside the signature when the figures switch is on — B628.
 *
 * The same party the photobook and the site's hero already draw: the trip's
 * own `travellers:` block, falling back to the journal's default, and
 * **never a placeholder**. `partyFor` alone would hand back one neutral
 * figure for a trip nobody has described, and printing that on somebody's
 * postcard would be the software asserting who was there — so, like
 * `lib/photobook/source.ts`, the empty placeholder is filtered back out.
 *
 * There is no per-person likeness to draw instead. A traveller's appearance
 * lives only in this one block, addressed to the trip as a whole; a buddy who
 * joined by link has no figure of their own anywhere, `for:` is an unread tag
 * rather than a lookup key, and nothing here invents one.
 */
export function travellerPartyFor(trip: Trip): Figure[] {
  const journalFigures = getUser(trip.username)?.travellers ?? [];
  return partyFor(trip.travellers, journalFigures).filter(
    (figure) => Object.keys(figure).length > 0,
  );
}
