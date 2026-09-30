import { readJsonBody } from "@/lib/api/jsonBody";
import { getContact } from "@/lib/contacts";
import { answerAskedGroup, setContactGroup } from "@/lib/contacts/groups";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `POST /api/web/<user>/readers/group` — which group one person is in
 * (TIX-6). The owner's own door (`ownerOnly`).
 *
 * - `{ contactId, group: "<id>" | null }` — put them in that group, or none.
 * - `{ contactId, asked: "keep" | "move" }` — answer "asked again through
 *   another group's link": stay where they are, or go to the link's group.
 *
 * Changes the label only. Their grant, channels and trip places are
 * untouched, which is why this needs no confirmation step.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/readers/group">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const contactId = typeof body.contactId === "string" ? body.contactId : "";
  const contact = contactId ? await getContact(user, contactId) : null;
  if (!contact) return Response.json({ error: "no_contact" }, { status: 404, headers: PRIVATE });

  if (body.asked === "keep" || body.asked === "move") {
    const answered = await answerAskedGroup(user, contact.id, body.asked);
    if (!answered) return Response.json({ error: "nothing_asked" }, { status: 409, headers: PRIVATE });
    return Response.json({ ok: true }, { headers: PRIVATE });
  }
  if (!("group" in body) || (body.group !== null && typeof body.group !== "string")) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: PRIVATE });
  }
  const saved = await setContactGroup(user, contact.id, body.group as string | null);
  if (!saved) return Response.json({ error: "unknown_group" }, { status: 404, headers: PRIVATE });
  return Response.json({ ok: true }, { headers: PRIVATE });
}
