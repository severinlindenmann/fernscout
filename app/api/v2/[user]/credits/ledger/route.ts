// GET the journal's own credit ledger — B1622, phase 2 step 4 (money.md
// §2.3). New surface: v1 has no HTTP door for this at all (`npm run credits
// -- list` is CLI-only). Read-only, bearer, owner-scope only — the same
// reasoning as the purchases list beside it.
import { creditsEnabled, ledgerPage } from "@/lib/credits";
import { ledgerRow } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/credits/ledger">) {
  const { user } = await params;
  if (!getUser(user) || !creditsEnabled()) {
    return fail("credits_disabled", ERROR_CODES.credits_disabled, undefined, 404);
  }

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  let limit = DEFAULT_LIMIT;
  const limitParam = url.searchParams.get("limit");
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return fail("invalid_request", `${ERROR_CODES.invalid_request} limit must be a whole number from 1 to ${MAX_LIMIT}.`, undefined, 400);
    }
    limit = n;
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const { items, nextCursor } = await ledgerPage(user, { limit, cursor });
  return ok({ ledger: items.map((row) => ledgerRow.parse(row)), next_cursor: nextCursor ?? null });
}
