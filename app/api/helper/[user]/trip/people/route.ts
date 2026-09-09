import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripParty, readTripParty } from "@/lib/api/tripParty";
import { getTrip, tripRef } from "@/lib/trips";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * `trip_people`'s own door — adding one person to the byline from the
 * conversation, after the trip already exists.
 *
 * `patchTripParty` writes the block **wholesale, not merged** — a party's
 * membership and its order both mean something, so a caller must send the
 * whole list (`lib/api/tripParty.ts`). This tool only ever names one person,
 * so the merge happens here: the trip's own list, read back, with this person
 * folded in by email — replacing an existing entry with the same address
 * rather than duplicating it, and otherwise left exactly as it was.
 *
 * Cookie only, owner only, outside `/api/v1` — the same door as every other
 * route in this family; see `../route.ts` for the whole of that reasoning.
 */

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/people">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-people", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const ref = tripRef(user, text(body.trip));
  if (!getTrip(ref)) {
    refused(user, "trip_people", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const name = text(body.person);
  const email = text(body.email).toLowerCase();
  if (!name || !email) {
    refused(user, "trip_people", "invalid_people");
    return Response.json(
      {
        error: "invalid_people",
        message: "Both a name and an email are needed before somebody can be added to a trip.",
      },
      { status: 400 },
    );
  }

  const existing = readTripParty(ref)?.people ?? [];
  const merged = [...existing.filter((one) => one.email.toLowerCase() !== email), { name, email }];

  const result = patchTripParty(ref, "people", merged);
  if (!result.ok) {
    refused(user, "trip_people", result.error);
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "trip_people", { trip: ref, added: email });
  return Response.json({
    ok: true,
    trip: ref,
    people: result.people,
    note:
      `${email} may now write to every day of this trip and may ask for a token scoped to ` +
      "it, using that address.",
  });
}
