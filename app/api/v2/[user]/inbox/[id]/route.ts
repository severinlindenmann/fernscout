// DELETE /api/v2/{user}/inbox/{id} — B1624, phase 2 step 4.
// No confirmation ceremony: nothing staged here has ever been on the site.
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { findInboxFile, removeInboxFile } from "@/lib/inbox";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/inbox/[id]">,
) {
  const { user, id } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const found = findInboxFile(user, id);
  if (!found) {
    return fail(
      "not_found",
      `${ERROR_CODES.not_found} Nothing in this journal's inbox is called "${id}". GET the inbox to see what is.`,
      undefined,
      404,
    );
  }

  removeInboxFile(user, id);
  return ok({ ok: true, id: found.entry.id, filename: found.entry.filename });
}
