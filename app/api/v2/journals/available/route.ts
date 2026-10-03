// GET /api/v2/journals/available?username= — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §10, open question: `POST
// /api/v2/journals` failing with `username_taken`/`reserved_username` was the
// only way to learn a name was gone before spending a create call on it.
// Read-only, no auth needed — it discloses nothing a failed create wouldn't,
// the same shape `geocode` already sets a precedent for as a bare,
// journal-unscoped utility route.
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import fs from "node:fs";
import { isReservedUsername, isValidUsername, userDir } from "@/lib/users";
import { getUser } from "@/lib/users";
import { isDeletedUsername } from "@/lib/tombstones";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const username = new URL(request.url).searchParams.get("username")?.trim().toLowerCase() ?? "";
  if (!username) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} Send ?username=<the name to check>.`, undefined, 400);
  }
  if (!isValidUsername(username)) {
    return ok({ username, available: false, reason: "invalid_username" });
  }
  // B-2808. The same questions `createJournal` asks, in a stranger-safe voice:
  // a folder on disk (even one with no readable config) and a deleted
  // journal's tombstone both read as plain "taken" — this route is open, so it
  // must not say a name once belonged to somebody. The create call still
  // answers `deleted_username` to the one address entitled to know.
  // (The registry locks are keyed by email and number, not by name, so there
  // is no lock for a name to be found here.)
  if (getUser(username) || fs.existsSync(userDir(username)) || isDeletedUsername(username)) {
    return ok({ username, available: false, reason: "username_taken" });
  }
  if (isReservedUsername(username)) {
    return ok({ username, available: false, reason: "reserved_username" });
  }
  return ok({ username, available: true });
}
