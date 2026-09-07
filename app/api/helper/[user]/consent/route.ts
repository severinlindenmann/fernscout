import { isEnabled } from "@/lib/capabilities";
import { recordHelperConsent, revokeHelperConsent } from "@/lib/helper/consent";
import { HELPER_PROVIDER } from "@/lib/helper/model";
import { isHelperOwner } from "@/lib/helper/server";

export const dynamic = "force-dynamic";

/**
 * Saying yes, and taking it back — B684.
 *
 * Free, owner only, cookie only. `POST` records the consent the panel
 * describes; `DELETE` removes it, and the next write-up is refused until
 * somebody reads the panel again. There is nothing to migrate and nothing to
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

export async function POST(_request: Request, { params }: RouteContext<"/api/helper/[user]/consent">) {
  const { user } = await params;
  const refused = await gate(user);
  if (refused) return refused;
  return Response.json({ ok: true, consent: recordHelperConsent(user, HELPER_PROVIDER) });
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
