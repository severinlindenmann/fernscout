import { listSessions, revokeSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

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

async function guard(user: string, request: Request): Promise<Response | null> {
  if (!getUser(user) || !isEnabled("auth", user)) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may see or revoke the keys that write " +
          "to it.",
      },
      { status: 403 },
    );
  }
  return null;
}

/** Whether a row is a key that could still be used right now. */
function live(row: { kind: string; revokedAt: string | null; expiresAt: string }): boolean {
  if (row.kind !== "agent" && row.kind !== "handover") return false;
  if (row.revokedAt) return false;
  return new Date(row.expiresAt).getTime() > Date.now();
}

export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/keys">) {
  const { user } = await params;
  const denied = await guard(user, request);
  if (denied) return denied;

  const rows = await listSessions(user);
  return Response.json({
    user,
    keys: rows.filter(live).map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      // When it was last used, which is the field that tells an owner whether
      // a key they have forgotten about is one somebody is still holding.
      lastSeenAt: row.lastSeenAt,
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
  const denied = await guard(user, request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.revoke === "string" ? body.revoke : "";
  if (!id) {
    return Response.json(
      { error: "invalid_request", message: 'Send {"revoke": "<key id>"}.' },
      { status: 400 },
    );
  }

  // Scoped to this journal's own rows. Without this, an owner of one journal
  // could revoke a session belonging to another on the same instance by
  // passing its id — the id is a UUID and unguessable, but "unguessable" is
  // not the same as "checked".
  const mine = (await listSessions(user)).find((row) => row.id === id);
  if (!mine) {
    return Response.json({ error: "unknown_key" }, { status: 404 });
  }

  await revokeSession(id);
  return Response.json({ ok: true, revoked: id });
}
