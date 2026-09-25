// POST .../trips/{trip}/rename — B2015.
//
// Owner-only, the same gate `.../days/{slug}/move` uses (`requireJournalOwner`)
// and for the same reason as that door's own comment: a trip-scoped (buddy)
// token is refused rather than only checked against one side. `mayActAsOwner`
// covers both an unscoped owner token AND the journal's `FERNSCOUT_ADMIN_EMAIL`
// operator, same as every other owner-only v2 mutation (PATCH trip, the
// visibility fields folded into it, move/split/merge) — a correction to a
// trip's own address is the same authority as a correction to its content,
// not the mail-gated, human-only kind `DELETE .../trips/{trip}` is. That is
// the deliberate difference: a rename loses nothing (the old address keeps
// answering, via the redirect record) where a delete takes photographs with
// it, so this does not need the second, human-only step deletion does.
import { tripRenameRequest, tripRenameResult } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getUser } from "@/lib/users";
import { renameTrip } from "@/lib/tripRename";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

type RouteCtx = RouteContext<"/api/v2/[user]/trips/[trip]/rename">;

export async function POST(request: Request, { params }: RouteCtx) {
  const { user, trip } = await params;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = tripRenameRequest.safeParse(jsonBody.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error), 400);
  }

  const renamed = await renameTrip(user, trip, parsed.data.id);
  if (!renamed.ok) {
    switch (renamed.error) {
      case "unknown_trip":
        return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
      case "invalid_trip_id":
        return fail("invalid_trip_id", ERROR_CODES.invalid_trip_id, undefined, 400);
      case "same_id":
        return fail(
          "invalid_request",
          `${ERROR_CODES.invalid_request} "id" is the trip's own current id — nothing to rename.`,
          undefined,
          400,
        );
      case "trip_id_taken":
        return fail("trip_id_taken", ERROR_CODES.trip_id_taken, undefined, 409);
      default: {
        const exhaustive: never = renamed.error;
        throw new Error(`unhandled rename error: ${String(exhaustive)}`);
      }
    }
  }

  return ok(tripRenameResult.parse({ ok: true, id: renamed.id }));
}
