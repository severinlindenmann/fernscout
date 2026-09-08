import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { attachStagedFiles } from "@/lib/api/staged";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * Put photographs that are already waiting on a day — B915.
 *
 * The files pane (B902) could tick two photographs in the inbox and hear the
 * sentence "put these on yesterday" understood, and then it ended in a link:
 * the only route that could move a staged file onto a day was the JSON branch
 * of `POST /api/v1/<user>/trips/<trip>/media`, which reads a bearer token, and
 * a browser here holds a cookie and no token.
 *
 * So this is that door with this family's credential — cookie, owner, bearer
 * never looked at (`isHelperOwner`) — and **not a second implementation**:
 * `attachStagedFiles` (lib/api/staged.ts) is the same resolve-store-empty that
 * the v1 route now calls, so a duplicate is recognised, the quota is enforced
 * and the inbox is emptied identically whichever door was used.
 *
 * `moved` is what the answer carries that the v1 route's does not: the ids
 * that have left the inbox, so the pane that offered them stops offering them
 * without re-reading the whole journal. `draft` and `preview` are what every
 * other write here answers with, so the room's preview pane re-reads disk
 * rather than patching its own idea of the day.
 *
 * Nothing here uploads bytes: `../media/route.ts` is that door and stays it.
 * This one only ever moves a file the journal already has.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/attach">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = String(body.trip ?? "").trim();
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const slug = String(body.slug ?? body.day ?? "").trim();
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  // A list or one comma-separated string: the proposal's own field is a
  // string, because a proposal field is a thing a person can read and type
  // over, and an array is neither.
  const files = (Array.isArray(body.files) ? body.files : String(body.files ?? "").split(","))
    .map((one) => String(one).trim())
    .filter((one) => one !== "");
  if (files.length === 0) return Response.json({ error: "expected_files" }, { status: 400 });

  const moved = await attachStagedFiles(user, ref, slug, files);
  if (!moved.ok) {
    return Response.json(
      moved.error === "invalid_media"
        ? { error: "invalid_media", problems: moved.problems }
        : { error: "unknown_inbox_file", missing: moved.missing },
      { status: 400 },
    );
  }
  if (!moved.attached.ok) {
    // The files are in the trip either way — say which failure it was rather
    // than a bare 500, the same as the v1 route's `note` does.
    return Response.json({ error: "not_attached", why: moved.attached.error }, { status: 400 });
  }

  wrote(user, "attach_files", {
    trip: tripId,
    slug,
    attached: moved.attached.attached,
    skipped: moved.skipped.length,
  });
  return Response.json(
    {
      ok: true,
      attached: moved.attached.attached,
      // A photograph the day already had, byte for byte. Not an error and not
      // a second copy — `storeUploads` recognises it, and it has still left
      // the inbox, so the pane is right to stop offering it.
      skipped: moved.skipped.length,
      moved: moved.moved,
      draft: dayForWizard(user, tripId, slug),
      preview: previewOf(user, tripId, slug),
    },
    { status: 201 },
  );
}
