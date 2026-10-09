import { getUser } from "@/lib/users";
import { DEFAULT_FIGURES_LIMIT, MAX_FIGURES_LIMIT, listFiguresPage } from "@/lib/figures";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, withV2Log } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v2/{user}/figures` — every figure in the journal's library, one
 * page at a time (V12: `?limit=&cursor=`/`next_cursor`).
 *
 * Owner only, the same gate v1's `GET /api/v1/{user}/travellers` (the
 * journal's default *set*, retired under B1632) already used — a figure may
 * carry `person`, an email tying it to somebody, which is not a vocabulary
 * and not open the way `.../presets` is.
 */
export const GET = withV2Log(async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/figures">) {
  const { user } = await params;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  if (!getUser(user)) {
    return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  }

  const url = new URL(request.url);
  let limit = DEFAULT_FIGURES_LIMIT;
  const limitParam = url.searchParams.get("limit");
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > MAX_FIGURES_LIMIT) {
      return fail(
        "invalid_request",
        `limit must be a whole number from 1 to ${MAX_FIGURES_LIMIT}.`,
      );
    }
    limit = n;
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const { items, nextCursor } = listFiguresPage(user, { limit, cursor });
  const response = ok({ figures: items, next_cursor: nextCursor });

  return response;
}, { route: "/api/v2/[user]/figures" });
