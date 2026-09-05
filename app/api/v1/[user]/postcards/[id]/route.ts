import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { getOrder, isExpired, orderCost } from "@/lib/postcard/orders";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/postcards/<id>` — where an order stands — B434.
 *
 * Deliberately thin, and deliberately alone: this is the *whole* of what an
 * agent may do to an existing order. There is no `POST …/send`, no
 * `PATCH …/status`, no way from here to make paper move. Read the module
 * comment in `lib/postcard/orders.ts` before adding one.
 *
 * `sent` here means the cards went to a printer. It does not mean they have
 * been delivered, and there is nothing in this system that will ever know
 * that.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/postcards/[id]">,
) {
  const { user, id } = await params;

  if (!getUser(user) || !isEnabled("postcards", user)) {
    return Response.json({ error: "postcards_disabled" }, { status: 404 });
  }
  if (!(await isOwner(user, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const order = await getOrder(user, id);
  if (!order) return Response.json({ error: "unknown_order" }, { status: 404 });

  const expired = order.status === "draft" && isExpired(order);
  return Response.json({
    id: order.id,
    status: expired ? "expired" : order.status,
    trip: order.payload.trip,
    day: order.payload.day,
    photo: order.payload.photo,
    message: order.payload.message,
    from: order.payload.from,
    recipients: order.payload.recipients.length,
    credits: { each: order.payload.creditsEach, total: orderCost(order) },
    expiresAt: order.payload.expiresAt,
    createdAt: order.createdAt,
    url: `${serverSite().url}/${user}/postcards/${order.id}`,
    ...(order.payload.results
      ? {
          sent: order.payload.results.filter((r) => r.ok).length,
          failed: order.payload.results.filter((r) => !r.ok).length,
        }
      : {}),
  });
}
