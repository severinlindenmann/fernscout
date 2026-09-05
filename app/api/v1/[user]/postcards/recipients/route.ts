import { isEnabled } from "@/lib/capabilities";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { isOwner } from "@/lib/contacts/session";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/postcards/recipients` — who a card could go to — B434.
 *
 * A name, a town and a country each, and **never a street**. It is enough to
 * ask "shall I send one to Marta in Lisbon?", which is the whole job, and it
 * means an agent composing an order never holds anybody's home address. The
 * ids it returns are what `POST …/postcards` accepts; nothing anywhere turns
 * one back into an address except the server, at render and at send.
 *
 * The list is everybody who is an `active` contact of this journal, ticked
 * "send me a real postcard", and left enough of an address to reach — the same
 * three tests `postcardRecipientsFromContacts` has applied since B273. Nobody
 * who never asked, and nobody the owner has not approved.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/postcards/recipients">,
) {
  const { user } = await params;

  if (!getUser(user) || !isEnabled("postcards", user) || !isEnabled("contacts", user)) {
    return Response.json(
      {
        error: "postcards_disabled",
        message:
          "Postcards need both the postcards and the contacts capability, and this journal " +
          "does not have both. /api/health says which are on and why.",
      },
      { status: 404 },
    );
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message: "Only the address that owns this journal may see who it could write to.",
      },
      { status: 403 },
    );
  }

  const recipients = await postcardCandidates(user);
  return Response.json({
    user,
    creditsEach: POSTCARD_CREDITS,
    recipients,
    ...(recipients.length === 0
      ? {
          note:
            "Nobody has asked this journal for a real postcard yet. Readers opt in on the " +
            "guest form or their own manage page; the owner sees them at /" +
            user +
            "/contacts.",
        }
      : {}),
  });
}
