// PATCH /api/web/{user}/studio/tips — the owner's own answer to the
// getting-started tips checkbox, from a cookie — B2447 (W44 D5). Owner-
// browser-only like `.../studio/tell-by`, which this copies: a bearer token
// is refused before the owner is asked about, since this is a UI-only
// preference with nothing for an agent to write (see `setOwnerTips`'s own
// comment in lib/journals.ts for why it is not part of the v2 journal write
// contract). Body `{ "optIn": boolean }`.
import { isOwner } from "@/lib/contacts/session";
import { setOwnerTips } from "@/lib/journals";
import { getUser } from "@/lib/users";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/studio/tips">) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser — the tips checkbox has no agent-facing equivalent." },
      { status: 403 },
    );
  }
  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  const bodyRead = await readJsonBody(request);
  if (!bodyRead.ok) return bodyRead.response;
  const body = (bodyRead.value ?? null) as { optIn?: unknown } | null;
  if (typeof body?.optIn !== "boolean") {
    return Response.json({ error: "invalid_optIn", message: "optIn must be true or false." }, { status: 400 });
  }
  const result = setOwnerTips(user, body.optIn);
  if (!result.ok) return Response.json({ error: result.error, message: result.message }, { status: 400 });
  return Response.json({ ok: true, optIn: body.optIn });
}
