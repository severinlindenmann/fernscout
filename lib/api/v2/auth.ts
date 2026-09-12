// Bearer-token resolution for v2 routes — B1608, phase 2 step 3.
//
// Reuses v1's ownership/scope logic from `lib/api/auth.ts` (`ownsUser`,
// `mayActAsOwner`, `mayWriteTrip`, `writableTrips`) rather than
// reimplementing it: those four are the domain question "who is this token
// and what may it touch", already built and already tested, and duplicating
// access-control logic is exactly the kind of change `claude-security`
// exists to catch. What is NOT reused from that file is `errorResponse`,
// `outOfScope` and `refuseWrite` — those build v1-shaped `Response` bodies,
// which is route glue; a v2 refusal goes through `fail()` instead, so every
// v2 refusal keeps the one error envelope this whole contract promises.
import { authenticate, mayActAsOwner, ownsUser, type ApiAuth } from "../auth";
import type { Session } from "../../auth";
import { fail } from "./route";
import { ERROR_CODES } from "../errorCodes";

export type BearerAuth = { ok: true; session: Session } | { ok: false; response: ReturnType<typeof fail> };

/** `authenticate()` from lib/api/auth.ts, reshaped into a v2 refusal rather
 * than a v1 one. Every code it can answer with is already in `ERROR_CODES`. */
export async function resolveBearer(request: Request): Promise<BearerAuth> {
  const auth: ApiAuth = await authenticate(request);
  if (auth.ok) return { ok: true, session: auth.session };
  const status = auth.status;
  const message =
    auth.error === "auth_disabled"
      ? ERROR_CODES.auth_disabled
      : auth.error === "missing_token"
        ? ERROR_CODES.missing_token
        : ERROR_CODES.invalid_token;
  return { ok: false, response: fail(auth.error as "auth_disabled" | "missing_token" | "invalid_token", message, undefined, status) };
}

/** The `out_of_scope` refusal, in v2's envelope — same wording as v1's
 * `outOfScope` (lib/api/auth.ts), reshaped through `fail()` rather than
 * imported, since that function builds a `Response` of its own. */
export function outOfScopeRefusal(session: Session, username: string) {
  return fail(
    "out_of_scope",
    `This token is for ${session.owner ? `"${session.owner}"` : "a different journal"}, and this ` +
      `call is about "${username}". A token belongs to one journal; ask for one for this journal ` +
      `with POST /api/auth/codes and /api/auth/codes/redeem, both with "for": "write".`,
    undefined,
    403,
  );
}

/** The `forbidden` refusal for a trip-scoped token reaching an owner-only
 * v2 call — journal-wide edits and deletion are the owner's, not a trip's. */
export function ownerOnlyRefusal() {
  return fail(
    "forbidden",
    "This call is the journal owner's, and this token is scoped to one trip. Writing to a trip " +
      "and changing the journal around it are different authorities.",
    undefined,
    403,
  );
}

export { ownsUser, mayActAsOwner };

/**
 * The whole owner gate in one call — B1609, folded in when the figures
 * parcel and the journal parcel turned out to have written the same thing
 * twice in parallel worktrees.
 *
 * A journal-level resource — the journal document itself, its default figure
 * set, the figure library every trip references — is the **owner's**, and a
 * trip-scoped token is refused even though it belongs to the right journal.
 * Being on one trip does not make a figure that every trip can reference
 * yours to write, which is the same line `mayActAsOwner` draws in v1 and the
 * same line publishing draws: writing to a trip and changing the journal
 * around it are different authorities.
 *
 * A trip's own routes do NOT use this — they ask `mayWriteTrip`, because a
 * trip-scoped token is exactly what is meant to write there.
 */
export type OwnerAuth = { ok: true; session: Session } | { ok: false; response: ReturnType<typeof fail> };

export async function requireJournalOwner(request: Request, username: string): Promise<OwnerAuth> {
  const auth = await resolveBearer(request);
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!ownsUser(session, username)) return { ok: false, response: outOfScopeRefusal(session, username) };
  if (!mayActAsOwner(session, username)) return { ok: false, response: ownerOnlyRefusal() };
  return { ok: true, session };
}
