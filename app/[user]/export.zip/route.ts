import { Readable } from "node:stream";
import { authenticate, ownsUser } from "@/lib/api/auth";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `/<username>/export.zip` — the journal, as a zip.
 *
 * **Anonymously**: a copy of what a visitor can already see — public and
 * unlisted trips, drafts stripped (`"open-to-link"` in lib/exportZip.ts).
 *
 * **With an agent token for this journal**: all of it. The original objection
 * was that an HTTP endpoint would "hand out someone's closed content on a
 * plain GET", and that is right — but a request carrying a Bearer
 * token scoped to this journal is not a plain GET, and the alternative was
 * telling somebody their backup needs shell access to a machine they may not
 * have. `npm run export` is still there for whoever does.
 *
 * Computed per request rather than prerendered: it aggregates every trip's
 * media at once, and duplicating a whole media library into the build output
 * on every `next build` is a worse trade than one archiver pass per download.
 */
export async function GET(request: Request, { params }: RouteContext<"/[user]/export.zip">) {
  const { user } = await params;
  if (!getUser(user)) return new Response("Not found", { status: 404 });

  // A token for a different journal, or an expired one, is simply not the
  // owner: it falls through to the public archive rather than being refused,
  // because the anonymous answer was always available anyway.
  const auth = await authenticate(request);
  const isOwner = auth.ok && ownsUser(auth.session, user);

  const archive = createUserExportArchive(user, isOwner ? "all" : "open-to-link");
  // Errors also propagate through the stream itself; this only prevents a
  // rejected finalize() from becoming an unhandled promise rejection.
  archive.finalize().catch(() => {});

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${user}-export.zip"`,
      // An owner's archive holds private trips and unpublished drafts, and
      // must never sit in a shared cache. The public one is the same bytes for
      // everybody and can.
      "Cache-Control": isOwner ? "private, no-store" : "public, max-age=300",
    },
  });
}
