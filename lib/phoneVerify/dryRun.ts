import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "../dataDir";
import { getDatabase } from "../db";
import { NO_JOURNAL, generateCode, hashSecret } from "../auth";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

/**
 * The dry-run phone verification backend — no provider, no account, runs
 * locally exactly as AGENTS.md requires.
 *
 * Uses this repository's own OTP discipline (`login_codes`, hash-only,
 * five-attempt burn, thirty-minute expiry, superseded on reissue) with
 * `kind: "phone"` — a plain string, not a `SessionKind`, because a phone
 * proof opens no session. `email` holds the E.164 number rather than an
 * address for this kind; the column is reused rather than duplicated, the
 * same way `link_dest` and `trip_id` already carry something other than
 * their name for other kinds.
 */

const TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function phoneDir(): string {
  return path.join(dataDir(), "phone");
}

/** A number with everything but its last four digits replaced — the same
 * masking `lib/whatsapp/index.ts` uses for a log line. */
function mask(tel: string): string {
  // Digits only in the visible suffix, the same defence lib/whatsapp's own
  // maskNumber applies — this value is also used to build a filename below.
  const digits = tel.replace(/\D/g, "");
  return digits.length <= 4 ? "•".repeat(digits.length) : `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

async function start(phone: string, locale: string): Promise<StartResult> {
  const { db } = await getDatabase();
  const now = new Date();

  // Supersede any earlier live phone code for this number, the same
  // discipline `issueCode`/`revokeCodes` apply to every other kind.
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

  // Written where mail already goes when there is no journal to write it
  // under yet — the same reasoning `<dataDir>/mail/.mail/` follows for a
  // signup code. Never sent anywhere: this is the whole of "dry-run".
  const dir = phoneDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(dir, `${stamp}-${mask(phone)}.json`),
    JSON.stringify({ phone, code, locale }, null, 2) + "\n",
    "utf8",
  );
  console.log(`[phone:dry-run] ${mask(phone)} code=${code}`);

  return { id };
}

async function check(id: string, code: string): Promise<CheckResult> {
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

export const dryRunPhoneVerify: PhoneVerifyBackend = { name: "dry-run", start, check };
