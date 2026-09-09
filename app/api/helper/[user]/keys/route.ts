import { listSessions, revokeSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * One key taken back, from the room — B1042 batch (`keys` and `revoke_key` in
 * `lib/helper/tools/areas/journal.ts`).
 *
 * Owner only — a companion's own key is theirs to see on `GET
 * /api/v1/<user>/keys`, but revoking one here is the same authority the room
 * gates everything else on. Never a bearer token: this is where the owner is
 * sitting when a key needs taking back, not something an agent does to
 * itself.
 */
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
