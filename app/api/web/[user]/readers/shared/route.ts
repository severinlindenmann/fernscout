import { readJsonBody } from "@/lib/api/jsonBody";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * `POST /api/web/<user>/readers/shared` — B2444 (W44 D4).
 *
 * Fired once the owner has actually used their own share sheet or copied the
 * ready-made text (`ShareLink`), so the send log knows an invite went out
 * even though it never touched a Fernscout channel. Nothing is sent or
 * created here — the owner already did the sharing themselves, from their
 * own phone or clipboard, before this ever fires.
 *
 * `contactId`, when given, is the reader this share was for — a specific
 * card's "self" channel in `NotifyStep`. A group link shared from
 * `InviteLinkDoor` names nobody, since it is not for one person.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/readers/shared">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value as Record<string, unknown> | null;
  const contactId = typeof body?.contactId === "string" ? body.contactId : null;

  // TODO(B2438): logMessage({ owner: user, template: "invite.share", channel: "share", status: "sent", recipient: contactId })
  // — the foundation branch (lib/messages/log.ts) is not on this branch yet;
  // wire this once it merges. `contactId` names the contact whose address
  // becomes the recipient hash; a group link (no contactId) logs a
  // placeholder hash instead, per W44's model.
  void contactId;

  return new Response(null, { status: 204, headers: PRIVATE });
}
