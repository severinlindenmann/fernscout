// GET/POST /api/web/{user}/invites — the owner's own invite links, from a
// cookie — B1595 (v2 migration, web proxies for invites/channels).
//
// v2's invites door is bearer-only (`requireJournalOwner`, which reads
// `Authorization` and nothing else), and a browser must never hold a bearer
// token (decision 24). This is the cookie-side door: `isOwner` on the cookie
// only — any `Authorization` header is refused outright rather than falling
// through to a weaker check — and then the exact functions
// `GET`/`PUT /api/v2/{user}/invites{,/{id}}` call after their own bearer
// check, in process. No bearer token is minted, held, or sent anywhere for
// either call.
//
// POST here is the browser's create door: v2's is `PUT /api/v2/{user}/invites/{id}`
// (client-chosen id, S2/V10) because an agent picks its own id; a person
// clicking a button has no id to offer, so this door mints one
// (`crypto.randomUUID()`, which satisfies `ID_RE`) and calls the same
// `invitePutResponse` v2's own PUT calls.
//
// Replaces `app/api/v1/[user]/invites/route.ts`, which wrote through v1's
// `createInvite` call directly and answered both bearer and cookie callers
// from one door — the thing this file and `/api/v2/{user}/invites` together
// now keep apart.
import { invitesListResponse } from "@/app/api/v2/[user]/invites/route";
import { invitePutResponse } from "@/app/api/v2/[user]/invites/[id]/route";
import { contactsReady } from "@/lib/api/v2/social";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads or issues invites with " +
    "GET /api/v2/{user}/invites or PUT /api/v2/{user}/invites/{id}.",
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

export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/invites">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const denied = await guard(user);
  if (denied) return denied;
  return invitePutResponse(user, crypto.randomUUID(), request);
}
