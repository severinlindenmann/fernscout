import "server-only";
import { resolveSession, type Session } from "../auth";
import { isEnabled } from "../capabilities";
import { tripWriteVerdict } from "../tripPeople";
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

/**
 * Why a call was refused, in words.
 *
 * `auth_disabled` is the one that needed saying. It answers 404, and so does
 * "no such trip" — two very different instructions wearing the same status:
 * one means "fix the trip id and try again", the other means "this server does
 * not do tokens at all, stop". The `error` field has always distinguished
 * them, but an agent reading a bare `{"error":"auth_disabled"}` on a URL it
 * built correctly is entitled to think it built it wrong.
 *
 * 404 rather than 403 for a capability that is off is deliberate and stays:
 * an endpoint that is not offered should not confirm it exists.
 */
const EXPLANATIONS: Record<string, string> = {
  auth_disabled:
    "This server has authentication switched off, so no token can be issued and no write " +
    "endpoint will work — whatever trip you name. This is the operator's setting, not a " +
    "mistake in your request: nothing you can send will change it. /api/health says which " +
    "capabilities are on and why the others are not.",
  missing_token: "Send the token as `Authorization: Bearer <token>`, and nowhere else.",
  invalid_token:
    "The token is unknown, revoked or expired. Ask for a new code at POST /api/auth/request.",
  // Deliberately not the `invalid_token` wording above. That one says "ask for
  // a new code", which is exactly wrong here: they would ask, and
  // /api/auth/request would refuse them for the same reason this did. Saying
  // so once is kinder than a loop.
  access_revoked:
    "Your access to this trip has been withdrawn by the journal's owner, so this token can no " +
    "longer write to it. A new code will not be issued for it either — ask the owner directly.",
};

export function errorResponse(auth: Extract<ApiAuth, { ok: false }>): Response {
  const message = EXPLANATIONS[auth.error];
  return Response.json(
    { error: auth.error, ...(message ? { message } : {}) },
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
 *
 * Async since B98: a trip-scoped token is measured against who is on the trip
 * *now*, not against the scope string it was minted with. See
 * `tripWriteVerdict`.
 */
export type TripWriteGate =
  | { ok: true }
  | { ok: false; status: 404; error: "unknown_trip" }
  | { ok: false; status: 403; error: "access_revoked" };

const UNKNOWN_TRIP: TripWriteGate = { ok: false, status: 404, error: "unknown_trip" };

export async function mayWriteTrip(session: Session, trip: Trip): Promise<TripWriteGate> {
  if (!ownsUser(session, trip.username)) return UNKNOWN_TRIP;
  switch (await tripWriteVerdict(session.scope, session.email, trip)) {
    case "allowed":
      return { ok: true };
    case "revoked":
      return { ok: false, status: 403, error: "access_revoked" };
    default:
      return UNKNOWN_TRIP;
  }
}

/**
 * The refusal, as a response.
 *
 * A trip that does not exist and a trip that is not yours answer the same 404
 * — /agent.md promises they "answer as if it did not exist", and answering 403
 * for the ones that exist would let a token scoped to one trip enumerate the
 * journal's others by guessing ids. Somebody whose access was revoked is the
 * exception: the token already names that one trip, so naming the reason tells
 * them nothing they did not know and saves them asking for a code that will
 * not be issued.
 */
export function refuseWrite(gate: Extract<TripWriteGate, { ok: false }>): Response {
  const message = EXPLANATIONS[gate.error];
  return Response.json(
    { error: gate.error, ...(message ? { message } : {}) },
    { status: gate.status },
  );
}

/** What a listing endpoint may show: every trip the session can reach. */
export async function writableTrips(session: Session, trips: Trip[]): Promise<Trip[]> {
  const gates = await Promise.all(trips.map((trip) => mayWriteTrip(session, trip)));
  return trips.filter((_, at) => gates[at].ok);
}
