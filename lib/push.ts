import "server-only";
import { isOpenToLink } from "./access";
import { getDatabaseOrNull } from "./db";
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
 * A public or unlisted trip is open to anyone holding the link (`lib/access.ts`
 * — `isOpenToLink`), so every subscription for this journal qualifies. A
 * password-protected trip is not: a device merely being subscribed proves
 * nothing about whether it was ever shown the password, so only a
 * subscription tied to a signed-in, active contact (`contactId`, set at
 * subscribe time — see `findActiveContactId`) who holds a `read` grant on this
 * journal qualifies. The grant is journal-wide and there is no other kind: a
 * trip that the people let in should not hear about is `visibility: private`,
 * which never reaches this function. Everyone else — including every
 * subscriber at all, when there is no database — is left out rather than
 * guessed into an audience that might not have the password. That is the
 * fail-closed choice: under-notifying a restricted trip is a nuisance,
 * over-notifying it is a leak.
 */
export async function subscribersFor(trip: Trip): Promise<StoredSubscription[]> {
  const all = await listSubscriptions(trip.username);
  if (isOpenToLink(trip)) return all;

  const handle = await getDatabaseOrNull();
  if (!handle) return [];

  const eligible: StoredSubscription[] = [];
  for (const sub of all) {
    if (!sub.contactId) continue;

    const contact = await handle.db
      .selectFrom("contacts")
      .select(["status"])
      .where("owner_id", "=", trip.username)
      .where("id", "=", sub.contactId)
      .executeTakeFirst();
    if (!contact || contact.status !== "active") continue;

    const grant = await handle.db
      .selectFrom("access_grants")
      .select(["id"])
      .where("owner_id", "=", trip.username)
      .where("contact_id", "=", sub.contactId)
      .where("scope", "=", "read")
      .executeTakeFirst();
    if (grant) eligible.push(sub);
  }
  return eligible;
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
