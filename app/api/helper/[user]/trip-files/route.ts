import { isHelperOwner, notYourJournal, tripFilesForRoom } from "@/lib/helper/server";

export const dynamic = "force-dynamic";

/**
 * One named trip's own photographs, loaded only once a person actually asks
 * for them — B1573.
 *
 * The room's own page load already lists every trip cheaply
 * (`filesForRoom`'s `trips`, id and title only); this is the on-demand half,
 * so a journal with several trips does not pay for every trip's media on
 * every visit when at most one is ever picked. Cookie only, owner only,
 * outside `/api/v1` and outside the published contract — the same shape
 * every other `app/api/helper/` route takes, for the reason
 * `../day/route.ts` gives at length: a browser page, not a second bearer-
 * accepting write surface `/openapi.json` would then be lying about.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip-files">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const tripId = new URL(request.url).searchParams.get("trip") ?? "";
  const found = tripFilesForRoom(user, tripId);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });

  return Response.json({ ok: true, title: found.title, files: found.files });
}
