// GET /api/v2/{user}/sync/manifest — the v2 door onto B1495's sync surface.
// Ports app/api/v1/[user]/sync/manifest/route.ts onto the v2 plumbing; the
// domain logic (what is in a manifest and why gps/ is never in it) is
// unchanged and still lives in lib/sync/manifest.ts.
import { requireHiddenOwner } from "@/lib/api/v2/auth";
import { ok } from "@/lib/api/v2/route";
import { buildManifest } from "@/lib/sync/manifest";

export const dynamic = "force-dynamic";

/**
 * What this journal's folder holds, file by file, with a hash.
 *
 * See the v1 route this replaces for the full reasoning: `gps/` is in no
 * manifest and reachable from no route (`lib/sync/manifest.ts`,
 * `test/gps-store.test.ts`), and every refusal here is the same `not_found`
 * — `requireHiddenOwner` (lib/api/v2/auth.ts) — so an unknown journal, a
 * token for a different one, and a trip-scoped token cannot be told apart
 * from outside.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/sync/manifest">) {
  const { user } = await params;
  const auth = await requireHiddenOwner(request, user);
  if (!auth.ok) return auth.response;

  const manifest = buildManifest(user);
  const bytes = manifest.files.reduce((n, file) => n + file.size, 0);

  return ok({
    ...manifest,
    bytes,
    next:
      manifest.omitted.originals.files > 0
        ? `${manifest.files.length} files, ${bytes} bytes. Not included: ` +
          `${manifest.omitted.originals.files} full-resolution originals ` +
          `(${manifest.omitted.originals.bytes} bytes), which the site does not serve and ` +
          "this call does not carry — back those up from the filesystem. Fetch a file with " +
          `GET /api/v2/${user}/sync/file/<path>.`
        : `${manifest.files.length} files, ${bytes} bytes. Fetch one with ` +
          `GET /api/v2/${user}/sync/file/<path>.`,
  });
}
