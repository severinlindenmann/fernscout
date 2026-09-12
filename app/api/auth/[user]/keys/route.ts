import { describeScope, listSessions, resolveSession, revokeSession, type Session } from "@/lib/auth";
import { resolveAccess } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * The keys that can write to this journal, and how to kill one — B283, moved
 * to `/api/auth` from `/api/v1/{user}/keys` for v2 (`docs/plans/2026-09-12-api-v2/auth.md`
 * §2.7). **Kept as one mixed door on purpose**: §2.7 itself argues for
 * splitting an owner door from a `keys/mine` door, and calls that split its
 * own weakest cut; `docs/v2-migration/00-decisions.md` Q1 answers it — the
 * owner decided to keep the one door B323 already shipped rather than pay a
 * second route for a shape that has never actually confused anyone.
 *
 * A credential a person cannot revoke is one they cannot hand out carefully.
 * The handover block makes handing an agent a write token a two-second act, so
 * taking it back has to be one too — otherwise the honest advice would be
 * "only do this if you are sure", which is advice nobody can act on.
 *
 * ## What is listed, and what is not
 *
 * Only what can **write**: live `agent` tokens, and live `handover`
 * credentials that have not been spent yet. Deliberately not `guest` sessions
 * — those are the owner's own browsers, they cannot change anything, and
 * mixing "your phone" into a list whose button is "revoke" invites somebody to
 * sign themselves out of their own journal while trying to kill an agent's
 * key. Signing out is its own control, at the bottom of the same page.
 *
 * Never the tokens themselves. Only hashes were stored, so there is nothing
 * here to leak; an id is what revoking needs and all it needs.
 *
 * ## The one shape change from v1
 *
 * v1 echoed `row.scope` raw on the wire — `"write:content"` or
 * `"write:trip:alps-2026"`, the internal `SESSION_SCOPE`/`tripWriteScope`
 * vocabulary. v2 answers `describeScope()`'s translation instead: a flat
 * `scope: "owner" | "trip"` plus `trip` when it is one, the same shape
 * `GET /api/v2/{user}/status` puts on `token.scope`/`token.trip`. One
 * function does the translation now, so "what can this credential do" has one
 * answer regardless of which door asked (auth.md §3). `kind` follows the
 * same rename the rest of this area's wire vocabulary got (`CREDENTIAL_FOR`,
 * `"guest"/"agent"` → `"read"/"write"`, §2.1): a live `agent` session is a
 * `"write"` key on the wire. `"handover"` keeps its own name rather than
 * becoming a third `for` value — it was never one; it is minted and
 * exchanged by its own pair of routes and never redeemed from a code.
 */

/** `SessionKind` → the wire word for `keys[].kind`. Only `agent` and
 * `handover` ever reach here (`live()` below filters everything else). */
function kindOnWire(kind: "agent" | "handover"): "write" | "handover" {
  return kind === "agent" ? "write" : "handover";
}

/**
 * Either an owner — who sees and may revoke every row — or a caller who has
 * proved a particular address and may see and revoke only rows issued to it.
 */
type Caller = { owner: true } | { owner: false; email: string };

/**
 * The address a non-owner caller has proved, from whichever credential
 * carries it — B323.
 *
 * `resolveAccess` covers a guest cookie or a year-long identity, which is
 * how a reader signed in on `/{user}/me` is recognised. A buddy driving an
 * agent instead presents a trip-scoped **bearer** token, so that is checked
 * too, the same way `isOwner`'s own admin fallback does. Either way what
 * comes back is an address, never a scope — the filter below is "this row's
 * address", not "this row's trip".
 */
async function callerEmail(user: string, request: Request): Promise<string | null> {
  const { email } = await resolveAccess(user);
  if (email) return email;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const agent = await resolveSession(bearer, "agent");
  return agent && agent.owner === user ? agent.email : null;
}

/**
 * **Ownership before capability, on purpose — B340.** `isOwner` answers
 * false alike for a journal that does not exist and one that exists but is
 * not this caller's, which is the property that matters: everyone who is not
 * this journal's proven owner gets the same `forbidden`, so the shape of the
 * refusal cannot be used to learn whether a name is a real journal (B117's
 * rule, one level up). Only once ownership is proven — which by construction
 * means the journal is real — is the capability checked, and a caller who has
 * already shown they own it is told the real reason rather than a 404.
 *
 * **A non-owner is not turned away — B323.** Somebody on a trip who has
 * proved their own address may see and revoke the keys issued *to that
 * address*, and nothing else; `?email=` or any other parameter is never
 * consulted, so a caller cannot ask to be shown somebody else's rows. Only a
 * caller who has proved no address at all — no cookie, no identity, no
 * bearer token for this journal — gets the owner's `forbidden`.
 */
