import "server-only";
import crypto from "node:crypto";
import { getDatabase } from "../db";
import { NO_JOURNAL, generateCode, hashSecret } from "../auth";
import type { CheckResult } from "./types";

/**
 * The code lifecycle every backend that manages its own codes shares —
 * B1222 lifted it out of `dryRun.ts` when the WhatsApp backend arrived,
 * because the two differ only in where the code *goes*, never in how it is
 * stored, counted or expired.
 *
 * This repository's own OTP discipline, on `login_codes` with
 * `kind: "phone"`: hash only, thirty minutes, five attempts, superseded on
 * reissue. `email` holds the E.164 number for this kind — the column is
 * reused rather than duplicated, the same way `link_dest` and `trip_id`
 * already carry something other than their name for other kinds.
 */

const TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Supersede any live code for this number, write a fresh one, and hand the
 * plain code back exactly once — to a backend that must now deliver it. */
export async function issuePhoneCode(phone: string): Promise<{ id: string; code: string }> {
  const { db } = await getDatabase();
  const now = new Date();

  await db
    .updateTable("login_codes")
    .set({ consumed_at: now.toISOString() })
    .where("owner_id", "=", NO_JOURNAL)
    .where("email", "=", phone)
    .where("kind", "=", "phone")
    .where("consumed_at", "is", null)
    .execute();

  const id = crypto.randomUUID();
  const code = generateCode();
  await db
    .insertInto("login_codes")
    .values({
      id,
      owner_id: NO_JOURNAL,
      email: phone,
      code_hash: hashSecret(code),
      link_hash: null,
      link_consumed_at: null,
      link_dest: null,
      trip_id: null,
      kind: "phone",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
      consumed_at: null,
      link_standing: 0,
      attempts: 0,
    })
    .execute();

  return { id, code };
}

export async function checkPhoneCode(id: string, code: string): Promise<CheckResult> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("id", "=", id)
    .where("kind", "=", "phone")
    .executeTakeFirst();

  // No such id, or already spent — refused the same shape as a wrong code,
  // so a caller cannot use this to probe for a live id.
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
  return { status: "ok", phone: row.email };
}
