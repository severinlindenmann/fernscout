import "server-only";
import { getDatabase, getDatabaseOrNull, nowIso } from "../db";
import { recipientHash } from "../messages/log";

/**
 * "Never invite this address again" — B2442 (W44 "Accepted from the
 * critics": a German court treats an unsolicited platform invite as
 * advertising, BGH I ZR 208/12, so one invite with a clear opt-out is the
 * minimum). One table, instance-wide — not per journal, because the address
 * asked never to be invited by *anyone* here, not only by the journal that
 * happened to invite it first.
 *
 * `hash` is the same `recipientHash` the send log keys on (B2438): a
 * deterministic HMAC-SHA256 of the normalised address or number, keyed by
 * `SESSION_SECRET`. That determinism is also what makes it usable as the
 * public `/x/<token>` token itself — nothing else needs to be minted or
 * looked up to build the link a mail's footer carries, and nobody can derive
 * an address from the hash without the server's own secret.
 */
export async function isInviteSuppressed(addressOrNumber: string): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const row = await handle.db
    .selectFrom("invite_suppressions")
    .select("hash")
    .where("hash", "=", recipientHash(addressOrNumber))
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Suppress by token — the public `/x/<token>` page never holds the raw
 * address, only its own hash, which *is* the token (see `neverInviteToken`
 * below). Idempotent, so pressing the confirm page twice (a double click, a
 * retried request) is a no-op rather than a constraint violation.
 */
export async function suppressInviteToken(token: string): Promise<void> {
  const { db } = await getDatabase();
  const existing = await db
    .selectFrom("invite_suppressions")
    .select("hash")
    .where("hash", "=", token)
    .executeTakeFirst();
  if (existing) return;
  await db
    .insertInto("invite_suppressions")
    .values({ hash: token, created_at: nowIso() })
    .execute();
}

/** The `/x/<token>` token for a given address or number — its own
 * `recipientHash`. A stable function name at the call site rather than
 * reusing `recipientHash` directly everywhere this concept is meant, so a
 * reader can grep for "the never-invite token" and find every place that
 * mints or checks one. */
export function neverInviteToken(addressOrNumber: string): string {
  return recipientHash(addressOrNumber);
}

/** Whether a token names a real, well-formed hash — not a database lookup
 * (a token still "means" a suppression once pressed, whether or not that
 * hash has ever been sent to), just the shape `recipientHash` produces. */
export function isNeverInviteToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}
