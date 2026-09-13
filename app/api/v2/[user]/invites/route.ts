// GET /api/v2/{user}/invites — B1623, phase 2 step 4.
//
// Listing only; PUT /api/v2/{user}/invites/{id} is the create door (S2/V10 —
// every client-chosen-id create is a PUT, so the area design's own "POST
// /api/v2/{user}/invites" is superseded by the golden contract). See
// [id]/route.ts.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, paginate } from "@/lib/api/v2/route";
import { contactsReady, inviteToDoc } from "@/lib/api/v2/social";
import { listInvites } from "@/lib/contacts/invites";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The listing itself, apart from who is asking — B1595. Called here after
 * `requireJournalOwner` (bearer), and by `app/api/web/[user]/invites/route.ts`
 * after its own cookie-only `isOwner` check — both already know the journal
 * exists and has `contacts` on (`contactsReady`) by the time they call this.
 */
export async function invitesListResponse(user: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  let limit = DEFAULT_LIMIT;
  const limitParam = url.searchParams.get("limit");
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return fail("invalid_request", `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    limit = n;
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const all = (await listInvites(user)).map(inviteToDoc);
  const { items, nextCursor } = paginate(all, { limit, cursor }, (d) => d.id);
  return ok({ invites: items, next_cursor: nextCursor });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/invites">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const ready = await contactsReady(user);
  if (!ready.ok) return ready.response;
  return invitesListResponse(user, request);
}
