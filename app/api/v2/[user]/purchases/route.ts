// GET the journal's own purchase history — B1622, phase 2 step 4.
// money.md §2.2 "Reading the list": bearer, owner-scope only. A trip-scoped
// token already sees nothing of the balance on journalStatus, so it sees
// nothing of how it got there either.
import { creditsEnabled } from "@/lib/credits";
import { listPurchasesPage, toPurchaseDoc } from "@/lib/payments";
import { purchaseDoc } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/purchases">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal || !creditsEnabled()) {
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

  const { items, nextCursor } = await listPurchasesPage(user, { limit, cursor });
  const base = serverSite().url;
  const mailedTo = journal.owner.email ?? "";
  return ok({
    purchases: items.map((p) => purchaseDoc.parse(toPurchaseDoc(p, mailedTo, base))),
    next_cursor: nextCursor ?? null,
  });
}
