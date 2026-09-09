import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resizedCopy } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { findInboxFile } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * A thumbnail for one waiting photograph — B1123.
 *
 * `content/<user>/inbox/` is reachable by no other URL, deliberately
 * (`lib/inbox.ts`): a file nobody has filed onto a day is not published, and
 * this route does not change that. What it adds is the one thing the files
 * pane needs and nothing else does — a small derivative of a photograph that
 * is still waiting, so a person can tell two waiting photographs apart before
 * either has a day.
 *
 * **The whole attack surface is here, so the guards are deliberate and
 * layered:**
 *
 * - **Owner only.** `isHelperOwner` reads the signed-in cookie the rest of
 *   the helper family reads, never a bearer token — the same reasoning as
 *   every other route under `app/api/helper/`. A caller with no session, or
 *   the wrong one, gets `notYourJournal`'s 404 (or 401 for no session at
 *   all), never a 403 that would confirm something is there.
 * - **The id is resolved through `findInboxFile`, never joined into a path.**
 *   That function's own guard is `path.basename(id)` before it ever touches
 *   the filesystem, so `../../other-user/inbox/media/x.jpg` collapses to the
 *   single segment `x.jpg` and is looked up inside *this* username's own
 *   inbox directories and nowhere else — traversal is impossible by
 *   construction, not filtered after the fact.
 * - **A different journal's real id is a 404 here too**, for the same reason:
 *   `findInboxFile(user, id)` only ever looks under `inboxDir(user, kind)`,
 *   so an id that is real but belongs to somebody else's journal resolves to
 *   nothing under this one.
 * - **A derivative, never the original.** `resizedCopy` makes a resized WebP
 *   copy in the site's own image cache and hands back those bytes; the
 *   original file path this route resolved is never put on the wire.
 * - **`private, no-store`.** Unlike a published photograph's long-lived
 *   `public` cache on `app/[user]/media/…`, nothing here may sit in a shared
 *   cache: the same URL answers differently for every journal, and a shared
 *   cache cannot tell that apart.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox/[id]/thumbnail">,
) {
  const { user, id } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const found = findInboxFile(user, id);
  // Not a photograph or video, or no id this journal recognises: 404 either
  // way, so the response never says which is true.
  if (!found || found.entry.kind !== "media") {
    return new Response("Not found", { status: 404 });
  }

  const width = parseWidth(new URL(request.url).searchParams.get("w")) ?? 320;
  const thumbnail = await resizedCopy(found.file, width);
  // `resizedCopy` returns null for a format sharp cannot resize (HEIC, a
  // video) — the pane falls back to its typed icon for those, the same as it
  // already does for a document.
  if (!thumbnail) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(thumbnail), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(thumbnail.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
