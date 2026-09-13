// GET /api/v2/{user}/sync/file/{path} — the down leg of the sync surface.
// Ports app/api/v1/[user]/sync/file/[...path]/route.ts onto the v2 plumbing.
import fs from "node:fs";
import { requireHiddenOwner } from "@/lib/api/v2/auth";
import { fail } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { contentTypeFor } from "@/lib/media";
import { resolveSyncPath } from "@/lib/sync/manifest";

export const dynamic = "force-dynamic";

/**
 * One file of a journal's folder, by the path the manifest named.
 *
 * Read-only, and deliberately with no `PUT` beside it — see the v1 route
 * this replaces for why a raw file write would be a door around every check
 * `PUT .../days/{slug}` runs, `checkWeather` most of all. Gated by the same
 * `inSync()` predicate the manifest used (`lib/sync/manifest.ts`), so a path
 * refused by one is refused by the other, and by the same `not_found`
 * `requireHiddenOwner` answers with everywhere on this surface.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/sync/file/[...path]">,
) {
  const { user, path: segments } = await params;
  const auth = await requireHiddenOwner(request, user);
  if (!auth.ok) return auth.response;

  // Next has already percent-decoded each segment — one decode, done by the
  // framework, the same reliance `app/[user]/media/[...path]/route.ts` and
  // the v1 sync route both document.
  const file = resolveSyncPath(user, segments.join("/"));
  if (!file) return fail("not_found", ERROR_CODES.not_found, undefined, 404);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return fail("not_found", ERROR_CODES.not_found, undefined, 404);
  }
  if (!stat.isFile()) return fail("not_found", ERROR_CODES.not_found, undefined, 404);

  // Read whole, like the v1 route and app/[user]/media/[...path]/route.ts —
  // these are the site's own derivatives, never a photobook's originals/.
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "Content-Type": contentTypeFor(file),
      "Content-Length": String(stat.size),
      // Private trips and unpublished drafts: never a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
