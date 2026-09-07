import { isEnabled } from "@/lib/capabilities";
import { HELPER_SCOPES, recordHelperConsent, revokeHelperConsent, type HelperScope } from "@/lib/helper/consent";
import { HELPER_PROVIDER } from "@/lib/helper/model";
import { isHelperOwner } from "@/lib/helper/server";

export const dynamic = "force-dynamic";

/**
 * Saying yes, and taking it back — B684, extended to name a scope in B687.
 *
 * Free, owner only, cookie only. `POST` records the consent the panel
 * describes, for the scope it asked about — `words` when the body says
 * nothing, since that is what every panel before B687 meant. `DELETE` removes
 * the whole record, and the next call in either scope is refused until
 * somebody reads a panel again. There is nothing to migrate and nothing to
 * expire: the file is the whole of it (`lib/helper/consent.ts`).
 */

async function gate(user: string): Promise<Response | null> {
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  return null;
}

function scopeOf(raw: unknown): HelperScope {
  return (HELPER_SCOPES as readonly string[]).includes(raw as string) ? (raw as HelperScope) : "words";
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/consent">) {
  const { user } = await params;
  const refused = await gate(user);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = scopeOf(body.scope);
  return Response.json({ ok: true, consent: recordHelperConsent(user, HELPER_PROVIDER, scope) });
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/helper/[user]/consent">,
) {
  const { user } = await params;
  const refused = await gate(user);
  if (refused) return refused;
  revokeHelperConsent(user);
  return Response.json({ ok: true, consent: null });
}
