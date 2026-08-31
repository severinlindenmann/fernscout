import "server-only";
import crypto from "node:crypto";
import { getDatabase } from "../db";

/**
 * Email one-time codes, and the two classes of session they produce.
 *
 * Decision 24: an **agent** token writes and lives seven days; a **guest**
 * session reads and lives up to a year. They are obtained separately and are
 * not interchangeable — an agent token presented as a cookie is refused, and a
 * guest cookie presented as a bearer token is refused. The owner may hold both,
 * which is the point: reading the site on your phone should not put a
 * credential that can rewrite it in your pocket.
 *
 * Nothing here is testable only in production. With no mail account at all, the
 * code is written to `content/<user>/mail/` and printed to the console, and
 * `AUTH_DEV_CODE` fixes it outright for end-to-end tests.
 */

export type SessionKind = "guest" | "agent";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

/** Seven days for write, a year for read — decision 24. */
export const SESSION_TTL_MS: Record<SessionKind, number> = {
  agent: 7 * 24 * 60 * 60 * 1000,
  guest: 365 * 24 * 60 * 60 * 1000,
};

export const SESSION_SCOPE: Record<SessionKind, string> = {
  agent: "write:content",
  guest: "read",
};

export const GUEST_COOKIE = "fs_session";

/**
 * A six-digit code.
 *
 * Six digits is 20 bits, which is only safe because it expires in ten minutes
 * and burns after five wrong guesses — both enforced below. Generated with
 * rejection sampling rather than a modulo, so every code is equally likely.
 */
export function generateCode(): string {
  if (process.env.AUTH_DEV_CODE) return process.env.AUTH_DEV_CODE;
  for (;;) {
    const n = crypto.randomBytes(3).readUIntBE(0, 3);
    if (n < 16_000_000) return String(n % 1_000_000).padStart(6, "0");
  }
}