async function guard(user: string, request: Request): Promise<Caller | Response> {
  const owner = await isOwner(user, request);
  const email = owner ? null : await callerEmail(user, request);
  if (!owner && !email) {
    return fail(
      "forbidden",
      "Sign in, or hold a key for this journal, to see or revoke the keys issued to your own address.",
    );
  }
  if (!isEnabled("auth", user)) {
    return fail(
      "auth_disabled",
      ERROR_CODES.auth_disabled,
      undefined,
      409,
    );
  }
  return owner ? { owner: true } : { owner: false, email: email! };
}

/** Whether a row is a key that could still be used right now. */
function live(row: { kind: string; revokedAt: string | null; expiresAt: string }): boolean {
  if (row.kind !== "agent" && row.kind !== "handover") return false;
  if (row.revokedAt) return false;
  return new Date(row.expiresAt).getTime() > Date.now();
}

/** `describeScope` takes a full `Session`; `listSessions` only selects the
 * two fields it actually reads (`scope`, `expiresAt`). The smallest adapter,
 * rather than a second copy of the `write:trip:` prefix parsing. */
function scopeOf(row: { scope: string; expiresAt: string }): { scope: "owner" | "trip"; trip?: string } {
  const described = describeScope({ scope: row.scope, expiresAt: row.expiresAt } as Session);
  return described.trip !== undefined ? { scope: described.scope, trip: described.trip } : { scope: described.scope };
}

export async function GET(request: Request, { params }: RouteContext<"/api/auth/[user]/keys">) {
  const { user } = await params;
  const caller = await guard(user, request);
  if (caller instanceof Response) return caller;

  const rows = (await listSessions(user)).filter(live);
  // A non-owner's own rows only — the server does the filtering, from the
  // proven address, never from anything the request asked for. This is the
  // whole security point of B323: a person on a trip must not be able to
  // enumerate anybody else's keys, including the owner's.
  const visible = caller.owner ? rows : rows.filter((row) => row.email === caller.email);

  return ok({
    user,
    keys: visible.map((row) => ({
      id: row.id,
      kind: kindOnWire(row.kind as "agent" | "handover"),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      // When it was last used, which is the field that tells whoever is
      // looking whether a key they have forgotten about is one somebody is
      // still holding.
      lastSeenAt: row.lastSeenAt,
      // What it may write, translated — never the raw `write:trip:…` string.
      ...scopeOf(row),
      // The address the row belongs to. Only the owner is shown this — a
      // non-owner's list is already filtered to their own address, so
      // repeating it back would say nothing a second row could not.
      ...(caller.owner ? { email: row.email } : {}),
    })),
  });
}

/**
 * Revoke one.
 *
 * `POST` with an id rather than `DELETE` on a per-id path, because the control
 * is a button on a page reached with a `SameSite=lax` cookie and this keeps it
 * one route. `revokeSession` is idempotent and says nothing about whether the
 * row existed — an id that is not this journal's is checked below, because
 * "revoked" for somebody else's session would be a very quiet way to break
 * another journal.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/auth/[user]/keys">) {
  const { user } = await params;
  const caller = await guard(user, request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.revoke === "string" ? body.revoke : "";
  if (!id) {
    return fail("invalid_request", 'Send {"revoke": "<key id>"}.', undefined, 400);
  }

  // Scoped to this journal's own rows, and — for a non-owner — to their own
  // address too. Without the first check, an owner of one journal could
  // revoke a session belonging to another on the same instance by passing
  // its id; without the second, a buddy could revoke anybody's key by
  // guessing its (unguessable, but unchecked is still unchecked) id.
  const row = (await listSessions(user)).find((candidate) => candidate.id === id);
  if (!row || (!caller.owner && row.email !== caller.email)) {
    return fail("unknown_key", ERROR_CODES.unknown_key, undefined, 404);
  }

  await revokeSession(id);
  return ok({ ok: true, revoked: id });
}
