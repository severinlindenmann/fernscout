import { listSessions, resolveSession, revokeSession } from "@/lib/auth";
import { resolveAccess } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";

export const dynamic = "force-dynamic";

/**
 * The keys that can write to this journal, and how to kill one — B283.
 *
 * A credential a person cannot revoke is one they cannot hand out carefully.
 * The handover block makes handing an agent a write token a two-second act, so
 * taking it back has to be one too — otherwise the honest advice would be
 * "only do this if you are sure", which is advice nobody can act on.
 *
 * `listSessions` has existed since W06 and had no caller until now.
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
 */

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
 * this journal's proven owner gets the same `403`, so the shape of the
 * refusal cannot be used to learn whether a name is a real journal (B117's
 * rule, one level up). Only once ownership is proven — which by construction
 * means the journal is real — is the capability checked, and a caller who has
 * already shown they own it is told the real reason rather than `404`: they
 * are not a stranger an existence oracle could help, and `/api/health` cannot
 * answer this for them, since a per-journal narrowing needs an operator's
 * `HEALTH_TOKEN` to read back, not an owner's own agent token.
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
    return Response.json(
      {
        error: "forbidden",
        message:
          "Sign in, or hold a key for this journal, to see or revoke the keys issued to " +
          "your own address.",
      },
      { status: 403 },
    );
  }
  if (!isEnabled("auth", user)) {
    return Response.json(
      {
        error: "auth_disabled",
        message:
          "This journal does not have sign-in switched on, so there are no keys to list or " +
          "revoke. /api/health says which capabilities are on.",
      },
      { status: 409 },
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

export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/keys">) {
  const { user } = await params;
  const caller = await guard(user, request);
  if (caller instanceof Response) return caller;

  const rows = (await listSessions(user)).filter(live);
  // A non-owner's own rows only — the server does the filtering, from the
  // proven address, never from anything the request asked for. This is the
  // whole security point of B323: a person on a trip must not be able to
  // enumerate anybody else's keys, including the owner's.
  const visible = caller.owner ? rows : rows.filter((row) => row.email === caller.email);

  return Response.json({
    user,
    keys: visible.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      // When it was last used, which is the field that tells whoever is
      // looking whether a key they have forgotten about is one somebody is
      // still holding.
      lastSeenAt: row.lastSeenAt,
      // What it may write, in `tripWriteScope`'s own vocabulary — B323. The
      // owner previously had no way to tell a trip-scoped buddy key apart
      // from their own journal-wide one; a non-owner's rows are always their
      // own, but the scope still says which trip.
      scope: row.scope,
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
export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/keys">) {
  const { user } = await params;
  const caller = await guard(user, request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.revoke === "string" ? body.revoke : "";
  if (!id) {
    return Response.json(
      { error: "invalid_request", message: 'Send {"revoke": "<key id>"}.' },
      { status: 400 },
    );
  }

  // Scoped to this journal's own rows, and — for a non-owner — to their own
  // address too. Without the first check, an owner of one journal could
  // revoke a session belonging to another on the same instance by passing
  // its id; without the second, a buddy could revoke anybody's key by
  // guessing its (unguessable, but unchecked is still unchecked) id.
  const row = (await listSessions(user)).find((candidate) => candidate.id === id);
  if (!row || (!caller.owner && row.email !== caller.email)) {
    return Response.json({ error: "unknown_key" }, { status: 404 });
  }

  await revokeSession(id);
  return Response.json({ ok: true, revoked: id });
}
