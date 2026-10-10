import { withV2Log } from "@/lib/api/v2/route";
import { applyVisitedPhotoDelete, applyVisitedPhotoPut } from "@/lib/api/v2/visitedApply";
import { requireJournalOwner } from "@/lib/api/v2/auth";

export const dynamic = "force-dynamic";

/** `PUT /api/v2/{user}/visited/{code}/photo` (multipart, bytes under `file`)
 * sets the entry's one photograph through the ordinary image ingest; `DELETE`
 * detaches it. Owner only. */
export const PUT = withV2Log(async function PUT(request: Request, { params }: RouteContext<"/api/v2/[user]/visited/[code]/photo">) {
  const { user, code } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return applyVisitedPhotoPut(user, code, request);
}, { route: "/api/v2/[user]/visited/[code]/photo" });

export const DELETE = withV2Log(async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/visited/[code]/photo">) {
  const { user, code } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return applyVisitedPhotoDelete(user, code);
}, { route: "/api/v2/[user]/visited/[code]/photo" });
