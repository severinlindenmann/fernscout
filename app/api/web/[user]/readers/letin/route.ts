import { readJsonBody } from "@/lib/api/jsonBody";
import { approveContact, getContact } from "@/lib/contacts";
import { tellLetIn } from "@/lib/contacts/welcome";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `POST /api/web/<user>/readers/letin` `{ contactId, places? }` — the owner's
 * "Let in" on a request under "Waiting for your answer", or "Let back in"
 * under "Access taken away" (B2291).
 *
 * `approveContact` is still the only thing that writes a grant, and it still
 * refuses a person who proved nothing. Afterwards the person is told by email
 * (B2291 "Group-link visitor"; B2597 retired the SMS half) — free, a
 * transactional note, like a code. The message carries their welcome link,
 * which lands them on "what you can do" and then in.
 *
 * `places` is optional and passed straight through to `approveContact` —
 * B2461's "Let read only" sends `{ onlyTrip: null }` so a request that also
 * asked to write to a trip opens the journal-wide read grant only, never the
 * trip place. Anything else in the body is ignored, so a caller cannot name
 * a trip the person never asked for.
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

  const placesRaw = body?.places as { onlyTrip?: unknown } | null | undefined;
  // B-2963 — somebody filed by keeping a trip through a link (`read:<invite>`)
  // is let into the journal to read, never into an old buddy request.
  const keeper = contact.createdVia?.startsWith("read:") === true;
  const places = keeper || (placesRaw && placesRaw.onlyTrip === null) ? { onlyTrip: null } : undefined;

  const approved = await approveContact(user, contact.id, places);
  if (!approved) return Response.json({ error: "not_proven" }, { status: 409, headers: PRIVATE });
  const told = await tellLetIn(user, approved.contact);
  return Response.json({ ok: true, tripsOpened: approved.tripsOpened, told }, { headers: PRIVATE });
}
