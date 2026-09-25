// GET /api/v2/{user}/status — where this journal and this token stand.
// B1608, phase 2 step 3.
import { journalStatus } from "@/lib/api/v2/schemas";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { gpsWriteOnlyRefusal, isGpsWriteScope, outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { buildJournalStatus } from "@/lib/api/v2/status";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/status">) {
  const { user } = await params;
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  // B2204: `write:gps` is refused here rather than described — `describeScope`
  // (which `buildJournalStatus` calls for `token`) has no third value to give
  // it, on purpose, so this token never reaches that call at all.
  if (isGpsWriteScope(bearer.session)) return gpsWriteOnlyRefusal();

  const status = await buildJournalStatus(user, bearer.session);
  return ok(journalStatus.parse(status));
}
