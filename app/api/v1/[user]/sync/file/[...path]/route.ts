import fs from "node:fs";
import { authenticate, errorResponse, mayActAsOwner, ownsUser } from "@/lib/api/auth";
import { contentTypeFor } from "@/lib/media";
import { resolveSyncPath } from "@/lib/sync/manifest";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * One file of a journal's folder, by the path the manifest named — B1495.
 *
 * The down leg. `GET .../sync/manifest` says what there is and what each file
 * hashes to; this hands over the bytes of the ones a client does not already
 * have. Between them that is a working `sync down`, and the first road *into*
 * a laptop this instance has ever had that is not a whole-journal zip.
 *
 * ## Read-only, and there is no `PUT` beside it
 *
 * This was the ticket's biggest open question and it resolved to fewer routes
 * than it assumed. A file `PUT` would be the obvious symmetry and it is not
 * built, because writing a day as raw bytes goes around every check
 * `POST .../days` runs: the shape and the required fields, a date that is a
 * real calendar date, the transport enum, currency codes on every cost line,
 * the rule that every declared locale carries a translation, the gallery check
 * behind a caption or a per-photo visibility, the slug-collision check, the
 * contract check that refuses an undocumented key, and the allow-list that
 * keeps `status` out of a `PATCH` so nothing publishes except through the
 * publish door.
 *
 * One of those decides it alone. `checkWeather` refuses a caller supplying its
 * own reading, because a temperature is measured by the server at the day's
 * own coordinates or it is not written at all. **A raw file `PUT` would be a
 * door an agent could write invented weather through** — not as a bug, but as
 * the design. So the up leg goes through the typed routes that already exist,
 * every one of which was checked against the tree and found to cover its file
 * kind; this route's asymmetry is the point rather than an omission.
 *
 * ## The path is gated by the same predicate the listing used
 *
 * `inSync()` (lib/sync/manifest.ts) decides both what appears in the manifest
 * and what is fetchable here, so a path refused by one is refused by the
 * other — including `gps/`, which is in no manifest and readable through
 * nothing. Two copies of that rule would be two rules within a month, and the
 * half that drifted would be this one: a file kept out of the listing and left
 * at a guessable URL is not kept back at all. `resolveSyncPath` also re-checks
 * the resolved path is still inside the journal, since a symlink can leave a
 * directory that `..` never mentions.
 *
 * Owner only, 404 on every refusal, exactly as the manifest and `export.zip`
 * are: this serves private trips and unpublished drafts, so a trip-scoped
 * token is refused here as it is there.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/sync/file/[...path]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, path: segments } = await params;
  if (!getUser(user)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!ownsUser(auth.session, user)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!mayActAsOwner(auth.session, user)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Decoded per segment: Next hands them over still percent-encoded, and a
  // filename with a space in it is ordinary in somebody's photo library.
  let relative: string;
  try {
    relative = segments.map(decodeURIComponent).join("/");
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const file = resolveSyncPath(user, relative);
  if (!file) return Response.json({ error: "not_found" }, { status: 404 });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!stat.isFile()) return Response.json({ error: "not_found" }, { status: 404 });

  return new Response(fs.readFileSync(file) as unknown as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(file),
      "Content-Length": String(stat.size),
      // Private trips and unpublished drafts, like the export: never a shared
      // cache.
      "Cache-Control": "private, no-store",
    },
  });
}
