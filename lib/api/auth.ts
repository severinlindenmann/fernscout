import "server-only";
import { resolveSession, type Session } from "../auth";
import { isEnabled } from "../capabilities";
import { scopeAllows } from "../tripPeople";
import type { Trip } from "../types";

/**
 * Bearer-token authentication for the write API.
 *
 * Agent tokens arrive in an Authorization header and nowhere else. A guest
 * cookie presented here is refused by `resolveSession`, which checks the class
 * the session was issued as — the two are not interchangeable (decision 24).
 */

export type ApiAuth =
  | { ok: true; session: Session }
  | { ok: false; status: number; error: string };

export async function authenticate(request: Request): Promise<ApiAuth> {
  if (!isEnabled("auth")) {
    return { ok: false, status: 404, error: "auth_disabled" };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "missing_token" };
  }

  const session = await resolveSession(match[1].trim(), "agent");
  if (!session) {
    return { ok: false, status: 401, error: "invalid_token" };
  }
  return { ok: true, session };
}

/** A token is scoped to exactly one journal, and may not reach past it. */
export function ownsUser(session: Session, username: string): boolean {
  return session.owner === username;
}

export function errorResponse(auth: Extract<ApiAuth, { ok: false }>): Response {
  return Response.json(
    { error: auth.error },
    {
      status: auth.status,
      headers:
        auth.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="fernscout"' }
          : undefined,
    },
  );
}

/**
 * Whether this session may write to this particular trip.
 *
 * `ownsUser` above answers "is this the right journal"; this answers "and the
 * right trip within it". A journal's owner holds the unqualified
 * `write:content` and passes for everything. Somebody who merely took one trip
 * holds a scope naming it, and is refused on every other trip in the same
 * journal — being on somebody's Vietnam trip is not a reason to be able to
 * rewrite their honeymoon.
 */
export function mayWriteTrip(session: Session, trip: Trip): boolean {
  return ownsUser(session, trip.username) && scopeAllows(session.scope, trip);
}

/** What a listing endpoint may show: every trip the session can reach. */
export function writableTrips(session: Session, trips: Trip[]): Trip[] {
  return trips.filter((trip) => mayWriteTrip(session, trip));
}
