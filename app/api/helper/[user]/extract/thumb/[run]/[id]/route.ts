import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resizedCopy } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { stagedFileLocation } from "@/lib/staging/store";

export const dynamic = "force-dynamic";

/**
 * A thumbnail for one photograph mid-import — B1803 Task 1.1.
 *
 * The spine of the whole camera-roll import: every screen in the guided flow
 * asks about photographs the person cannot otherwise see, because until this
 * route existed nothing served a byte out of `content/<user>/staging/`. This
 * is the sibling of `app/api/helper/[user]/inbox/[id]/thumbnail/route.ts`,
 * which solves the identical problem for the undated inbox — same guards,
 * same order, same reasoning, against `lib/staging/store.ts` instead of
 * `lib/inbox.ts`.
 *
 * - **Capability, then owner.** `isEnabled("extract", user)` first — a 404
 *   before the door guard even runs, so a journal with the capability off
 *   answers exactly like one that does not exist. `isHelperOwner` reads the
 *   signed-in cookie the rest of `app/api/helper/` reads, never a bearer
 *   token, and a caller with no session or the wrong one gets
 *   `notYourJournal`'s 404, never a 403 that would confirm something is
 *   there.
 * - **The id is resolved through `stagedFileLocation`, never joined into a
 *   path.** It applies `path.basename(id)` before touching the filesystem —
 *   the same guard `readStagedFile` applies — so a traversal id collapses to
 *   one segment and is looked up only inside *this* username's own run,
 *   nowhere else.
 * - **Another journal's real run id resolves to nothing here too.**
 *   `runDir` builds the path from `username` and `runId` together
 *   (`lib/staging/paths.ts`), so a run that is real but staged under a
 *   different username is not reachable by asking for it under this one —
 *   this falls out of the path arithmetic, nothing extra to check. A bad
 *   run id (one `runDir`'s segment validation rejects) throws rather than
 *   resolving anywhere, and is caught below into the same 404.
 * - **A derivative, never the original.** `resizedCopy` makes a resized WebP
 *   copy in the site's own image cache and hands back those bytes; the
 *   staged file's own path is never put on the wire.
 * - **`private, no-store`.** The same URL answers differently for every
 *   journal, so nothing here may sit in a shared cache.
 *
 * A video has no still to serve. `resizedCopy` only resizes the image
 * extensions it knows (`lib/media.ts`'s `RESIZABLE`), so a `.mov` — and a
 * HEIC, which sharp also cannot resize — falls straight through to the same
 * 404 a missing id gets. The caller draws its own placeholder; nothing here
 * invents a poster frame.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/thumb/[run]/[id]">,
) {
  const { user, run, id } = await params;
  if (!isEnabled("extract", user)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  let file: string | null;
  try {
    file = stagedFileLocation(user, run, id);
  } catch {
    // `runDir`'s segment validation threw on a bad run id — same 404 as any
    // other lookup that finds nothing.
    file = null;
  }
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const width = parseWidth(new URL(request.url).searchParams.get("w")) ?? 320;
  const thumbnail = await resizedCopy(file, width);
  // `resizedCopy` returns null for a format sharp cannot resize (HEIC, a
  // video) — the caller falls back to its own placeholder for those.
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
