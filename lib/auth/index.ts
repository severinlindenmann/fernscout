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
 * code is written under the content root — `content/<user>/mail/`, or
 * `content/.mail/` for a signup code, which belongs to no journal yet — and
 * printed to the console, and `AUTH_DEV_CODE` fixes it outright for end-to-end
 * tests.
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

/**
 * How long a one-time code stays valid.
 *
 * Thirty minutes, not ten. Ten was a window sized for somebody with a password
 * manager open; this journal is read by people who have to notice the mail,
 * find it — possibly in spam — open it on a phone, and read six digits across
 * to a laptop. Being locked out of your own journal because you took twelve
 * minutes is a worse outcome than the exposure below.
 *
 * What the window costs is bounded and specific: it is how long a *leaked*
 * mail stays useful — a shared inbox, a forwarded message, somebody reading
 * over a shoulder. It is not what stops guessing; see `generateCode`.
 */
export const CODE_TTL_MS = 30 * 60 * 1000;

/**
 * The same number, for the sentences that tell somebody about it.
 *
 * Published from the constant that enforces it, the way the media limits in
 * `/agent.md` are. Ten minutes was written out in words across three locale
 * files, four mail bodies and half a dozen comments; changing the constant
 * would have left every one of them lying, and the person who noticed would
 * have been a reader whose code had already expired.
 */
export const CODE_TTL_MINUTES = String(CODE_TTL_MS / 60_000);
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
 * Six digits is 20 bits, and what makes that safe is the **attempt counter**,
 * not the clock: a code burns after `MAX_CODE_ATTEMPTS` wrong guesses whatever
 * the window is, and `/api/auth/verify` is rate-limited per address on top.
 * Five guesses against a million possibilities is the protection.
 *
 * This comment used to say the ten-minute expiry was what made it safe, which
 * would have made `CODE_TTL_MS` look like a security parameter that could not
 * be moved. It is not one — it bounds how long a leaked mail stays useful, and
 * it was lengthened to thirty minutes for people rather than shortened for
 * attackers.
 *
 * Generated with rejection sampling rather than a modulo, so every code is
 * equally likely.
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

/** The longest destination worth keeping. Real ones are a trip id or a day
 * slug; anything past this is somebody filling a column. */
const MAX_DESTINATION = 512;

/** A base no host on earth resolves to, used only to normalise a path. */
const NOWHERE = "https://fernscout.invalid";

/**
 * The one place that decides whether a stored destination may be redirected to.
 *
 * **A redirect target is only ever as safe as the check in front of it.** The
 * value reaching here was written by whoever filled in the sign-in form, so it
 * is attacker input with a delay on it, and the failure to avoid is a link
 * that signs somebody in and then forwards them to a page dressed up as this
 * journal. That is strictly worse than the papercut this exists to fix.
 *
 * Two questions, both of which must answer yes:
 *
 * 1. **Is it a path on this origin?** It must start with a single `/` — no
 *    scheme, no `//host` and no `/\host`, both of which browsers read as
 *    protocol-relative. It is then resolved against a base that exists
 *    nowhere, and the result must still be on that base: a `..` segment, or
 *    the `%2e%2e` the URL parser also treats as one, can otherwise climb out
 *    of the journal after every string check has passed.
 * 2. **Is it inside this journal?** `/<username>` exactly, or `/<username>/…`.
 *    A username is a directory name and therefore a boundary, so one reader's
 *    sign-in cannot land inside somebody else's journal — the account taking
 *    a username being the way that would be arranged.
 *
 * Query strings and fragments are dropped rather than validated. Nothing that
 * sets a destination has one, and a redirect is not the place to find out
 * which parameters a page will act on.
 *
 * Returns the path to redirect to, or null — and null means the journal home,
 * which is where this always went.
 */
