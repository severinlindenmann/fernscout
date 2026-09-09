import { isEnabled } from "@/lib/capabilities";
import { listInvites, revokeInvite } from "@/lib/contacts/invites";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * The `revoke_invite` press — B1051.
 *
 * The counterpart of `DELETE /api/v1/<user>/invites/<id>`, reached from the
 * wizard's own door rather than the published contract, exactly the way
 * `./invite/route.ts` beside this one answers for `POST .../invites`. Nothing
 * here is new machinery: `revokeInvite` is the same function, and its own
 * doc comment already says what this does — one row, reversible by issuing
 * another link, and nobody already approved through it is touched.
 *
 * Cookie only, owner only, outside `/api/v1` — the same door as every other
 * route in this family, for the reasons `./invite/route.ts` gives at length.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/invite/revoke">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  if (!isEnabled("contacts", user)) {
    refused(user, "revoke_invite", "contacts_disabled");
    return Response.json({ error: "contacts_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-invite-revoke", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.invite === "string" ? body.invite.trim() : "";

  // Checked first, same order `[id]/route.ts` uses, so "no such link" and
  // "revoked" stay distinguishable — `revokeInvite` is an UPDATE and would
  // answer the same either way.
  const invite = (await listInvites(user)).find((row) => row.id === id);
  if (!invite) {
    refused(user, "revoke_invite", "unknown_invite");
    return Response.json({ error: "unknown_invite" }, { status: 404 });
  }

  await revokeInvite(user, id);
  wrote(user, "revoke_invite", { id, kind: invite.kind });
  return Response.json({ ok: true, id, revoked: true });
}
