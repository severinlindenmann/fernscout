// GET where this journal's space is going — B1622, phase 2 step 4
// (money.md §2.6), replacing the GET half of
// app/api/v1/[user]/storage/route.ts. There is no credit-funded way to buy
// more any more (B2592); a plan's own storage ceiling is set at checkout.
//
// Bearer, any scope — money.md's open question 4, adopted: a trip-scoped
// token cannot see another trip's bytes in `breakdown`, but it can still see
// that the journal overall is full, which is what stops it starting an
// upload batch it cannot finish.
import { describeScope } from "@/lib/auth";
import { resolveBearer, outOfScopeRefusal, ownsUser } from "@/lib/api/v2/auth";
import { cleanupPlan } from "@/lib/storageCleanup";
import { storageBreakdown, storageFor } from "@/lib/storageQuota";
import { fail, ok, withV2Log } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const GET = withV2Log(async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/storage">) {
  const { user } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const auth = await resolveBearer(request);
  if (!auth.ok) return auth.response;
  if (!ownsUser(auth.session, user)) return outOfScopeRefusal(auth.session, user);

  const usage = await storageFor(user);
  const scope = describeScope(auth.session);
  let rows = storageBreakdown(user).filter((row) => row.bytes > 0);
  if (scope.scope === "trip") {
    // A trip-scoped token sees its own trip and one `other` catch-all —
    // never another trip's bytes.
    const own = rows.filter((row) => row.key === `trip:${scope.trip}`);
    const rest = rows.filter((row) => row.key !== `trip:${scope.trip}`);
    const otherBytes = rest.reduce((n, row) => n + row.bytes, 0);
    rows = otherBytes > 0 ? [...own, { key: "other", label: "Everything else", bytes: otherBytes }] : own;
  }

  return ok({
    ...usage,
    breakdown: rows,
    reclaimable: await cleanupPlan(user),
  });
}, { route: "/api/v2/[user]/storage" });