/** Codes and tokens are stored hashed; only their bearer ever sees the value. */
export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateToken(kind: SessionKind): string {
  return `fs_${kind}_${crypto.randomBytes(32).toString("base64url")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export type IssuedCode = { code: string; expiresAt: string };

/**
 * Issue a login code for an address.
 *
 * Any previously live code for the same address and kind is consumed first, so
 * requesting a new one always invalidates the old — otherwise a forwarded email
 * from ten minutes ago would still work.
 */
export async function issueCode(
  owner: string,
  email: string,
  kind: SessionKind,
): Promise<IssuedCode> {
  const { db } = await getDatabase();
  const address = normaliseEmail(email);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  await db
    .updateTable("login_codes")
    .set({ consumed_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("email", "=", address)
    .where("kind", "=", kind)
    .where("consumed_at", "is", null)
    .execute();

  const code = generateCode();
  await db
    .insertInto("login_codes")
    .values({
      id: crypto.randomUUID(),
      owner_id: owner,
      email: address,
      code_hash: hashSecret(code),
      kind,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      consumed_at: null,
      attempts: 0,
    })
    .execute();

  return { code, expiresAt };
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: string; scope: string; userId: string }
  | { ok: false; reason: "no-code" | "expired" | "wrong" | "burned" };

/**
 * Redeem a code for a session token.
 *
 * Deliberately uniform about failure: a caller cannot tell "no code was ever
 * issued for that address" from "the code was wrong". Anything else turns this
 * endpoint into a way of asking which addresses exist.
 */
export async function verifyCode(
  owner: string,
  email: string,
  code: string,
  kind: SessionKind,
  /**
   * What the resulting session may do, when it is narrower than the default.
   *
   * Used for a trip-scoped agent token: somebody who took one trip but does
   * not own the journal writes to that trip and nothing else. Ignored for a
   * guest session, which reads and has nothing to narrow.
   */
  scope?: string,
): Promise<VerifyResult> {
  const { db } = await getDatabase();
  const address = normaliseEmail(email);

  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("email", "=", address)
    .where("kind", "=", kind)
    .where("consumed_at", "is", null)
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (!row) return { ok: false, reason: "no-code" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db
      .updateTable("login_codes")
      .set({ consumed_at: nowIso() })
      .where("id", "=", row.id)
      .execute();
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await db
      .updateTable("login_codes")
      .set({ consumed_at: nowIso() })
      .where("id", "=", row.id)
      .execute();
    return { ok: false, reason: "burned" };
  }

  const supplied = hashSecret(code.trim());
  const expected = row.code_hash;
  const match =
    supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));

  if (!match) {
    await db
      .updateTable("login_codes")
      .set({ attempts: row.attempts + 1 })
      .where("id", "=", row.id)
      .execute();
    return { ok: false, reason: "wrong" };
  }

  await db
    .updateTable("login_codes")
    .set({ consumed_at: nowIso() })
    .where("id", "=", row.id)
    .execute();

  const userId = await upsertUser(owner, address);
  const token = generateToken(kind);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS[kind]).toISOString();
  const granted = kind === "agent" && scope ? scope : SESSION_SCOPE[kind];

  await db
    .insertInto("sessions")
    .values({
      id: crypto.randomUUID(),
      owner_id: owner,
      user_id: userId,
      kind,
      token_hash: hashSecret(token),
      scope: granted,
      created_at: nowIso(),
      expires_at: expiresAt,
      last_seen_at: null,
      revoked_at: null,
      user_agent: null,
      ip: null,
    })
    .execute();

  return { ok: true, token, expiresAt, scope: granted, userId };
}

async function upsertUser(owner: string, email: string): Promise<string> {
  const { db } = await getDatabase();
  const existing = await db
    .selectFrom("users")
    .select(["id"])
    .where("owner_id", "=", owner)
    .where("email", "=", email)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("users")
      .set({ last_login_at: nowIso(), updated_at: nowIso() })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id,
      owner_id: owner,
      email,
      name: null,
      role: "reader",
      locale: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_login_at: nowIso(),
    })
    .execute();
  return id;
}

export type Session = {
  id: string;
  userId: string;
  owner: string;
  kind: SessionKind;
  scope: string;
  email: string;
};

/**
 * Resolve a token, enforcing the class it was issued as.
 *
 * `expected` is what the *channel* implies: a cookie means guest, an
 * Authorization header means agent. Presenting one down the other's channel
 * fails here rather than being quietly accepted.
 */
export async function resolveSession(
  token: string | undefined,
  expected: SessionKind,
): Promise<Session | null> {
  if (!token) return null;
  const { db } = await getDatabase();

  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "sessions.id as id",
      "sessions.user_id as userId",
      "sessions.owner_id as owner",
      "sessions.kind as kind",
      "sessions.scope as scope",
      "sessions.expires_at as expiresAt",
      "sessions.revoked_at as revokedAt",
      "users.email as email",
    ])
    .where("sessions.token_hash", "=", hashSecret(token))
    .executeTakeFirst();

  if (!row) return null;
  if (row.revokedAt) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  if (row.kind !== expected) return null;

  await db
    .updateTable("sessions")
    .set({ last_seen_at: nowIso() })
    .where("id", "=", row.id)
    .execute();

  return {
    id: row.id,
    userId: row.userId,
    owner: row.owner,
    kind: row.kind as SessionKind,
    scope: row.scope ?? SESSION_SCOPE[expected],
    email: row.email,
  };
}

export async function revokeSession(id: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("sessions")
    .set({ revoked_at: nowIso() })
    .where("id", "=", id)
    .execute();
}

/** Live sessions for an owner, for the admin surface. Never returns a token. */
export async function listSessions(owner: string) {
  const { db } = await getDatabase();
  return db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "sessions.id as id",
      "sessions.kind as kind",
      "sessions.created_at as createdAt",
      "sessions.expires_at as expiresAt",
      "sessions.last_seen_at as lastSeenAt",
      "sessions.revoked_at as revokedAt",
      "users.email as email",
    ])
    .where("sessions.owner_id", "=", owner)
    .orderBy("sessions.created_at", "desc")
    .execute();
}
