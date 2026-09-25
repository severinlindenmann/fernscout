// PATCH /api/web/{user} — the owner's own journal settings, from a cookie —
// B1595 (v2 migration, phase 2 step 5).
//
// `PATCH /api/v2/{user}` takes a bearer token, and a browser must never hold
// one (decision 24). This is the cookie-side door: `isOwner` on the cookie
// only — any `Authorization` header is refused outright rather than falling
// through to a weaker check — and then `applyJournalPatch`, the exact
// function `PATCH /api/v2/{user}` calls after its own bearer check, in
// process. No bearer token is minted, held, or sent anywhere for this call;
// `applyJournalPatch` never asks for one.
//
// Replaces `app/api/journal/route.ts`, which wrote through v1's
// `setJournalProfile` against the pre-B1598 file shape.
import { applyJournalPatch } from "@/app/api/v2/[user]/route";
import { journalDoc } from "@/lib/api/v2/schemas";
import { isOwner } from "@/lib/contacts/session";
import { journalV2Fields } from "@/lib/journals";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser. An agent edits the journal with PATCH /api/v2/{user}.",
};

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user } = await params;
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const stored = journalDoc.parse({ ...journalV2Fields(journal), username: user });
  return applyJournalPatch(user, stored, request);
}
