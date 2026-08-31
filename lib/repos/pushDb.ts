import type { DatabaseHandle } from "../db/client";
import { newId, nowIso } from "../db/owner";
import type { PushRepo, StoredSubscription } from "./types";

/** The file store records `created` as a bare date; the column is a full
 * ISO-8601 timestamp like every other timestamp in the schema. */
function toTimestamp(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : date;
}

/**
 * Push subscriptions in the database.
 *
 * `owner_id` holds the journal's username, not the single-tenant constant
 * `lib/db/owner.ts` hands out elsewhere — a deployment can serve several
 * journals (`content/<username>/…`), and a subscription belongs to exactly
 * one of them. Keyed by `(owner_id, endpoint)` like the file store keys by
 * `username\0endpoint`, so the same browser subscribing to two journals
 * stays two rows instead of one clobbering the other.
 */
export function dbPushRepo(handle: DatabaseHandle): PushRepo {
  const { db } = handle;

  return {
    async list(username): Promise<StoredSubscription[]> {
      const rows = await db
        .selectFrom("push_subscriptions")
        .select(["endpoint", "p256dh", "auth", "user_agent", "created_at", "contact_id"])
        .where("owner_id", "=", username)
        .orderBy("created_at")
        .execute();
      return rows.map((row) => ({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
        // Stored full-precision, handed out as a date — the day someone
        // subscribed is all the notify script ever wants to show.
        created: row.created_at.slice(0, 10),
        agent: row.user_agent ?? undefined,
        username,
        contactId: row.contact_id,
      }));
    },

    async save(sub) {
      const now = nowIso();
      const contactId = sub.contactId ?? null;
      await db
        .insertInto("push_subscriptions")
        .values({
          id: newId(),
          owner_id: sub.username,
          contact_id: contactId,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          user_agent: sub.agent ?? null,
          created_at: toTimestamp(sub.created),
          last_seen_at: now,
        })
        .onConflict((oc) =>
          oc.columns(["owner_id", "endpoint"]).doUpdateSet({
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            // A resubscribe with no user-agent shouldn't erase the one we had.
            ...(sub.agent === undefined ? {} : { user_agent: sub.agent }),
            contact_id: contactId,
            last_seen_at: now,
          }),
        )
        .execute();
    },

    async remove(username, endpoints) {
      if (endpoints.length === 0) return;
      await db
        .deleteFrom("push_subscriptions")
        .where("owner_id", "=", username)
        .where("endpoint", "in", endpoints)
        .execute();
    },
  };
}
