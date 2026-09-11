import { Readable } from "node:stream";
import { isEnabled } from "@/lib/capabilities";
import { resolveDeletionToken } from "@/lib/deletions";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The whole journal, or one trip of it, handed to somebody about to delete it.
 *
 * `/<user>/export.zip` is owner-only (B1086), reachable with the owner's own
 * token. Neither that nor `npm run export` is any use here: the person reading
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
 * **A trip deletion narrows the archive to that trip — B1387.** The mail's
 * own prose says "this trip", and until this ticket the export it linked was
 * always the whole journal: every other trip, drafts and closed ones
 * included. `tripId` here comes from `resolved.pending`, the same
 * already-resolved token the rest of this route reads `kind` from — never
 * from the URL or a query parameter, so nothing short of holding this exact
 * token can widen or narrow what it exports. Deliberately excludes
 * `config.json` too (see `lib/exportZip.ts`): the mail said "this trip", so
 * the owner's own name, email and phone number have no business in what it
 * links.
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

  const tripId = resolved.pending.kind === "trip" ? resolved.pending.tripId : undefined;
  const archive = createUserExportArchive(user, "all", tripId);
  archive.finalize().catch(() => {});

  const filename = tripId ? `${user}-${tripId}-export.zip` : `${user}-export.zip`;
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Private trips and unpublished drafts. Never a shared cache, and never
      // a shared history entry a later visitor could replay.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
