import { Readable } from "node:stream";
import { consumeExportToken } from "@/lib/deletions";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The link in an export mail — B1295. Same door-shape as
 * `app/[user]/delete/[token]/export.zip`, but standing on its own: there is no
 * pending deletion behind this token, no confirmation page in front of it, and
 * nothing this route touches can delete anything.
 *
 * **Unlike the deletion flow's own export button, this token is spent by the
 * download.** That one shares its token with a confirmation page still to
 * come and must survive being downloaded first; this one has no second step
 * — the link in the mail is the whole flow, so "single use" means the archive
 * itself.
 *
 * Always the whole journal (`createUserExportArchive(user, "all")`, no
 * `tripId`) — the same scope `/<user>/export.zip` serves an agent token, and
 * `config.json` travels with it for the same reason that route's does: this
 * is the owner's own backup, not a narrowed copy for somebody else.
 */
export async function GET(_request: Request, { params }: RouteContext<"/[user]/export/[token]">) {
  const { user, token } = await params;
  if (!getUser(user)) return new Response("Not found", { status: 404 });

  const resolved = await consumeExportToken(user, token);
  if (!resolved.ok) return new Response("This link is no longer valid.", { status: 410 });

  const archive = createUserExportArchive(user, "all");
  archive.finalize().catch(() => {});

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${user}-export.zip"`,
      // Private trips and unpublished drafts. Never a shared cache, and never
      // a shared history entry a later visitor could replay.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
