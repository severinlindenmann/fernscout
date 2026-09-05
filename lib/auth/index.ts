import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
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
export type SessionKind = "guest" | "agent" | "signup" | "handover" | "identity";

/**
 * The owner column for a session that belongs to an **address** rather than to
 * a journal.
 *
 * Not a username, and it cannot become one: `USERNAME_RE` in `lib/users.ts`
 * has no `*`, so no journal can ever collide with this and no session filed
 * under it can satisfy `ownsUser` for anything real.
 *
 * It was called `SIGNUP_OWNER` while `signup` was the only kind that needed
 * it. `identity` (B410) is the second, and the old name asserted something
 * false about it — an identity is not a signup and never becomes one. The
 * property the two share is the one worth naming: neither has a journal yet,
 * for opposite reasons. A signup code has no journal because it is about to
 * create one; an identity has none because it spans all of them.
 */
export const NO_JOURNAL = "*";

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
  /**
   * A year, matching `guest`, and for the same reason — B410.
   *
   * This is the credential that says "this address has been proved", and the
   * thing it saves a reader from is re-proving it on every journal and every
   * device. A short one would put the ceremony straight back.
   *
   * A year is affordable here only because of what an identity *cannot* do.
   * It reads nothing and writes nothing: `lookUpSession` refuses it to every
   * caller asking for `"guest"` or `"agent"`, which is every gate in the
   * codebase. What it can do is be exchanged, per journal, for a session whose
   * access is re-derived from grants, `people:` and `config.json` at that
   * moment. So a year-old identity opens exactly what its holder is entitled
   * to today, not what they were entitled to when it was issued — and
   * revoking it (`revokeSession`) ends it outright, with nothing downstream
   * left holding access it was the only source of.
   */
  identity: 365 * 24 * 60 * 60 * 1000,
  // Long enough to finish the call it was issued for, short enough that a
  // token which can create journals is not lying around afterwards.
  signup: 20 * 60 * 1000,
  /**
   * Twenty minutes, for the same reason `signup` gets twenty — B283.
   *
   * This is the credential the owner's own page prints so they can paste a
   * ready-made prompt into an agent. Printing the seven-day agent token there
   * instead was the first design and this replaced it, because of the numbers
   * above: a guest cookie lasts a **year** and an agent token seven days, so a
   * page that minted the agent token directly would let a year-old read cookie
   * on a phone in a drawer issue write credentials indefinitely — the ceiling
   * would have been the cookie, not the token.
   *
   * Twenty minutes does not remove that (the cookie can still ask for
   * another). What it buys is that **nothing durable is ever displayed**: the
   * clipboard, the screenshot and the terminal scrollback all go stale, where
   * a seven-day token pasted into a chat log is a seven-day exposure.
   */
  handover: 20 * 60 * 1000,
};

export const SESSION_SCOPE: Record<SessionKind, string> = {
  agent: "write:content",
  guest: "read",
  signup: "create:journal",
  /**
   * It exchanges, and that is all it does — B283.
   *
   * Nothing reads this string to decide anything: `lookUpSession` refuses a
   * `handover` row to every caller asking for `"guest"` or `"agent"`, which is
   * every read and every write in the codebase. The scope is here so that the
   * owner's session list says what the row is for in the same vocabulary as
   * the others, and so that a future caller that *does* branch on scope cannot
   * mistake it for content access.
   */
  handover: "exchange:token",
  /**
   * It identifies, and that is all it does — B410.
   *
   * Nothing branches on this string either. It is here so an identity row
   * describes itself in the same vocabulary as the rest, and so that a future
   * caller which *does* read scope cannot mistake it for access to anything.
   * The two places an identity is deliberately let in — the handshake, and the
   * home endpoint — ask for the kind, not for this.
   */
  identity: "identity",
};

export const GUEST_COOKIE = "fs_session";

