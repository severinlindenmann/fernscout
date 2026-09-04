import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getAllCounts, getVotesFor, vote } from "@/lib/reactions";
import { mayReadTrip } from "@/lib/tripGate";
import { getTrip, parseTripRef } from "@/lib/trips";
import type { Trip } from "@/lib/types";
import { getUser } from "@/lib/users";

// Reads and writes reader data on every call — never prerender or cache it.
export const dynamic = "force-dynamic";

/**
 * Reactions, for the reader looking at a day.
 *
 * **This is a gated read route, and it did not used to know that.** Until B232
 * both verbs resolved the trip with `getTrip` and stopped: a `private` trip
 * answered `200` where a trip that was never written answered `400`, so the
 * endpoint was an existence oracle over trip ids — which are chosen by hand
 * and guessable by construction. That is the premise of B117, the ticket that
 * took a closed trip's *title* off its own sign-in gate. Worse, `getAllCounts`
 * is keyed by day slug and a slug is `slugify(title)`, so a closed trip
 * anybody had reacted to published a lossy copy of its day titles — and
 * `POST` gated on the same `getTrip`, which is what let a stranger create the
 * rows that made the leak self-serve.
 *
 * Two rules hold it shut, and both are about *sameness* rather than refusal:
 *
 * - **A trip nobody may read answers exactly as a trip that does not exist**:
 *   `400 unknown_trip`, the same body, byte for byte. Refusing differently
 *   would only move the oracle. `mayWriteTrip` in lib/api/auth.ts states the
 *   same property for the write routes and explains it at length.
 * - **A journal with reactions switched off answers exactly as a journal that
 *   does not exist**: `404 reactions_disabled`. That is the idiom the contacts
 *   routes already use (`!getUser(user) || !isEnabled(…)`), and taking it
 *   whole means the capability check cannot become a second oracle over
 *   journal names. A capability that is off must be *absent*, not an empty
 *   panel — B165, one endpoint over.
 *
 * `mayReadTrip` reads the guest cookie, so a reader the owner has let in still
 * sees and records reactions; `ReactionsProvider` fetches same-origin, and
 * `fetch` sends cookies for that by default.
 *
 * `getVotesFor` is left ungated on purpose: it is already scoped to the
 * journal (`scopeToJournal`) and answers only about the voter id the caller
 * supplied, which is that browser's own random id. Guessing one is B239.
 */

/** The one refusal for "no such trip", and for "not yours to read". */
function unknownTrip() {
  return NextResponse.json({ error: "unknown_trip" }, { status: 400 });
}

/** The one refusal for "this journal does not do reactions", and for "no such
 * journal". */
function reactionsDisabled() {
  return NextResponse.json(
    {
      error: "reactions_disabled",
      message:
        "This journal does not have reactions switched on. /api/health says which " +
        "capabilities are on.",
    },
    { status: 404 },
  );
}

type Resolved =
  | { refusal: NextResponse; trip?: undefined; ref?: undefined }
  | { refusal?: undefined; trip: Trip; ref: string };

/**
 * The trip this request is about, or the refusal to answer with.
 *
 * Both verbs go through here so that neither can drift from the other — the
 * old code had the same `getTrip` check written out twice, and a fix applied
 * to one of them would have left the other open.
 */
async function resolveReadableTrip(ref: string | null): Promise<Resolved> {
  // The ref is `<username>/<tripId>`, so a reaction can never be recorded
  // against another user's trip by guessing an id.
  const parsed = ref ? parseTripRef(ref) : null;
  // Nothing to gate on and nothing disclosed by saying so: a ref that is not
  // a ref names no journal.
  if (!ref || !parsed) return { refusal: unknownTrip() };

  if (!getUser(parsed.username) || !isEnabled("reactions", parsed.username)) {
    return { refusal: reactionsDisabled() };
  }

  const trip = getTrip(ref);
  if (!trip || !(await mayReadTrip(trip))) return { refusal: unknownTrip() };
  return { trip, ref };
}

/** All counts, plus this reader's own picks when they identify themselves. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const voterId = url.searchParams.get("voter");
  const resolved = await resolveReadableTrip(url.searchParams.get("trip"));
  if (resolved.refusal) return resolved.refusal;

  const [counts, mine] = await Promise.all([
    getAllCounts(resolved.ref),
    voterId ? getVotesFor(voterId, resolved.ref) : Promise.resolve({}),
  ]);
  return NextResponse.json(
    { counts, mine },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const limit = rateLimit(clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  let body: { day?: unknown; emoji?: unknown; voter?: unknown; trip?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const day = typeof body.day === "string" ? body.day : "";
  const voter = typeof body.voter === "string" ? body.voter : "";
  // Voter ids are generated by the browser; cap the length so a hostile client
  // can't grow the store one enormous key at a time.
  if (!day || !voter || voter.length > 64) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // The same gate as the read, and deliberately not a weaker one: writing a
  // row against a day is how the day's slug got published in the first place.
  const resolved = await resolveReadableTrip(
    typeof body.trip === "string" ? body.trip : null,
  );
  if (resolved.refusal) return resolved.refusal;

  try {
    const result = await vote(resolved.ref, day, voter, body.emoji);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "unknown_reaction" }, { status: 400 });
  }
}
