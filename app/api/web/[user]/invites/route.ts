// GET/POST /api/web/{user}/invites — the owner's own invite links, from a
// cookie — B1595 (v2 migration, web proxies for invites/channels).
//
// B2295 (one door for readers, B2291): the agent bearer door this used to
// proxy for (`/api/v2/{user}/invites*`) is gone. The owner decided
// `/<user>/studio/readers` is the only place a person is let in, so there is
// no agent-reachable equivalent any more — a bearer token is refused outright,
// not pointed somewhere else. `isOwner` on the cookie only, then
// `invitesListResponse`/`invitePutResponse` in `lib/contacts/invitesResponse`
// (what these two functions used to be, split across the now-deleted v2
// route files).
//
// POST here mints its own id (`crypto.randomUUID()`, which satisfies
// `ID_RE`) — a person clicking a button has no client-chosen id to offer.
import { invitesListResponse, invitePutResponse } from "@/lib/contacts/invitesResponse";
import { joinCodeFor, joinUrl } from "@/lib/contacts/welcome";
import { readDryRun } from "@/lib/api/v2/route";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { contactsReady } from "@/lib/api/v2/social";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. Letting somebody read this journal happens " +
    "only from Studio › Readers, in the owner's own browser — there is no agent bearer " +
    "equivalent.",
};

async function guard(user: string): Promise<Response | null> {
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  const ready = await contactsReady(user);
  if (!ready.ok) return ready.response;
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/invites">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return invitesListResponse(user, request);
}

/**
 * B2291/B2293 — the answer also carries `joinUrl`, the short `/j/<code>` the
 * Readers page shows (the long `url` keeps working, by redirect). Null where
 * the code cannot be shown again (no contacts key).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/invites">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  // Creating a link is a write from the owner's browser: a present,
  // mismatched Origin is refused (B1559), as on the readers doors.
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  const id = crypto.randomUUID();
  const response = await invitePutResponse(user, id, request);
  if (response.status !== 201 || readDryRun(request)) return response;
  const code = await joinCodeFor(user, id);
  return Response.json(
    { ...(await response.json()), joinUrl: code ? joinUrl(code) : null },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
