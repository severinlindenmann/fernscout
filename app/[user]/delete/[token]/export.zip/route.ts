import { Readable } from "node:stream";
import { isEnabled } from "@/lib/capabilities";
import { resolveDeletionToken } from "@/lib/deletions";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The whole journal, handed to somebody who is about to delete it.
 *
 * `/<user>/export.zip` serves the `open-to-link` scope to anyone and the full
 * archive only to a Bearer token. Neither is any use here: the person reading
 * the confirmation mail is on a phone, in a mail client, holding no token —
 * and linking them the anonymous export before a deletion would hand over a
 * copy that silently omits the private journeys and the unpublished drafts
 * they are about to lose. That is a worse promise than none.
 *
 * So the deletion token authorises the `"all"` scope. It reaches only the
 * journal it was issued for, it expires in an hour, and whoever holds it is
 * about to be allowed to destroy this content — a copy of it is not a wider
 * grant than that. A link scanner that fetches this wastes a transfer; the
 * scanner is already the party the mail was sent to.
 *
 * Reading, so GET is right here. Deleting is a POST somewhere else, and the
 * token is deliberately **not** spent by this: somebody who downloads their
 * copy must still be able to press the button afterwards.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[user]/delete/[token]/export.zip">,
) {
  const { user, token } = await params;
  if (!getUser(user) || !isEnabled("auth", user)) {
    return new Response("Not found", { status: 404 });
  }

  const resolved = await resolveDeletionToken(user, token);
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
