// GET/PATCH /api/web/{user}/channels — the owner's own mute switches for the
// two sending channels, from a cookie — B1595 (v2 migration, web proxies for
// invites/channels).
//
// `isOwner` on the cookie only — any `Authorization` header is refused
// outright — and then `channelsGetDoc`/`channelsPatchResponse`, the exact
// functions `GET`/`PATCH /api/v2/{user}/channels` call after their own
// bearer check, in process. No bearer token is minted, held, or sent
// anywhere for either call.
//
// Replaces `app/api/v1/[user]/channels/route.ts`, which wrote through v1's
// `setJournalFeatures` call directly and answered both bearer and cookie
// callers from one door.
import { channelsGetDoc, channelsPatchResponse } from "@/app/api/v2/[user]/channels/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads or changes these switches " +
    "with GET/PATCH /api/v2/{user}/channels.",
};

async function guard(user: string): Promise<Response | null> {
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/channels">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return channelsGetDoc(user);
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/channels">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return channelsPatchResponse(user, request);
}
