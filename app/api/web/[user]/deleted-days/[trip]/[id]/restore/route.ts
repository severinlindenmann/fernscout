// POST /api/web/{user}/deleted-days/{trip}/{id}/restore — putting a deleted
// day back, from the studio's "Recently deleted" — B2259.
//
// The owner's cookie only, any `Authorization` header refused, the same shape
// as the sibling day doors. The day comes back as a draft whatever it was
// before: publishing it again is the owner's own step. There is no v2 door —
// the agent API's delete removes drafts outright and keeps no trash.
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { restoreDay } from "@/lib/dayTrash";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { unknown_deleted_day: 404, unknown_trip: 404, slug_taken: 409, not_restored: 409 };

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/deleted-days/[trip]/[id]/restore">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser. Restoring a deleted day is the owner's step." },
      { status: 403 },
    );
  }
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  }

  const { user, trip: tripId, id } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const restored = restoreDay(user, tripId, id);
  if (!restored.ok) {
    return Response.json({ error: restored.error, message: restored.message }, { status: STATUS[restored.error] ?? 409 });
  }
  const slug = restored.stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return Response.json({ ok: true, trip: tripId, slug: restored.stem, status: "draft", href: `/${user}/trips/${tripId}/day/${slug}` });
}
