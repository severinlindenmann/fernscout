import { isHelperOwner } from "@/lib/helper/server";
import { removeInboxFile } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * Taking a file back out of the inbox — B689.
 *
 * `DELETE /api/v1/<user>/inbox/<id>` already does this for an agent with a
 * token; this is the same thing for the owner's own browser, which holds a
 * cookie and no token (`isHelperOwner`).
 *
 * It is on the inbox screen rather than being an afterthought because of what
 * one of these files is: an imported location export is the **unthinned**
 * original of somebody's whole movement history, sitting in their journal
 * folder, inside their backup and their export, long after the fixes it
 * carried were read and thinned into `gps/`. The API route says so in its
 * `next` text; a person reading a screen needs a button.
 */
export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox/[id]">,
) {
  const { user, id } = await params;
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }
  if (!removeInboxFile(user, id)) {
    return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
