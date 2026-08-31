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

/**
 * `signup` is the odd one out and deliberately so: it belongs to an address
 * rather than to a journal, because at the moment it is issued there is no
 * journal for it to belong to. It can do exactly one thing — create one — and
 * it expires in twenty minutes.
 */
export type SessionKind = "guest" | "agent" | "signup";

/**
 * The owner a signup code is filed under.
 *
 * Not a username, and it cannot become one: `USERNAME_RE` in `lib/users.ts`
 * has no `*`, so no journal can ever collide with this and no session issued
 * here can satisfy `ownsUser` for anything real.
 */
export const SIGNUP_OWNER = "*";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

/** Seven days for write, a year for read — decision 24. */
export const SESSION_TTL_MS: Record<SessionKind, number> = {
  agent: 7 * 24 * 60 * 60 * 1000,
  guest: 365 * 24 * 60 * 60 * 1000,
  // Long enough to finish the call it was issued for, short enough that a
  // token which can create journals is not lying around afterwards.
  signup: 20 * 60 * 1000,
};

export const SESSION_SCOPE: Record<SessionKind, string> = {
  agent: "write:content",
  guest: "read",
  signup: "create:journal",
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

/**
 * The token in a one-click sign-in link.
 *
 * 32 bytes, url-safe, and — unlike the six-digit code — not guessable at all.
 * It has to carry the whole identification on its own: the URL deliberately
 * holds no email address, so that a link forwarded or pasted somewhere public
 * does not also disclose who reads this journal.
 */
export function generateLinkToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Where a sign-in link points. One place, so the mail and the route cannot
 * disagree about the shape of it. */
export function signInUrl(base: string, username: string, linkToken: string): string {
  return `${base.replace(/\/$/, "")}/${username}/s/${linkToken}`;
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

export type IssuedCode = {
  code: string;
  expiresAt: string;
  /** Present for guest codes only. An agent has no browser to sign in. */
  linkToken?: string;
};

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
  // Only a guest code gets a link. An agent token is handed back through the
  // API to a program with no cookie jar; a URL that quietly creates a browser
  // session is the wrong shape of credential to mail one.
  const linkToken = kind === "guest" ? generateLinkToken() : undefined;
  await db
    .insertInto("login_codes")
    .values({
      id: crypto.randomUUID(),
      owner_id: owner,
      email: address,
      code_hash: hashSecret(code),
      link_hash: linkToken ? hashSecret(linkToken) : null,
      link_consumed_at: null,
      kind,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      consumed_at: null,
      attempts: 0,
    })
    .execute();

  return { code, expiresAt, linkToken };
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

  // Redeeming the code retires the link along with it: the reader is in, and
  // the weaker credential has no reason to stay live in someone's inbox.
  await db
    .updateTable("login_codes")
    .set({ consumed_at: nowIso(), link_consumed_at: nowIso() })
    .where("id", "=", row.id)
    .execute();

  return openSession(owner, address, kind, scope);
}

/**
 * Redeem a one-click sign-in link.
 *
 * The token is the whole key: there is no address in the URL to check it
 * against, which is the point — a link that named its recipient would turn a
 * forwarded email into a statement about who reads this journal.
 *
 * Unlike `verifyCode` this consumes only the link, leaving the six-digit code
 * live. A mail scanner that follows the URL before the reader has opened the
 * message therefore costs them the button, not the sign-in.
 */
export async function verifyLink(
  owner: string,
  linkToken: string,
  kind: SessionKind = "guest",
): Promise<VerifyResult> {
  const { db } = await getDatabase();

  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("kind", "=", kind)
    .where("link_hash", "=", hashSecret(linkToken.trim()))
    .where("link_consumed_at", "is", null)
    // A code redeemed by hand consumes the row, and this link with it.
    .where("consumed_at", "is", null)
    .executeTakeFirst();

  // No attempt counter here, and none needed: the token is 256 bits, so there
  // is nothing to brute-force and nothing an attempt count would protect.
  if (!row) return { ok: false, reason: "no-code" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db
      .updateTable("login_codes")
      .set({ link_consumed_at: nowIso() })
      .where("id", "=", row.id)
      .execute();
    return { ok: false, reason: "expired" };
  }

  await db
    .updateTable("login_codes")
    .set({ link_consumed_at: nowIso() })
    .where("id", "=", row.id)
    .execute();

  return openSession(owner, row.email, kind);
}

/**
 * An agent session for a journal, without a code round trip.
 *
 * The one caller is `POST /api/v1/journals`: the address has just been proved
 * by the signup code, and sending its owner back for a second code — to a
 * journal created a millisecond ago, by them — would be ceremony rather than
 * security. Nothing else may use this; every other path goes through a code.
 */
export async function openAgentSession(
  owner: string,
  email: string,
): Promise<{ token: string; expiresAt: string }> {
  const result = await openSession(owner, email, "agent");
  if (!result.ok) throw new Error("could not open a session for a journal just created");
  return { token: result.token, expiresAt: result.expiresAt };
}

/** Mint the session both redemption paths end at. */
async function openSession(
  owner: string,
  address: string,
  kind: SessionKind,
  scope?: string,
): Promise<VerifyResult> {
  const { db } = await getDatabase();
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
