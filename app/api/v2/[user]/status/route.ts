// GET /api/v2/{user}/status — where this journal and this token stand.
// B1608, phase 2 step 3.
import { journalStatus } from "@/lib/api/v2/schemas";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { buildJournalStatus } from "@/lib/api/v2/status";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/status">) {
  const { user } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const status = await buildJournalStatus(user, bearer.session);
  return ok(journalStatus.parse(status));
}
