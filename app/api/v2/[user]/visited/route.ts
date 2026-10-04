import { applyVisitedCreate, applyVisitedList } from "@/lib/api/v2/visitedApply";
import { mayActAsOwner, outOfScopeRefusal, ownsUser, requireJournalOwner, resolveBearer } from "@/lib/api/v2/auth";
import { getUser } from "@/lib/users";
import { fail } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v2/{user}/visited` — the countries recorded without a trip, as
 * far as this token may see them. The owner's token sees every entry; any
 * other token for this journal sees only `public` ones (a bearer token is
 * never a guest — guests read in a browser). `POST` adds one country
 * (`{country, …}`) or many (`{entries: […]}`); owner only.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/visited">) {
  const { user } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  return applyVisitedList(user, { owner: mayActAsOwner(bearer.session, user), guest: false, close: false });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/visited">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return applyVisitedCreate(user, request);
}
