import { applyVisitedDelete, applyVisitedGet, applyVisitedPatch } from "@/lib/api/v2/visitedApply";
import { mayActAsOwner, outOfScopeRefusal, ownsUser, requireJournalOwner, resolveBearer } from "@/lib/api/v2/auth";
import { getUser } from "@/lib/users";
import { fail, withV2Log } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const dynamic = "force-dynamic";

/** `GET/PATCH/DELETE /api/v2/{user}/visited/{code}` — one country, by its
 * ISO code. Writes are the owner's; a read of an entry this token may not see
 * is `not_found`, like an entry that is not there. */
export const GET = withV2Log(async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/visited/[code]">) {
  const { user, code } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  return applyVisitedGet(user, code, { owner: mayActAsOwner(bearer.session, user), guest: false, close: false });
}, { route: "/api/v2/[user]/visited/[code]" });

export const PATCH = withV2Log(async function PATCH(request: Request, { params }: RouteContext<"/api/v2/[user]/visited/[code]">) {
  const { user, code } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return applyVisitedPatch(user, code, request);
}, { route: "/api/v2/[user]/visited/[code]" });

export const DELETE = withV2Log(async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/visited/[code]">) {
  const { user, code } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return applyVisitedDelete(user, code);
}, { route: "/api/v2/[user]/visited/[code]" });
