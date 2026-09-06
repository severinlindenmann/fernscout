import { isOwner } from "@/lib/contacts/session";
import { updateOrderCrop } from "@/lib/postcard/orders";

export const dynamic = "force-dynamic";

/**
 * Repositioning the front photograph before the card is printed — B627.
 *
 * The photograph and the recipients are still fixed once an order exists —
 * see `message/route.ts` — but a portrait photograph landing centre-cropped
 * on a landscape card is not a wrong photograph, it is a wrong crop, and
 * abandoning the whole order to fix it was the only remedy before this
 * existed. This changes where the *same* photograph is cropped from, and
 * nothing else: `lib/postcard/orders.ts`'s `Crop` is a fraction pair, not a
 * different picture.
 *
 * **The same door as `message` and `send`, and deliberately so.** Called by
 * the preview page's own drag control via `fetch`, so it answers JSON rather
 * than redirecting; satisfied only by the owner's cookie (`isOwner` called
 * *without* the request, which is what excludes a bearer token), and a
 * request carrying an `Authorization` header is refused outright. An agent
 * cannot see the drag it would need to make this choice, so it has no route
 * to it at all — proposing another order is the honest way to change what an
 * agent controls.
 *
 * Refused once the order leaves `draft`, so a drag that lands while a send is
 * in flight changes no row rather than quietly altering what is printing.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/postcards/[id]/crop">,
) {
  const { user, id } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "The crop on a card is chosen by the person whose journal it is, by dragging the " +
          "photograph on the preview page. An agent that wants a different crop should " +
          "propose another order.",
      },
      { status: 403 },
    );
  }

  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { x?: unknown; y?: unknown };
  try {
    body = (await request.json()) as { x?: unknown; y?: unknown };
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const saved = await updateOrderCrop(user, id, { x, y });
  if (!saved) return Response.json({ error: "already_sent" }, { status: 409 });
  return Response.json({ ok: true });
}
