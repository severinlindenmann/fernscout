import "server-only";
import { isJournalWideScope, resolveSession, type Session } from "../../auth";
import { isAdminEmail } from "../../admin";
import { isEnabled } from "../../capabilities";
import { getUser } from "../../users";
import { fail } from "./route";
import { ERROR_CODES } from "../errorCodes";

/**
 * Bearer-token, journal-owner gate for a v2 route — B1609.
 *
 * v1's equivalent (`ownsUser`/`mayActAsOwner`/`authenticate` in
 * `lib/api/auth.ts`) is exactly this check, and this is a small, deliberate
 * re-statement of the *route glue* rather than an import: `test/api-v2-
 * imports.test.ts` refuses anything under `app/api/v2`/`lib/api/v2`
 * importing v1's route glue, and re-exporting that glue through a domain
 * module to dodge the mechanical check would keep the letter of the rule
 * while breaking its point — a v2 route is meant to depend on nothing v1's
 * routes depend on. If a second v2 resource needs the same gate, promote
 * this rather than copying it a third time.
 *
 * The one piece of actual *logic* this shares with v1 — whether a session's
 * scope is the unqualified, journal-wide one rather than a trip scope — is
 * not re-derived here: `isJournalWideScope` (`lib/auth/index.ts`) is the one
 * place that comparison happens, for both doors, because
 * `test/owner-gate.test.ts` (B240) fails on any *second* file comparing
 * `session.scope` against `SESSION_SCOPE.agent` directly. `lib/auth/` is
 * domain, not route glue, so importing it here is not the thing the v2
 * boundary refuses.
 *
 * Figures are a *journal-level* library, not a trip's — so unlike a trip
 * route, a trip-scoped agent token (`write:trip:<id>`) is refused here even
 * though it belongs to the right journal: seeing one trip does not make a
 * figure that every trip can reference somebody's to write.
 */
export type OwnerAuth = { ok: true; session: Session } | { ok: false; response: Response };

export async function requireJournalOwner(request: Request, username: string): Promise<OwnerAuth> {
  if (!isEnabled("auth")) {
    return { ok: false, response: fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404) };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: fail("missing_token", ERROR_CODES.missing_token) };
  }

  const session = await resolveSession(match[1].trim(), "agent");
  if (!session) {
    return { ok: false, response: fail("invalid_token", ERROR_CODES.invalid_token) };
  }

  const admin = isAdminEmail(session.email);
  if (!admin && session.owner !== username) {
    return {
      ok: false,
      response: fail(
        "out_of_scope",
        `This token is for a different journal than "${username}".`,
        undefined,
        403,
      ),
    };
  }

  // Journal-wide only — a trip-scoped token carries "write:trip:<id>"
  // instead and is refused here, same as `mayActAsOwner` refuses it in v1.
  if (!admin && !isJournalWideScope(session.scope)) {
    return {
      ok: false,
      response: fail(
        "forbidden",
        "This token is scoped to one trip. The figure library is the journal's, the same as its own default figures.",
        undefined,
        403,
      ),
    };
  }

  if (!admin) {
    const config = getUser(username);
    if (!config || config.owner.email !== session.email) {
      return { ok: false, response: fail("forbidden", ERROR_CODES.forbidden, undefined, 403) };
    }
  }

  return { ok: true, session };
}
