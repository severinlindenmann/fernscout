// DELETE /api/web/{user}/inbox/pins/{id} — discard one waiting WhatsApp pin,
// from a cookie — B2014.
//
// `isOwner` on the cookie only, same shape as every other `/api/web` door
// (`.../trips/[trip]/plan/route.ts` beside this one): any `Authorization`
// header is refused outright rather than falling through to a weaker check.
// There is no bearer-token equivalent of this call — a pin is discarded by
// the person planning the trip, in the planner, never by an agent.
//
// `removeWaitingPin` (`lib/inbox.ts`, B2013) is the whole of it: it only ever
// matches a still-flat, undated `location` entry, so an id already moved onto
// a day (or never a pin at all) answers `not_found` rather than deleting
// something else by coincidence of id reuse.
import { isOwner } from "@/lib/contacts/session";
import { removeWaitingPin } from "@/lib/inbox";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser. There is no agent-facing way to discard a waiting pin.",
};

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/inbox/pins/[id]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  const removed = removeWaitingPin(user, id);
  if (!removed) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
