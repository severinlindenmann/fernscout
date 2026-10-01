// GET/PATCH /api/web/{user}/studio/assistant — TIX-2's remembered answer to
// whether the owner wants the studio's assistant offered on the add-a-day
// flow. Owner-browser-only, the same shape as the neighbouring
// `.../studio/tell-by` (B2194): a bearer token is refused before the owner
// is asked about, and there is no agent-facing equivalent. Body/response
// `{ "assistant": "on" | "off" }` on PATCH; GET reads the remembered answer
// back, `null` when never asked.
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { isAssistantChoice, ASSISTANT_CHOICES, readAssistantChoice, writeAssistantChoice } from "@/lib/studio/assistantChoice";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser — TIX-2 has no agent-facing equivalent.",
};

async function gate(request: Request, user: string): Promise<Response | null> {
  if (request.headers.get("authorization")) return Response.json(NOT_FOR_AGENTS, { status: 403 });
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/studio/assistant">) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;
  return Response.json({ ok: true, assistant: readAssistantChoice(user) });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/studio/assistant">) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as { assistant?: unknown } | null;
  if (!isAssistantChoice(body?.assistant)) {
    return Response.json(
      { error: "invalid_assistant", message: `assistant must be one of: ${ASSISTANT_CHOICES.join(", ")}.` },
      { status: 400 },
    );
  }
  writeAssistantChoice(user, body.assistant);
  return Response.json({ ok: true, assistant: body.assistant });
}
