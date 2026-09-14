import "server-only";
import crypto from "node:crypto";
import { getDatabase } from "./db";
import { generateCode, hashSecret } from "./auth";

/**
 * Proving a NEW `owner.email` before it becomes the address that mints
 * owner tokens — B1733.
 *
 * Modelled on `lib/phoneVerify/codes.ts`, which lifted the same lifecycle
 * out for the phone-proof `kind` on `login_codes`: this is a second reuse of
 * that table with a `kind` of its own (`"owner_email"`) rather than a new
 * one, so the OTP discipline — hash only, thirty minutes, five attempts,
 * superseded on reissue — stays in the one place that already gets it
 * right. Unlike the phone kind (`owner_id: NO_JOURNAL`, address-scoped),
 * this IS journal-scoped: `owner_id` is the username, because the field
 * being proven belongs to one journal, not to an address that spans them.
 *
 * `email` on the row carries the REQUESTED new address (the column is
 * reused for "the thing this code is about", the same convention `phone`
 * and `link_dest` already follow) — never the address the code was mailed
 * to under any other name, so `checkOwnerEmailChange`'s caller does not
 * have to be trusted to remember it correctly.
 *
 * **This module writes nothing to `config.json` and revokes no session.**
 * It only proves possession of an inbox. The caller —
 * `app/api/v2/[user]/owner/email/redeem/route.ts` — is the one place that,
 * on a successful check, calls `setOwnerEmail` and
 * `revokeSessionsForAddress`. Keeping proof and consequence in different
 * functions is what let `lib/ownerTel.ts` state its own single-writer rule
 * so plainly; this field gets the same shape of promise.
 */

const TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const KIND = "owner_email";

export type CheckResult = { status: "ok"; newEmail: string } | { status: "wrong" | "expired" | "burned" };

/** Supersede any pending change for this journal, write a fresh code, and
 * hand the plain code back exactly once — to the caller that must now mail
 * it to `newEmail`. */
export async function issueOwnerEmailCode(
  username: string,
  newEmail: string,
): Promise<{ id: string; code: string }> {
  const { db } = await getDatabase();
  const now = new Date();

  await db
    .updateTable("login_codes")
    .set({ consumed_at: now.toISOString() })
    .where("owner_id", "=", username)
    .where("kind", "=", KIND)
    .where("consumed_at", "is", null)
    .execute();

  const id = crypto.randomUUID();
  const code = generateCode();
  await db
    .insertInto("login_codes")
    .values({
      id,
      owner_id: username,
      email: newEmail,
      code_hash: hashSecret(code),
      link_hash: null,
      link_consumed_at: null,
      link_dest: null,
      trip_id: null,
      kind: KIND,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
      consumed_at: null,
      link_standing: 0,
      attempts: 0,
    })
    .execute();

  return { id, code };
}

/** Deliberately uniform about failure, the same discipline every code in
 * this codebase follows: a caller cannot tell "no code was ever issued"
 * from "the code was wrong" from "an id for a different journal". */
export async function checkOwnerEmailChange(
  username: string,
  id: string,
  code: string,
): Promise<CheckResult> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("id", "=", id)
    .where("owner_id", "=", username)
    .where("kind", "=", KIND)
    .executeTakeFirst();

  if (!row || row.consumed_at) return { status: "wrong" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", id).execute();
    return { status: "expired" };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", id).execute();
    return { status: "burned" };
  }

  const supplied = hashSecret(code.trim());
  const match =
    supplied.length === row.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(row.code_hash));

  if (!match) {
    await db.updateTable("login_codes").set({ attempts: row.attempts + 1 }).where("id", "=", id).execute();
    return { status: "wrong" };
  }

  await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", id).execute();
  return { status: "ok", newEmail: row.email };
}
