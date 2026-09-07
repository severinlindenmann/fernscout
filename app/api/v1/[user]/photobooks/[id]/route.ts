import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/photobooks/<id>` — where one photobook order stands —
 * the photobook counterpart of `GET /api/v1/<user>/postcards/<id>`.
 *
 * A field `POST …/print` accepted has to be readable back here, or an agent
 * cannot check its own proposal actually landed — AGENTS.md's rule for every
 * route in this API. **`print.contactId` and never an address**: the same
 * discipline `bookRecipients` already holds, so this answers with who the
 * book is going to as a contact id and nothing that could be posted to
 * directly.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/photobooks/[id]">,
) {
  const { user, id } = await params;

  if (!getUser(user) || !isEnabled("photobook", user)) {
    return Response.json({ error: "photobook_disabled" }, { status: 404 });
  }
  if (!(await isOwner(user, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const order = await getPhotobookOrder(user, id);
  if (!order) return Response.json({ error: "unknown_order" }, { status: 404 });

  return Response.json({
    id: order.id,
    status: order.status,
    trip: order.payload.trip,
    size: order.payload.options.size,
    pages: order.payload.pages,
    volumes: order.payload.volumes,
    credits: order.payload.credits,
    files: order.payload.files ?? [],
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    ...(order.payload.print
      ? {
          print: {
            contactId: order.payload.print.contactId,
            quotedCredits: order.payload.print.quotedCredits,
            quotedAt: order.payload.print.quotedAt,
            shipmentMethodUid: order.payload.print.shipmentMethodUid,
            ...(order.payload.print.providerRef ? { providerRef: order.payload.print.providerRef } : {}),
            ...(order.payload.print.failure ? { failure: order.payload.print.failure } : {}),
          },
        }
      : {}),
  });
}
