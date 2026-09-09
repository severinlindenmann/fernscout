import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { findInboxFile, removeInboxFile } from "@/lib/inbox";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * Throw away one staged file — from the room, not only from `/api/v1`.
 *
 * `DELETE /api/v1/<user>/inbox/<id>` has done this since B663, and takes a
 * bearer token; a browser here holds a cookie and no token, the same gap
 * B915 closed for putting a staged photograph onto a day. `removeInboxFile`
 * (`lib/inbox.ts`) is the one function that knows what "gone" means for a
 * sidecar and a file that move together, so this calls it rather than
 * repeating the pair of `fs.rmSync` calls.
 *
 * No confirmation code and no preview: nothing here has ever been on the
 * site and nobody has read it, which is the same reasoning the v1 route's own
 * comment gives for asking nothing further than the press itself.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox/discard">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const id = String(body.id ?? "").trim();
  const found = id ? findInboxFile(user, id) : null;
  if (!found) {
    refused(user, "discard_file", "unknown_inbox_file");
    return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
  }

  removeInboxFile(user, id);
  wrote(user, "discard_file", { id: found.entry.id, filename: found.entry.filename });
  return Response.json({ ok: true, id: found.entry.id, filename: found.entry.filename });
}
