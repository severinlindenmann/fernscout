import "server-only";
import { isTestContent } from "../access";
import { isEnabled } from "../capabilities";
import { creditsEnabled } from "../credits";
import { getDatabaseOrNull } from "../db";
import { getDays } from "../entries";
import { getTrips } from "../trips";
import { postcardCandidates, type PostcardCandidate } from "./contacts";

/**
 * The one moment worth noticing on somebody's behalf — B436.
 *
 * Ordering a postcard is three calls an agent has to already know exist, and
 * an owner who never reads `/agent.md` never learns the feature is there at
 * all. This is the other half of `journalStatus` and `/<user>/me`: **one**
 * function, called from both, so the door an agent reads and the card a
 * person sees can never say something different from each other.
 *
 * Deliberately narrow. It offers nothing unless every one of these holds:
 *
 * - `postcards`, `credits` and `contacts` are all enabled for this journal;
 * - at least one `active` contact has ticked the postcard box and has a
 *   postable address (`postcardCandidates`, which is `eligible()`'s own
 *   answer — the same gate the order route itself checks);
 * - a published, non-`test` day within the last week has a usable
 *   photograph — an image, not a video, since that is what goes on the
 *   front of a card;
 * - no order already exists for that trip from the last week, sent or not —
 *   a standing draft is a person already part-way through this, and a sent
 *   one means they have already been asked.
 *
 * Absent — not an empty array — the moment any of those fails, which is
 * `journalStatus`'s own rule for every optional field: a `0` or `[]` reads as
 * "checked, nothing here" where an absent key reads as "not offered", and the
 * second is the honest one for a feature that may not even exist on this
 * build.
 */

/** How recent "just published" and "already asked" both mean — one window,
 * so the two conditions cannot silently disagree about what "recent" is. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type PostcardSuggestion = {
  kind: "postcard";
  day: string;
  trip: string;
  reason: string;
  recipients: PostcardCandidate[];
};

/** Whether `print_orders` already holds a postcard order for this trip from
 *  within the window — draft, submitted or printed all count: each one means
 *  somebody has already been asked, or is already asking. */
async function orderedRecently(trip: string, since: string): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const row = await handle.db
    .selectFrom("print_orders")
    .select("id")
    .where("kind", "=", "postcard")
    .where("trip_id", "=", trip)
    .where("created_at", ">=", since)
    .executeTakeFirst();
  return row !== undefined;
}

export async function postcardSuggestion(user: string): Promise<PostcardSuggestion | null> {
  if (!isEnabled("postcards", user) || !isEnabled("contacts", user) || !creditsEnabled()) {
    return null;
  }

  const recipients = await postcardCandidates(user);
  if (recipients.length === 0) return null;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const sinceDate = since.slice(0, 10);

  for (const trip of getTrips(user)) {
    // Newest first: the moment worth surfacing is the most recent one.
    const days = getDays(trip.ref).filter((d) => d.date >= sinceDate).reverse();
    for (const day of days) {
      // Any update on the day may carry the photograph, not only the lead.
      const entry = day.entries.find(
        (e) => !isTestContent(trip, e) && e.gallery.some((item) => item.type === "image"),
      );
      if (!entry) continue;
      if (await orderedRecently(trip.ref, since)) break; // whole trip is spoken for
      return {
        kind: "postcard",
        day: entry.slug,
        trip: trip.ref,
        reason: `"${entry.title}" (${day.date}) was published recently and has a photograph — ` +
          `${recipients.length === 1 ? "somebody" : `${recipients.length} people`} on the ` +
          "contacts list asked for a postcard.",
        recipients,
      };
    }
  }
  return null;
}
