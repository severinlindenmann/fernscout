import { detachGallery } from "@/lib/api/entries";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * Take one photograph off a day — from the room, not only from the wizard.
 *
 * `../media/route.ts`'s own `DELETE` has done this since B851, with the same
 * credential: cookie, owner, bearer never looked at. It cannot be the door a
 * press here uses, though — a proposal's press is always a `POST` or a
 * `PATCH` (`Tool["method"]`, `lib/helper/tools/types.ts`), because the
 * browser composes the request from the registry and the registry declares
 * no third verb. So this is that same call, `detachGallery` and all, behind a
 * door the press can actually reach; the rule about what a removal *is* — the
 * derivative and the kept original both gone, a `src` the day does not carry
 * refused rather than removing the nearest thing to it — lives in that one
 * function and nowhere else.
 *
 * **It does not come back**, and `remove_photo`'s own card
 * (`lib/helper/tools/areas/files.ts`) says so before the button rather than
 * after it, with the photograph itself in the preview above the press.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/remove-photo">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = String(body.trip ?? "").trim();
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) {
    refused(user, "remove_photo", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const slug = String(body.slug ?? "").trim();
  const src = String(body.src ?? "").trim();
  if (!src) {
    refused(user, "remove_photo", "expected_src");
    return Response.json({ error: "expected_src" }, { status: 400 });
  }

  const removed = detachGallery(ref, slug, [src]);
  if (!removed.ok) {
    refused(user, "remove_photo", removed.error);
    return Response.json(
      { error: removed.error, ...(removed.error === "unknown_media" ? { problems: removed.problems } : {}) },
      { status: removed.error === "unknown_day" ? 404 : 400 },
    );
  }

  wrote(user, "remove_photo", { trip: tripId, slug, removed: removed.removed.map((item) => item.src) });
  return Response.json({
    ok: true,
    removed: removed.removed.map((item) => item.src),
    draft: dayForWizard(user, tripId, slug),
    preview: previewOf(user, tripId, slug),
  });
}
