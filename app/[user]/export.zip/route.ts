import { Readable } from "node:stream";
import { authenticate, mayActAsOwner } from "@/lib/api/auth";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `/<username>/export.zip` — the journal, as a zip. **Owner only** (B1086).
 *
 * The whole journal, exactly as it sits on disk, drafts included: this is the
 * owner's own backup, and only the owner gets it. A request carrying the
 * journal owner's unqualified `write:content` token passes; everything else —
 * anonymous, a trip-scoped token, an expired one — is refused.
 *
 * It used to also serve an anonymous `"open-to-link"` archive of the
 * public/unlisted trips, on the reasoning that it packaged content a visitor
 * could already reach. But that archive still bundled `config.json`, which
 * carries `owner.name`, `owner.email` and `startLocation` — the owner's real
 * identity and home, which every *other* route on this instance deliberately
 * withholds (AGENTS.md: "No call returns the owner's email address, and none
 * will"). The convenience packaging was not worth a standing way to read the
 * owner's address off a plain GET, so the export is now the owner's alone.
 * `npm run export` is still there for a local, shell-side backup.
 *
 * Computed per request rather than prerendered: it aggregates every trip's
 * media at once, and duplicating a whole media library into the build output
 * on every `next build` is a worse trade than one archiver pass per download.
 */
export async function GET(request: Request, { params }: RouteContext<"/[user]/export.zip">) {
  const { user } = await params;
  if (!getUser(user)) return new Response("Not found", { status: 404 });

  /**
   * **Two questions, and this route needs both** — B231/B240.
   *
   * `mayActAsOwner` asks the question `ownsUser` alone got wrong: not merely
   * *which journal a token belongs to*, but whether it is the owner's. A
   * `write:trip:<id>` token — the credential a buddy link produces, the
   * lowest-trust thing this system issues — belongs to the journal and so
   * satisfied `ownsUser`, which once selected the whole-journal archive: every
   * `private` and `guest` trip, every `costs.md`, every unpublished draft,
   * handed to somebody let onto one trip. `mayActAsOwner` (B240) is the
   * unqualified `write:content` scope *and* the address behind the token
   * matching `config.json`'s own `owner.email`, so a scope minted wrong on its
   * own is still not enough.
   *
   * A non-owner is refused with the same 404 an unknown journal gets, which
   * tells a prober nothing — and, since B1086, that refusal is now the whole
   * answer: there is no anonymous fall-through archive to leak the owner's
   * address. A per-trip or public archive, if it is ever wanted, is a separate
   * feature with its own gate, not this route quietly widening.
   */
  const auth = await authenticate(request);
  if (!(auth.ok && mayActAsOwner(auth.session, user))) {
    return new Response("Not found", { status: 404 });
  }

  const archive = createUserExportArchive(user, "all");
  // Errors also propagate through the stream itself; this only prevents a
  // rejected finalize() from becoming an unhandled promise rejection.
  archive.finalize().catch(() => {});

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${user}-export.zip"`,
      // The archive holds private trips and unpublished drafts, and must never
      // sit in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
