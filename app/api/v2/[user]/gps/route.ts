// GET /api/v2/{user}/gps — B1843 addendum: the raw location history's own
// months, for an agent, alongside the studio location page's own
// ConfirmPanel (`app/api/helper/[user]/gps/route.ts`, cookie-only, the same
// pairing `.../owner/tel` has for its own journal-wide resource).
//
// Owner only — `requireJournalOwner` refuses a trip-scoped token even for
// the right journal, the same gate `.../owner/tel` and `.../import` use: a
// location history covers every day of somebody's life, not the days one
// trip's token was there for.
//
// **There is no `DELETE` here** — security review, 2026-09-24. There used to
// be one, purging for real straight from a bearer token: a single call with
// no second step, for the one category of data AGENTS.md calls "the most
// sensitive thing in this repository". Every other destructive door in this
// codebase (`lib/deletions.ts`'s journal and trip delete, both reachable
// over `/api/v2`) answers a `DELETE` with a mailed confirmation link and
// removes nothing until the owner follows it — "an identity cookie proves an
// address and grants nothing by itself" is the same idea one step further
// back. Building that whole mail-token-link machinery for one more resource
// was weighed against a bearer-facing door that can never delete anything at
// all; see the ticket's "Security review at merge" note for the reasoning.
// A route handler that answered every `DELETE` with the same 403 would still
// need `/openapi.json` to document a success response nothing could ever
// return (`test/openapi-v2-contract.test.ts` requires one of each per
// operation) — dishonest either way. Leaving the export out entirely is
// truthful instead: Next answers an unexported method with its own 405, and
// there is no operation here for the document to lie about.
//
// The real purge stays reachable exactly one way: the owner's own browser,
// signed in, on the studio's location page — `app/api/helper/[user]/gps`,
// behind `ConfirmPanel`.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getUser } from "@/lib/users";
import { gpsMonthsHeld } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/gps">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("unknown_user", ERROR_CODES.unknown_user, undefined, 404);

  return ok({ monthsHeld: gpsMonthsHeld(user) });
}