/**
 * Where the identity credential rides — B410.
 *
 * A **second** cookie rather than a wider `fs_session`, and the reason is the
 * blast radius of getting it wrong. Fourteen call sites read `fs_session` and
 * every one of them means "the person's access to the journal this request is
 * about". Teaching all fourteen that the cookie might now hold something that
 * grants nothing is fourteen chances to mishandle it; `resolveSession(token,
 * "guest")` refusing an identity token outright is none.
 *
 * httpOnly, like the other. B412 names a cache after an identity and cannot
 * read this to do it — see `public_id` in `019-identity`, which exists for
 * exactly that reason.
 */
export const IDENTITY_COOKIE = "fs_identity";

/**
 * The scope string a token that may write **one trip** carries.
 *
 * It lives here, beside `SESSION_SCOPE`, because it is the same vocabulary:
 * what a session may do. `lib/tripPeople.ts` re-exports it for the readers
 * that were already importing it from there, and reads it back with
 * `scopeAllows` and `tripWriteVerdict`.
 *
 * Written in one place so `verifyCode` can enforce the binding below without
 * building the string by hand. A scope format kept in two places is one
 * `write:trips:` typo away from a comparison that never matches — and a
 * comparison that never matches, on this path, is somebody getting more than
 * they asked for.
 */
export function tripWriteScope(tripId: string): string {
  return `write:trip:${tripId}`;
}

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
export type IssueCodeOptions = {
  /**
   * Where redeeming the link should land, when the caller knows — the page the
   * reader was looking at when they asked. Checked here as well as at
   * redemption, so a rejected value is never written down in the first place;
   * the check that matters is still the one on the way out.
   */
  destination?: string | null;
  /**
   * The trip this agent code is *for* — B230.
   *
   * The caller has already decided the address may write to it
   * (`mayRequestAgentToken`), and writing it down here is what stops that
   * decision being re-taken at redemption from a field the caller sends
   * again. A bound code can only ever mint `write:trip:<trip>`; see
   * `verifyCode`.
   *
   * Null or absent for a guest code, a signup code, and for the journal
   * owner's own unqualified agent code.
   */
  trip?: string | null;
};

