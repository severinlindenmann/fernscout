// POST /api/web/{user}/postcards/orders — the owner's own postcard sheet
// proposing an order, from a cookie — B1674 (the PostcardSheet half).
//
// v2's create door is `PUT /api/v2/{user}/postcards/orders/{id}`
// (client-chosen id, S2/V10) because an agent picks its own id; a person
// tapping a photograph has no id to offer, so this door mints one
// (`crypto.randomUUID()`) and calls the same `postcardOrderPutResponse` v2's
// own PUT calls, in process, after `isOwner` on the cookie only. No bearer
// token is minted, held, or sent anywhere for this call.
//
// This proposes an order and answers with its URL — it charges nothing and
// prints nothing. The owner opens that URL and presses Send themselves
// (app/[user]/postcards/[id]/send/route.ts, cookie-only); nothing here
// imports that function.
//
// Replaces `components/PostcardSheet.tsx`'s POST to the deleted
// `/api/v1/{user}/postcards`.
import { postcardOrderPutResponse } from "@/app/api/v2/[user]/postcards/orders/[id]/route";
import { postcardsReady } from "@/lib/api/v2/postcards";
import { isOwner } from "@/lib/contacts/session";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent proposes an order with " +
    "PUT /api/v2/{user}/postcards/orders/{id}.",
};

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/postcards/orders">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const ready = postcardsReady(user);
  if (!ready.ok) return ready.response;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return postcardOrderPutResponse(user, crypto.randomUUID(), request);
}
