import { authenticate, errorResponse, mayActAsOwner, ownsUser } from "@/lib/api/auth";
import { buildManifest } from "@/lib/sync/manifest";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * What this journal's folder holds, file by file, with a hash — B1495.
 *
 * The call a sync client makes first, and the thing this instance has never
 * been able to answer: *which files do you have, and which of them differ from
 * mine.* Content has only flowed up until now — the helper's `publish` skill
 * asks which day slugs exist and sends the difference — so getting the newest
 * version back down meant unzipping a whole export over the top of whatever
 * was local. A list of paths and hashes is the whole of what a client needs to
 * move only what changed, in either direction.
 *
 * `lib/sync/manifest.ts` decides what is in it and why — `gps/` most of all,
 * which is in no manifest and reachable from no route, asserted by
 * `test/gps-store.test.ts` rather than promised in a comment.
 *
 * **Owner only, and refused as a 404.** The gate is copied from
 * `app/[user]/export.zip/route.ts:54` deliberately: this answers the same
 * question that route does — *what is in this journal, drafts and private
 * trips included* — so it must not be reachable by anything that route
 * refuses. A trip-scoped token is the case that matters, since it is the
 * lowest-trust credential this system issues: it belongs to the journal and so
 * satisfies `ownsUser`, and `mayActAsOwner` is what stops it walking every
 * private trip and unpublished draft in a journal it came to one trip of.
 *
 * The refusal is a 404 rather than a 403 for the reason that route gives: it
 * is the same answer an unknown journal gets, so a prober learns nothing. But
 * an *unscoped* token that simply belongs to another journal gets `outOfScope`
 * instead, which names the journal it is for — that is a caller who built a
 * URL wrong rather than one testing a boundary.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/sync/manifest">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!ownsUser(auth.session, user)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!mayActAsOwner(auth.session, user)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const manifest = buildManifest(user);
  const bytes = manifest.files.reduce((n, file) => n + file.size, 0);

  return Response.json({
    ...manifest,
    bytes,
    // Said out loud rather than left to be discovered. `originals/` is the
    // largest thing in most journals and it is deliberately not synced (see
    // lib/sync/manifest.ts); a mirror that omits it silently while calling
    // itself a backup is the failure this line exists to prevent.
    next:
      manifest.omitted.originals.files > 0
        ? `${manifest.files.length} files, ${bytes} bytes. Not included: ` +
          `${manifest.omitted.originals.files} full-resolution originals ` +
          `(${manifest.omitted.originals.bytes} bytes), which the site does not serve and ` +
          "this call does not carry — back those up from the filesystem. Fetch a file with " +
          `GET /api/v1/${user}/sync/file/<path>.`
        : `${manifest.files.length} files, ${bytes} bytes. Fetch one with ` +
          `GET /api/v1/${user}/sync/file/<path>.`,
  });
}