export async function issueCode(
  owner: string,
  email: string,
  kind: SessionKind,
  /**
   * An object rather than two positional strings. They are both optional,
   * both nullable and both about "what else this code carries", which is
   * exactly the shape that gets called with the arguments the wrong way round.
   */
  { destination, trip }: IssueCodeOptions = {},
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
      // Only an agent token has a width to bind. A guest session reads the
      // journal it was issued for and has nothing to narrow; a signup code
      // belongs to an address rather than to a journal, so there is no trip in
      // existence for it to name.
      trip_id: kind === "agent" && trip ? trip : null,
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
  | {
      ok: true;
      token: string;
      expiresAt: string;
      scope: string;
      userId: string;
      /** The address the session was opened for, normalised. Returned because
       * a link carries no address in its URL by design (`verifyLink`), so its
       * caller has no other way to learn whose sign-in just succeeded. */
      email: string;
      /** An identity's opaque public name; null for every other kind. */
      publicId: string | null;
    }
  /**
   * `out-of-scope` is the one that is not about the six digits: the code was
   * right, and the caller asked for a session wider than the code it holds —
   * see the binding in `verifyCode`. Every caller answers all of these the
   * same way, which is the point; the reason exists for the log and the test.
   */
  | { ok: false; reason: "no-code" | "expired" | "wrong" | "burned" | "out-of-scope" };

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
 * The row a code redemption is about: the newest live, unconsumed, ordinary
 * code for this address and kind.
 *
 * One query, two readers — `verifyCode` and `pendingCodeTrip` — so the two
 * cannot end up talking about different rows. A route that decided the width
 * of a token from one row while the code was checked against another would be
 * B230 again, wearing a different shape.
 *
 * **Never the standing link's row.** This takes the newest live row and
 * assumes it is the code the person is holding, which was true while
 * `issueCode` superseded every other. A standing link breaks that assumption:
 * it lives alongside them and outlives them by design, so without the filter
 * the welcome link's row — whose code is a value nobody has ever been told —
 * is the one matched against what the person typed, and every real code fails.
 */
async function liveCodeRow(owner: string, address: string, kind: SessionKind) {
  const { db } = await getDatabase();
  return db
    .selectFrom("login_codes")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("email", "=", address)
    .where("kind", "=", kind)
    .where("consumed_at", "is", null)
    .where("link_standing", "=", 0)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

/**
 * The trip the code this address is holding was issued for — B230.
 *
 * For `/api/auth/verify`, which has to know how wide a token to ask for
 * *before* it redeems anything. The answer comes off the row rather than out
 * of the request body, which is the whole of the fix: the trip was checked
 * when the code was issued (`mayRequestAgentToken`), and re-supplying it at
 * redemption meant that check could be discarded by leaving the field out.
 *
 * Null means the code is not bound to a trip — the journal owner's own agent
 * code, or a guest code — and null is not an authorisation. The caller still
 * has to establish that whoever is redeeming may hold a journal-wide token;
 * see the verify route.
 *
 * Expiry is not checked here. A stale row's trip is still the right answer to
 * "how wide", and the code it belongs to is refused a moment later anyway.
 */
export async function pendingCodeTrip(
  owner: string,
  email: string,
  kind: SessionKind,
): Promise<string | null> {
  const row = await liveCodeRow(owner, normaliseEmail(email), kind);
  return row?.trip_id ?? null;
}

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
  /** The browser redeeming it, for a credential that becomes a cookie. Only
   * the identity flow passes one — see `openIdentitySession`. */
  userAgent?: string | null,
): Promise<VerifyResult> {
  const { db } = await getDatabase();
  const address = normaliseEmail(email);

  const row = await liveCodeRow(owner, address, kind);

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

  /**
   * **The code decides how wide the token is, not the caller.** B230.
   *
   * A code issued for a trip can mint one thing: that trip's write scope. The
   * caller may pass it (and the verify route does, having worked it out from
   * the same row) or pass nothing at all, and either way this is what it gets.
   * Asking for something else is refused rather than honoured — and refused
   * *before* the code is consumed, so a caller that sent the wrong body can
   * fix it and try again with the code the person is still holding.
   *
   * The check the route makes is the same check; this one is the one that
   * cannot be forgotten. Whether the address is still on the trip is asked at
   * every write instead, by `tripWriteVerdict` — B98 — because a token
   * outlives the answer.
   */
  const bound = kind === "agent" ? row.trip_id : null;
  if (bound && scope && scope !== tripWriteScope(bound)) {
    return { ok: false, reason: "out-of-scope" };
  }
  const granted = bound ? tripWriteScope(bound) : scope;

  // Redeeming the code retires the link along with it: the reader is in, and
  // the weaker credential has no reason to stay live in someone's inbox.
  await db
    .updateTable("login_codes")
    .set({ consumed_at: nowIso(), link_consumed_at: nowIso() })
    .where("id", "=", row.id)
    .execute();

  return openSession(owner, address, kind, granted, userAgent?.slice(0, 300) ?? null);
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
      // Both link-only credentials are guest sessions, which read and have
      // nothing to narrow.
      trip_id: null,
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
 * **Two callers, and both of them have already proved the address.**
 *
 * `POST /api/v1/journals`: the address was proved by the signup code, and
 * sending its owner back for a second code — to a journal created a
 * millisecond ago, by them — would be ceremony rather than security.
 *
 * `POST /api/auth/handover` (B283): the address was proved when the owner
 * signed in, and again by holding a `handover` credential their own page
 * printed twenty minutes ago at most. That call spends the handover session by
 * doing this, so the exchange happens once.
 *
 * Nothing else may use this. Every other path goes through a code, and the
 * two exceptions above are the two places where a code has *just* been used.
 */
export async function openAgentSession(
  owner: string,
  email: string,
): Promise<{ token: string; expiresAt: string }> {
  const result = await openSession(owner, email, "agent");
  if (!result.ok) throw new Error("could not open an agent session");
  return { token: result.token, expiresAt: result.expiresAt };
}

/**
 * The twenty-minute credential the owner's own page prints — B283.
 *
 * What an owner is handed to start an agent used to be two lines and a
 * promise: a URL, their email address, and the expectation that the agent
 * would ask for a six-digit code which they would then read out. This replaces
 * the reading-out, not the proving: the owner is already signed in, and this
 * turns that into something pasteable.
 *
 * It can do exactly one thing — be exchanged, at `POST /api/auth/handover`,
 * for a seven-day agent token. It is refused on every content route, because
 * `lookUpSession` compares `kind` against what the caller asked for and every
 * read and write in this codebase asks for `"guest"` or `"agent"`. That is the
 * property that makes a fourth kind safe to add: a new kind is refused
 * everywhere by default, and has to be let in deliberately, once.
 *
 * The caller establishes that this is the journal's owner — `isOwner`, cookie
 * or bearer, the same guard the invite endpoint uses. Never a guest, and never
 * somebody on a trip: a buddy holds a trip-scoped token and gets it the way
 * they got it before.
 */
export async function issueHandover(
  owner: string,
  email: string,
): Promise<{ token: string; expiresAt: string }> {
  const result = await openSession(owner, email, "handover");
  if (!result.ok) throw new Error("could not open a handover session");
  return { token: result.token, expiresAt: result.expiresAt };
}

/**
 * Spend a handover credential for the agent token it stands for — B283.
 *
 * Revoked before the agent session is opened rather than after, so a failure
 * between the two leaves the handover spent and no token issued. That is the
 * safe direction to fail: the owner presses the button again, where the other
 * order would leave a live handover credential beside a live agent token and
 * no record of which call had actually succeeded.
 */
export async function exchangeHandover(
  session: Session,
): Promise<{ token: string; expiresAt: string }> {
  await revokeSession(session.id);
  return openAgentSession(session.owner, session.email);
}

/** Mint the session every redemption path ends at. */
async function openSession(
  owner: string,
  address: string,
  kind: SessionKind,
  scope?: string,
  /** The browser a session was opened on, where the caller knows it. Null for
   * every path where the credential is not a cookie — an agent token is held
   * by a program, and its user agent says nothing about a person. */
  userAgent: string | null = null,
): Promise<VerifyResult> {
  const { db } = await getDatabase();
  const userId = await upsertUser(owner, address);
  const token = generateToken(kind);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS[kind]).toISOString();
  const granted = kind === "agent" && scope ? scope : SESSION_SCOPE[kind];

  /**
   * An identity's opaque public name, minted here so that **every** path that
   * creates one gets it — the identity code flow goes through `verifyCode`,
   * and the three side doors go through `openIdentitySession`, and both end
   * here. Generating it in either caller instead left the other minting rows
   * with a null name, which the device list then had to filter and B412 could
   * not key a cache by.
   *
   * Random rather than derived from the address: a hash of an email is not an
   * opaque id, it is the email, to anybody holding candidates to hash.
   */
  const publicId = kind === "identity" ? crypto.randomBytes(16).toString("hex") : null;

  await db
    .insertInto("sessions")
    .values({
      id: crypto.randomUUID(),
      owner_id: owner,
      user_id: userId,
      kind,
      token_hash: hashSecret(token),
      scope: granted,
      public_id: publicId,
      created_at: nowIso(),
      expires_at: expiresAt,
      last_seen_at: null,
      revoked_at: null,
      user_agent: userAgent,
      ip: null,
    })
    .execute();

  return { ok: true, token, expiresAt, scope: granted, userId, email: address, publicId };
}

/**
 * The identity credential itself — B410.
 *
 * Filed under `NO_JOURNAL`, because it is about an address and the instance
 * rather than about any one journal. It authorises nothing: what it is *for*
 * is `resolveAccess` in `lib/auth/handshake.ts`, and B411's home endpoint.
 *
 * **Every caller has already proved the address**, and there are two shapes of
 * proof. The identity code flow proves it directly. Every existing journal
 * sign-in — a guest code, a sign-in link, a contact confirmation — proves the
 * same address for a journal, and proving it for one journal proves it. That
 * second door is deliberate and is what makes this reach people who already
 * read this site without a new flow for them to discover; it is safe because
 * an identity opens nothing by itself, and each journal's access is re-derived
 * from grants, `people:` and `config.json` at the moment it is asked for.
 */
export async function openIdentitySession(
  email: string,
  /**
   * The browser this was proved on, for the device list — B411.
   *
   * Stored because the list is otherwise unusable: every row reads "unknown
   * device" and somebody trying to sign out the phone they lost has no way to
   * tell which row is which. Truncated, because it is an untrusted header that
   * goes into a column and onto a page, and no honest user agent is 300
   * characters.
   */
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: string; publicId: string }> {
  const result = await openSession(
    NO_JOURNAL,
    normaliseEmail(email),
    "identity",
    undefined,
    userAgent?.slice(0, 300) ?? null,
  );
  if (!result.ok || !result.publicId) throw new Error("could not open an identity session");
  return { token: result.token, expiresAt: result.expiresAt, publicId: result.publicId };
}

/** Every device this address has proved itself on, newest first. Never returns
 * a token; `public_id` is the opaque name B412 keys a cache by. */
export async function listIdentities(email: string) {
  const { db } = await getDatabase();
  return db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "sessions.id as id",
      "sessions.public_id as publicId",
      "sessions.created_at as createdAt",
      "sessions.expires_at as expiresAt",
      "sessions.last_seen_at as lastSeenAt",
      "sessions.user_agent as userAgent",
    ])
    .where("sessions.kind", "=", "identity")
    .where("sessions.owner_id", "=", NO_JOURNAL)
    .where("sessions.revoked_at", "is", null)
    .where("users.email", "=", normaliseEmail(email))
    .orderBy("sessions.created_at", "desc")
    .execute();
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
  /** An identity's opaque public name, and null on every other kind. Safe to
   * return in a response body; never accepted as authentication. B412 names a
   * service worker cache after it. */
  publicId: string | null;
};

