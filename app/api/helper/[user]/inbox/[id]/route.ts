import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { DAY_RE, removeDayInboxFile, removeInboxFile } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * Taking a file back out of the inbox — B689. `?day=` added by B1990, for a
 * file already filed under a day folder rather than sitting in the flat
 * bucket — the studio inbox page's own delete needs both, and reuses this
 * one route rather than growing a second.
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
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox/[id]">,
) {
  const { user, id } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  const day = new URL(request.url).searchParams.get("day");
  if (day !== null && !DAY_RE.test(day)) {
    return Response.json({ error: "invalid_day" }, { status: 400 });
  }
  const removed = day ? removeDayInboxFile(user, day, id) : removeInboxFile(user, id);
  if (!removed) {
    return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
