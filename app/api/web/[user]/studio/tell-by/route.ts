// PATCH /api/web/{user}/studio/tell-by — the owner's answer to "How do you
// like to tell it?" (B2194), from a cookie. Owner-browser-only like every
// other studio door: a bearer token is refused before the owner is asked
// about. Body `{ "tellBy": "photos" | "speak" | "type" }`; the answer is read
// back in the response and on the next page render (`readTellBy`).
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { isTellBy, TELL_BY } from "@/lib/studio/speak";
import { writeTellBy } from "@/lib/studio/tellBy";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/studio/tell-by">) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser — B2194 has no agent-facing equivalent." },
      { status: 403 },
    );
  }
  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { tellBy?: unknown } | null;
  if (!isTellBy(body?.tellBy)) {
    return Response.json(
      { error: "invalid_tellBy", message: `tellBy must be one of: ${TELL_BY.join(", ")}.` },
      { status: 400 },
    );
  }
  writeTellBy(user, body.tellBy);
  return Response.json({ ok: true, tellBy: body.tellBy });
}