/**
 * Resolve a token, enforcing the class it was issued as.
 *
 * `expected` is what the *channel* implies: a cookie means guest, an
 * Authorization header means agent. Presenting one down the other's channel
 * fails here rather than being quietly accepted.
 *
 * Wrapped in `cache()` below. Everything this function does — including the
 * kind check that is decision 24 — happens on the first call of a request and
 * is what the rest of that request is handed.
 */
async function lookUpSession(
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
      "sessions.public_id as publicId",
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
    publicId: row.publicId,
  };
}

/**
 * The same lookup, memoised for the duration of one request. B53.
 *
 * It is not a read. It ends in `UPDATE sessions SET last_seen_at`, so every
 * call is a write transaction — and one page render for a signed-in reader
 * looking at a gated trip called it five times, from five call sites that all
 * legitimately need to know who is asking: the layout's `signedIn` flag,
 * `listableTrips`, `isJournalGuest` from inside it, `isTravellerOn` from
 * `mayReadTrip`, and `isJournalGuest` again from the same place. Five indexed
 * queries are invisible on SQLite with one reader and are not on Postgres with
 * fifty. No call site changed; none of them knows this is here.
 *
 * **`cache()` is per request and nothing else, which is the only reason it is
 * safe here.** Three properties, and all three are load-bearing:
 *
 * - **It cannot outlive a request.** `cache` reads a dispatcher off React's
 *   internals; Next installs one per request and it goes with the request.
 *   There is no module-level map here and there must never be one — a session
 *   revoked on `/<user>/me` has to stop working on the next page view, not on
 *   the next deploy.
 * - **It cannot blur the wall between the two credentials.** `expected` is the
 *   second argument, and `cache` keys on *every* argument, so
 *   `(token, "guest")` and `(token, "agent")` are separate entries that never
 *   see each other's answer. The `row.kind !== expected` check is still run for
 *   each of them. An agent bearer token presented as a cookie is refused
 *   before and after this change, and `test/session-cache.test.ts` asserts it
 *   in both directions.
 * - **Outside a request it does nothing at all.** With no dispatcher installed
 *   — a script, a background job, the test suite — React's server build calls
 *   straight through and memoises nothing. That is what keeps
 *   `test/access-gate.test.ts` honest: it flips the mocked cookie jar between
 *   assertions in one process, and a cache that survived that would answer the
 *   previous viewer's question.
 *
 * `last_seen_at` is still written, once per request rather than five times.
 * That column is what the owner's sessions list shows, and one stamp per page
 * view is what it was always meant to mean.
 */
export const resolveSession = cache(lookUpSession);

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
