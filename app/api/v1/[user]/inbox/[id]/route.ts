import { authenticate, errorResponse, mayActAsOwner, outOfScope, ownsUser } from "@/lib/api/auth";
import { findInboxFile, removeInboxFile } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * Take one staged file back out — B663.
 *
 * No confirmation code, unlike deleting a day (`lib/agentConfirm.ts`): nothing
 * here has ever been on the site, nobody has read it, and a file staged by
 * mistake that can only be removed by a shell on the server is the situation
 * this whole API exists to avoid. A photograph already filed into a day is a
 * different question and a different route, and that one does ask.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/inbox/[id]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, id } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (!mayActAsOwner(auth.session, user)) {
    return Response.json(
      {
        error: "out_of_scope",
        message: "The inbox belongs to the whole journal, and this token is scoped to one trip.",
      },
      { status: 403 },
    );
  }

  const found = findInboxFile(user, id);
  if (!found) {
    return Response.json(
      {
        error: "not_found",
        message: `Nothing in this journal's inbox is called "${id}". GET the inbox to see what is.`,
      },
      { status: 404 },
    );
  }

  removeInboxFile(user, id);
  return Response.json({ ok: true, id: found.entry.id, filename: found.entry.filename });
}
