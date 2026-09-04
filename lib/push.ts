import "server-only";
import { isOpenToLink, isTestContent } from "./access";
import { getDatabaseOrNull } from "./db";
import { contactsWithReadGrant } from "./grants";
import { pushRepo } from "./repos";
import type { StoredSubscription } from "./repos/types";
import type { Trip } from "./types";

export type { StoredSubscription } from "./repos/types";

/**
 * Push subscriptions, for route handlers and the notify script.
 *
 * As with reactions, the storage behind this is either the database or the
 * `$DATA_DIR` JSON file, and nothing above this file knows which. Every
 * subscription belongs to one journal (`content/<username>/…`) — content is
 * multi-user, and a deployment can serve several — so every call here takes
 * or carries a `username`.
 */

export async function listSubscriptions(username: string): Promise<StoredSubscription[]> {
  return (await pushRepo()).list(username);
}

/** Keyed by username + endpoint, so re-subscribing the same browser to the
 * same journal updates rather than duplicating — which browsers do routinely
 * when a subscription is refreshed. */
export async function saveSubscription(sub: StoredSubscription): Promise<void> {
  await (await pushRepo()).save(sub);
}

export async function removeSubscription(username: string, endpoint: string): Promise<void> {
  await (await pushRepo()).remove(username, [endpoint]);
}

/** Drop several at once — used by the notify script after the push service
 * reports an endpoint as gone (404/410), which is how you learn someone
 * deleted the PWA. */
export async function removeSubscriptions(username: string, endpoints: string[]): Promise<void> {
  await (await pushRepo()).remove(username, endpoints);
}

/**
 * The contact a subscribing browser belongs to, if it can be told.
 *
 * Looked up directly against the `contacts` table rather than through
 * `lib/contacts` (W10), which this file deliberately does not import or
 * modify — see docs/plans/W12-push.md. Only an `active` (approved) contact
 * counts: a pending or blocked row is not "known" for notification purposes.
 * Requires a database, like every part of the contacts model; without one
 * this always answers "no".
 */
