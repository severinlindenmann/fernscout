import "server-only";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { getDatabaseOrNull, newId, nowIso } from "../db";

/** The two channels a day can be announced on — B345, B365. */
export type NotifyChannel = "mail" | "whatsapp";

/**
 * Record that this channel has told readers about this day — B633.
 *
 * Called by `sendDayLetter` / `sendDayWhatsapp` themselves on every
 * `ok: true` outcome, whatever it cost — see `022-day-notifications` for why
 * this cannot be read off `credit_ledger` instead. Upserted rather than
 * inserted: a resend is still one fact about a day and a channel, not a log
 * of every time it went out.
 *
 * Silently does nothing without a database — the same fallback `spend` and
 * `refund` make for the same reason. A journal with no database has no
 * credits either, so nothing here can be reached with charging switched on.
 */
export async function recordNotified(
  owner: string,
  tripId: string,
  slug: string,
  channel: NotifyChannel,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;

  const sentAt = nowIso();
  const existing = await handle.db
    .selectFrom("day_notifications")
    .select("id")
    .where("owner_id", "=", owner)
    .where("trip_id", "=", tripId)
    .where("slug", "=", slug)
    .where("channel", "=", channel)
    .executeTakeFirst();

  if (existing) {
    await handle.db
      .updateTable("day_notifications")
      .set({ sent_at: sentAt })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await handle.db
      .insertInto("day_notifications")
      .values({ id: newId(), owner_id: owner, trip_id: tripId, slug, channel, sent_at: sentAt })
      .execute();
  }
}

/**
 * Take this channel for sending, or say somebody already has — the double-
 * press guard, and the reason `recordNotified` above is not enough on its
 * own for the owner's own button (though it stays exactly right for the
 * agent's `POST …/send-mail`, which is deliberately allowed to resend).
 *
 * Two presses of the same button, a heartbeat apart, must not both find
 * "not yet sent", both pass the credit precheck, and both mail the whole
 * readership — the exact failure the record exists to prevent. This is
 * `claimForSend` in `lib/postcard/orders.ts`'s own reasoning, adapted from an
 * update-on-rows-affected (there is a `draft` row to claim) to an
 * insert-on-conflict (there is no row until the first attempt makes one):
 * the unique index from `022-day-notifications` is the only thing that can
 * make a second, concurrent insert fail, so *inserted* is *claimed*.
 */
export async function claimChannel(
  owner: string,
  tripId: string,
  slug: string,
  channel: NotifyChannel,
): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  // No database, no safe claim. Refusing to send is the safe direction —
  // the alternative is risking the exact double-send this function exists
  // to rule out.
  if (!handle) return false;

  const result = await handle.db
    .insertInto("day_notifications")
    .values({ id: newId(), owner_id: owner, trip_id: tripId, slug, channel, sent_at: nowIso() })
    .onConflict((oc) => oc.columns(["owner_id", "trip_id", "slug", "channel"]).doNothing())
    .executeTakeFirst();
  // bigint on both dialects, and this file compiles at ES2017 where `0n` is a
  // syntax error — the same `Number()` dance `claimForSend` and `spend` use.
  return Number(result.numInsertedOrUpdatedRows ?? 0) === 1;
}

/**
 * Put a claimed channel back, because nothing was sent after all — the
 * mirror of `releaseClaim` beside `claimForSend`.
 *
 * The path that matters is the same one: the claim succeeded and the send
 * then refused for an ordinary reason (a capability switched off mid-flight,
 * ordinarily impossible but not worth leaving unhandled) — never on a
 * successful send, whatever it cost. Without this, a `false` claim call
 * beside a send that then did nothing would tell the owner's page a day had
 * been announced when nobody received anything.
 */
export async function releaseChannelClaim(
  owner: string,
  tripId: string,
  slug: string,
  channel: NotifyChannel,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .deleteFrom("day_notifications")
    .where("owner_id", "=", owner)
    .where("trip_id", "=", tripId)
    .where("slug", "=", slug)
    .where("channel", "=", channel)
    .execute();
}

/**
 * Is this channel actually reachable for this journal — mirrors the refusal
 * `sendDayLetter` / `sendDayWhatsapp` give for `mail_off` / `whatsapp_off` /
 * `contacts_off`, restated as a question rather than a `SkipReason` so the
 * owner's own page can decide what to offer before spending anything.
 */
export function channelEnabled(channel: NotifyChannel, owner: string): boolean {
  if (!isEnabled("contacts", owner)) return false;
  return isEnabled(channel) && !hasSwitchedOff(channel, owner);
}

/** Which channels have already told readers about this day. Empty — never a
 * throw — when there is no database to ask. */
export async function notifiedChannelsFor(
  owner: string,
  tripId: string,
  slug: string,
): Promise<Set<NotifyChannel>> {
  const handle = await getDatabaseOrNull();
  if (!handle) return new Set();

  const rows = await handle.db
    .selectFrom("day_notifications")
    .select("channel")
    .where("owner_id", "=", owner)
    .where("trip_id", "=", tripId)
    .where("slug", "=", slug)
    .execute();
  return new Set(rows.map((r) => r.channel as NotifyChannel));
}
