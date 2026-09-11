import { listSessions, revokeSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * One key taken back, from the room — B1042 batch (`keys` and `revoke_key` in
 * `lib/helper/tools/areas/journal.ts`), and one key list seen without asking
 * for it — B1154.
 *
 * Owner only — a companion's own key is theirs to see on `GET
 * /api/v1/<user>/keys`, but this room is a page holding a cookie, never a
 * bearer token, so it needs its own cookie-only door onto the identical rows
 * rather than pointing the panel at that route: `isOwner` there also accepts
 * an owner's own **bearer** token as owner-equivalent, and `isHelperOwner`
 * never reads an `Authorization` header at all — the guarantee AGENTS.md
 * asks of every browser surface in this family.
 */

/** The same test `app/api/v1/[user]/keys/route.ts`'s own `live()` applies:
 *  only a row that could still be used right now, and only the two kinds
 *  that can ever write. */
function live(row: { kind: string; revokedAt: string | null; expiresAt: string }): boolean {
  if (row.kind !== "agent" && row.kind !== "handover") return false;
  if (row.revokedAt) return false;
  return new Date(row.expiresAt).getTime() > Date.now();
}

/**
 * What each key is, never what it holds — B1154.
 *
 * `id`, `kind`, `createdAt`, `expiresAt`, `lastSeenAt` and `scope`: the same
 * fields `GET /api/v1/<user>/keys` already answers, read back from the same
 * `listSessions`. **Never a token** — `listSessions` does not return one, so
 * there is nothing here to leak; `test/helper-journal.test.ts`-style
 * coverage pins that the rendered room never carries one either.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/keys">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("auth", user)) {
    return Response.json({ error: "auth_disabled" }, { status: 409 });
  }

  const keys = (await listSessions(user)).filter(live).map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    scope: row.scope,
  }));
  return Response.json({ keys });
}
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/keys">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("auth", user)) {
    refused(user, "revoke_key", "auth_disabled");
    return Response.json({ error: "auth_disabled" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    refused(user, "revoke_key", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  // Scoped to this journal's own rows, the same check
  // `app/api/v1/[user]/keys/route.ts` makes — an id that is not this
  // journal's is refused rather than revoked, so one journal cannot end
  // another's session by guessing its id.
  const row = (await listSessions(user)).find((candidate) => candidate.id === id);
  if (!row) {
    refused(user, "revoke_key", "unknown_key");
    return Response.json({ error: "unknown_key" }, { status: 404 });
  }

  await revokeSession(id);
  wrote(user, "revoke_key", { kind: row.kind });
  return Response.json({ ok: true, revoked: id });
}