export async function findActiveContactId(
  username: string,
  email: string,
): Promise<string | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const key = email.trim().toLowerCase();
  const row = await handle.db
    .selectFrom("contacts")
    .select(["id"])
    .where("owner_id", "=", username)
    .where("email_key", "=", key)
    .where("status", "=", "active")
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Who is subscribed *and* may see this trip — the per-recipient fan-out
 * W12 asks for.
 *
 * The rule is the digest's rule, in the surface that sits closest to the
 * reader: **a notification never names a trip the gate would refuse.** A push
 * is a title and a link on a lock screen; it cannot be taken back, and it
 * arrives whether or not anybody was going to look. `test/access-gate.test.ts`
 * pins this function to `mayReadTrip` over the same viewer × trip table the
 * gate, the panel and the digest are pinned to.
 *
 * The questions, in the order they are asked:
 *
 * - **Content nobody lived** — a `test: true` trip, or a `test: true` day
 *   inside a real one — has no subscribers at all, however public it says it
 *   is. Every reading surface contains it by wearing a banner; a lock screen
 *   has nowhere to put one, so it is not sent rather than disclaimed (B70).
 *   Asked first, because a proving trip is normally `public` and would sail
 *   straight past the next question.
 * - **`private`** — nobody, and this is the line that was missing (B68). A
 *   `read` grant is journal-wide and means *this person may read the
 *   journal's `guest` trips*; it has never meant a `private` one, which
 *   `mayReadTrip` refuses to a journal guest before it asks anything else. So
 *   an approved family member with the PWA installed was pushed a title and a
 *   link to a page that then refused them — the exact harm a private trip
 *   exists to prevent, arriving by the one channel that interrupts.
 * - **public or unlisted** — open to anyone holding the link (`isOpenToLink`),
 *   so every subscription for this journal qualifies.
 * - **`guest`** — a device merely being subscribed says nothing about who is
 *   holding it, so only a subscription tied to a signed-in, active contact
 *   (`contactId`, set at subscribe time — see `findActiveContactId`) who holds
 *   a **live** `read` grant on this journal qualifies. The grant is
 *   journal-wide and there is no other kind.
 *
 *   *Live* is `lib/grants.ts`'s question and not this file's (B82). This
 *   function used to run its own `access_grants` query and take a row's
 *   existence for a grant, which made it the only reader of that table that
 *   never asked `grantIsLive` — so an expiry that closed the panel and the
 *   gate left the lock screen open. `lib/grants.ts` reads `access_grants` and
 *   nothing else; importing it is not the `lib/contacts` dependency this file
 *   avoids, and it brings no encrypted contact field into the notify path.
 *   The active-contact question is still asked first and separately — the
 *   order `planDigest` used, before B387 deleted it, and the order
 *   `sendDayLetter`'s `recipientsFor` still follows: approval before
 *   entitlement, so somebody who was never approved is never even asked
 *   about.
 *
 * Everyone else — including every subscriber at all, when there is no database
 * — is left out rather than guessed into an audience that may not be able to
 * open the page the notification links to. That is the fail-closed choice:
 * under-notifying a restricted trip is a nuisance, over-notifying it is a leak.
 *
 * ## What the `private` line costs, and why it is still right
 *
 * It costs `people:` their own notifications. They can open the trip — the
 * gate lets them through on their address — and this function cannot tell that
 * one of these subscriptions is theirs: a subscription carries a `contactId`,
 * and `isPersonOn` matches an *address*. Closing that gap means resolving a
 * contact's address here, which this file deliberately cannot do (it does not
 * import `lib/contacts`; see docs/plans/W12-push.md) and which would put
 * decrypted addresses in the notify path to serve at most a handful of people
 * who already know what they wrote. The digest refuses `private` for its own
 * travellers on the same grounds and in the same words. If it is ever wanted,
 * it is a design, not a line — and it is not this task.
 *
 * `entry` is optional because two callers ask different questions. The
 * subscribe route asks about a trip; the notify script is always announcing
 * one particular day. Pass the entry whenever there is one.
 */
export async function subscribersFor(
  trip: Trip,
  entry?: { test?: boolean },
): Promise<StoredSubscription[]> {
  // Nobody lived it, so nobody is told about it — checked before `isOpenToLink`,
  // because a test trip is usually `public` and would sail past it (B70).
  if (isTestContent(trip, entry)) return [];
  // And `private` is nobody's, grant or no grant. A journal-wide `read` grant
  // is not a key to this trip, and there is no record here of who was on it
  // (B68).
  if (trip.visibility === "private") return [];

  const all = await listSubscriptions(trip.username);
  if (isOpenToLink(trip)) return all;

  const handle = await getDatabaseOrNull();
  if (!handle) return [];

  // Two questions, two queries, asked once for the whole fan-out rather than
  // twice per subscription — which is what this was, and what turns a notify
  // run over fifty devices into a hundred round trips. Active first, then
  // granted: the same order `sendDayLetter`'s recipient resolution uses.
  const [activeRows, granted] = await Promise.all([
    handle.db
      .selectFrom("contacts")
      .select(["id"])
      .where("owner_id", "=", trip.username)
      .where("status", "=", "active")
      .execute(),
    contactsWithReadGrant(trip.username, new Date()),
  ]);
  const active = new Set(activeRows.map((row) => row.id));

  return all.filter(
    (sub) => sub.contactId != null && active.has(sub.contactId) && granted.has(sub.contactId),
  );
}

/**
 * A push service's `404`/`410` means the subscription is gone for good — the
 * reader deleted the PWA, or the browser rotated the endpoint. Anything else
 * is worth surfacing rather than silently dropping the subscription.
 *
 * Duck-typed on `statusCode` rather than `instanceof WebPushError`, so this
 * file — imported by the subscribe route as well as the notify script — never
 * needs the `web-push` package, which the sending side alone depends on.
 */
export function isGoneSubscription(err: unknown): boolean {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}