export function safeDestination(username: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > MAX_DESTINATION) return null;
  if (!raw.startsWith("/")) return null;
  // Whitespace, control characters and backslashes: none belongs in a path we
  // wrote, and each is a way of confusing one parser while satisfying another.
  if (/[\s\\]/.test(raw)) return null;
  if ([...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("?") || raw.includes("#")) return null;
  if (!username || username.includes("/")) return null;

  let url: URL;
  try {
    url = new URL(raw, NOWHERE);
  } catch {
    return null;
  }
  if (url.origin !== NOWHERE) return null;

  const path = url.pathname;
  const prefix = `/${username}`;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  return path;
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
 * Consume every live code for an address, without issuing a new one.
 *
 * Two callers. `issueCode` uses it so that asking for a new code always
 * invalidates the old — otherwise a forwarded email from half an hour ago would
 * still work. And a route whose mail failed to send uses it to take back the
 * code it just wrote: the alternative is a live code that nobody was ever told,
 * sitting there until it expires, having silently invalidated the one the
 * person may still have in their inbox from a previous attempt.
 */
export async function revokeCodes(
  owner: string,
  email: string,
  kind: SessionKind,
): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("login_codes")
    .set({ consumed_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("email", "=", normaliseEmail(email))
    .where("kind", "=", kind)
    .where("consumed_at", "is", null)
    // Standing links survive. Without this, the welcome mail's permanent link
    // would die the first time its owner asked for an ordinary sign-in code —
    // which is the most likely thing to happen next, and would make
    // "permanent" untrue in exactly the case it was added for.
    .where("link_standing", "=", 0)
    .execute();
}

/**
 * Issue a login code for an address.
 *
 * Any previously live code for the same address and kind is consumed first —
 * see `revokeCodes`.
 */
export async function issueCode(
  owner: string,
  email: string,
  kind: SessionKind,
  /**
   * Where redeeming the link should land, when the caller knows — the page the
   * reader was looking at when they asked. Checked here as well as at
   * redemption, so a rejected value is never written down in the first place;
   * the check that matters is still the one on the way out.
   */
  destination?: string | null,
): Promise<IssuedCode> {
  const { db } = await getDatabase();
  const address = normaliseEmail(email);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  await revokeCodes(owner, email, kind);

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
      // No link, nowhere to land. An agent code that carried a destination
      // would be a path nothing ever reads, kept where a reader's browsing
      // shows up in a database dump.
      link_dest: linkToken ? safeDestination(owner, destination) : null,
      kind,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      consumed_at: null,
      // Stated rather than left to the column default. An ordinary code's link
      // expires with it, and that is a property worth being able to read here
      // instead of inferring from a migration.
      link_standing: 0,
      attempts: 0,
    })
    .execute();

  return { code, expiresAt, linkToken };
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: string; scope: string; userId: string }
  | { ok: false; reason: "no-code" | "expired" | "wrong" | "burned" };

/**
 * What redeeming a *link* gives you: a session, plus where to send the reader.
 *
 * `destination` is a path inside this journal or null, never a URL and never a
 * value the caller may substitute — see `safeDestination`. Null means the
 * journal's front page.
 */
export type VerifyLinkResult =
  | (Extract<VerifyResult, { ok: true }> & { destination: string | null })
  | Extract<VerifyResult, { ok: false }>;

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
    /**
     * Never the standing link's row.
     *
     * This lookup takes the newest live row and assumes it is the code the
     * person is holding, which was true while `issueCode` superseded every
     * other. A standing link breaks that assumption: it lives alongside them
     * and outlives them by design, so without this the welcome link's row —
     * whose code is a value nobody has ever been told — is the one that gets
     * matched against what the person typed, and every real code fails.
     */
    .where("link_standing", "=", 0)
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
 * A sign-in link with no code beside it and no expiry, for the welcome mail.
 *
 * The ordinary flow issues a code and hangs a link off it, because the person
 * asked to sign in and may prefer to type. Here nobody asked for anything —
 * they are being told their journal exists — so there are no six digits to
 * read out, and a link that expired in half an hour would be one they never
 * used.
 *
 * Deliberately **not** an option on `issueCode`. That function's contract is
 * "supersede whatever code this address had"; this one must not, and folding
 * two opposite behaviours into one function behind a boolean is how the next
 * person calls it wrongly.
 *
 * The row still needs a `code_hash` — the column is `NOT NULL` and the schema
 * is shared. It gets the hash of a token that is generated, never returned and
 * never sent, so there is no code in existence that could redeem this row and
 * retire its link. That is the intended state, not a workaround: `verifyCode`
 * has nothing to match.
 */
