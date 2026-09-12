// GET /api/v2/{user}/photobooks/orders/{id} — B1624, phase 2 step 4.
//
// Read-only, unchanged in shape from v1. There is deliberately no PUT here:
// planning, pricing, choosing a recipient contact and paying a photobook are
// one page and one press, entirely browser-side, since B1428/B1157 decided
// splitting the build from the print made no sense. print.contactId and
// never an address — the same discipline `bookRecipients` already holds.
import { isEnabled } from "@/lib/capabilities";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/photobooks/orders/[id]">,
) {
  const { user, id } = await params;
  if (!getUser(user) || !isEnabled("photobook")) {
    return fail("photobook_disabled", ERROR_CODES.photobook_disabled, undefined, 404);
  }
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const order = await getPhotobookOrder(user, id);
  if (!order) return fail("unknown_order", ERROR_CODES.unknown_order, undefined, 404);

  return ok({
    id: order.id,
    status: order.status,
    trip: order.payload.trip,
    size: order.payload.options.size,
    coverType: order.payload.options.coverType,
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
