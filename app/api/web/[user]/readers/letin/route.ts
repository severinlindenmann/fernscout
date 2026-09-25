import { readJsonBody } from "@/lib/api/jsonBody";
import { approveContact, getContact } from "@/lib/contacts";
import { tellLetIn } from "@/lib/contacts/welcome";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `POST /api/web/<user>/readers/letin` `{ contactId }` — the owner's "Let in"
 * on a request under "Waiting for your answer", or "Let back in" under
 * "Access taken away" (B2291).
 *
 * `approveContact` is still the only thing that writes a grant, and it still
 * refuses a person who proved nothing. Afterwards the person is told on the
 * channel they proved (B2291 "Group-link visitor"): email, or an SMS when a
 * number is all they proved. Both free — a transactional note, like a code.
 * The message carries their welcome link, which lands them on "what you can
 * do" and then in.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/readers/letin">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value as Record<string, unknown> | null;
  const contactId = typeof body?.contactId === "string" ? body.contactId : "";
  const contact = contactId ? await getContact(user, contactId) : null;
  if (!contact) return Response.json({ error: "no_contact" }, { status: 404, headers: PRIVATE });

  const approved = await approveContact(user, contact.id);
  if (!approved) return Response.json({ error: "not_proven" }, { status: 409, headers: PRIVATE });
  const told = await tellLetIn(user, approved.contact);
  return Response.json({ ok: true, tripsOpened: approved.tripsOpened, told }, { headers: PRIVATE });
}