export async function issueStandingLink(owner: string, email: string): Promise<string> {
  return insertLinkRow(owner, email, { standing: true, ttlMs: CODE_TTL_MS });
}

/**
 * How long a link an agent hands over stays usable.
 *
 * The person is in a conversation when they receive it; they follow it in the
 * next minute or they do not follow it at all. Fifteen is generous for that and
 * short enough that the copy left behind in a transcript is worthless by the
 * time anybody reads the log — which is the whole reason this is not simply
 * another standing link.
 */
export const RELAY_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * A sign-in link for an agent to pass to the person whose journal it is.
 *
 * The welcome mail's link goes to an inbox and waits there; this one goes into
 * a chat window, so that the natural end of "I have written your three days"
 * can be "here, look" rather than "go and find an email".
 *
 * **Deliberately not standing.** The author's decision (B29) was that an agent
 * may carry an authentication URL, and the reasoning that made it safe is that
 * the agent already holds a strictly more powerful credential for the same
 * journal. What is new is that something belonging to the *person* passes
 * through a transcript — and a transcript outlives the conversation. So this
 * expires in `RELAY_LINK_TTL_MS`, and it is still single use, which together
 * mean the logged copy is spent long before it is read.
 *
 * A separate function rather than a flag on `issueStandingLink`, because the
 * two differ in exactly the property that matters and a boolean argument is
 * how somebody eventually passes the wrong one.
 */
export async function issueRelayLink(owner: string, email: string): Promise<string> {
  return insertLinkRow(owner, email, { standing: false, ttlMs: RELAY_LINK_TTL_MS });
}

/**
 * The row both link-only credentials share.
 *
 * Neither has a code beside it: nobody asked to sign in, so there are no six
 * digits for anybody to type. The `code_hash` is the hash of a token that is
 * generated, never returned and never sent — the column is `NOT NULL` and the
 * schema is shared — so no code exists that could redeem the row and retire
 * its link. `verifyCode` skips these rows anyway; see the note there.
 */
async function insertLinkRow(
  owner: string,
  email: string,
  { standing, ttlMs }: { standing: boolean; ttlMs: number },
): Promise<string> {
  const { db } = await getDatabase();
  const linkToken = generateLinkToken();

  await db
    .insertInto("login_codes")
    .values({
      id: crypto.randomUUID(),
      owner_id: owner,
      email: normaliseEmail(email),
      code_hash: hashSecret(generateLinkToken()),
      link_hash: hashSecret(linkToken),
      link_consumed_at: null,
      // Neither of these is sent from a page, so neither has a page to return
      // to. The welcome mail's link and the relay link both open the journal.
      link_dest: null,
      kind: "guest",
      created_at: nowIso(),
      // Read for a relay link, and the thing that makes it expire. For a
      // standing link it is never read — written because the column is NOT
      // NULL, and set to the ordinary window so anything that does look at it
      // treats the row as stale rather than as live for ever.
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      consumed_at: null,
      link_standing: standing ? 1 : 0,
      attempts: 0,
    })
    .execute();

  return linkToken;
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
): Promise<VerifyLinkResult> {
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

  // A standing link — the welcome mail's — has no expiry to check. It is the
  // owner's first way into their own journal and may be opened a week later.
  // What bounds it is `link_consumed_at` above: still single use, so the first
  // fetch retires it. See `006-standing-link`.
  if (row.link_standing !== 1 && new Date(row.expires_at).getTime() < Date.now()) {
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

  const session = await openSession(owner, row.email, kind);
  if (!session.ok) return session;

  /**
   * Checked here, on the way out, against the username the link was redeemed
   * for — not when it was stored. The stored value is the input; anything
   * that could put a row in this table (a future bug, a restored dump, a
   * migration written in a hurry) would otherwise be handed a redirect.
   */
  return { ...session, destination: safeDestination(owner, row.link_dest) };
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
