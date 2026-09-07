import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { helperConsent } from "@/lib/helper/consent";
import { HELPER_PROVIDER, WRITE_DAY_CREDITS, writeDay, type DayFacts } from "@/lib/helper/model";
import { isHelperOwner } from "@/lib/helper/server";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Notes in, a draft to read back — B684.
 *
 * **Nothing here writes anything to disk.** It returns the model's answer and
 * stops; the person reads it, and either keeps it (which is the existing
 * `PATCH` on the day, the same call their own typing goes through) or throws
 * it away and keeps their own words. That is the plan's rule that returned
 * prose is always shown for review, and it is what makes the invention rule in
 * `lib/helper/model.ts` enforceable rather than merely stated.
 *
 * Cookie only and bearer refused, like every route in this family — see
 * `isHelperOwner`. The capability being off is a 404 rather than a 500: the
 * button is not on the page at all in that case, so anything arriving here is
 * somebody who went looking.
 *
 * The order of the four gates below is deliberate. Rate limit, then consent,
 * then the credit, then the model: each one is cheaper than the next, and the
 * expensive one is the only one that can fail after money has moved — which is
 * what the refund is for.
 */

/** Fifteen minutes, and comfortably more write-ups than a person on a bus
 *  makes. It is a brake on a script, not a quota; the credit is the quota. */
const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/write-day">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-write", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const notes = text(body.notes);
  if (notes === "") return Response.json({ error: "no_notes" }, { status: 400 });

  // Before the first model call ever made for this journal, and before the
  // spend — a charge for a call that consent would have refused is a charge
  // for nothing.
  if (!helperConsent(user)) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const facts: DayFacts = {
    date: text(body.date),
    trip: trip.title,
    ...(text(body.location) ? { location: text(body.location) } : {}),
    ...(text(body.country) ? { country: text(body.country) } : {}),
    ...(text(body.from) ? { from: text(body.from) } : {}),
    ...(text(body.to) ? { to: text(body.to) } : {}),
    ...(typeof body.photos === "number" ? { photos: body.photos } : {}),
  };

  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.write-day", supplied);
  const fingerprint = fingerprintOf({ notes, facts });
  const recalled = recall<Record<string, unknown>>(key, fingerprint);
  // A retry gets the first answer back and is not charged again. A *different*
  // call under the same key is refused rather than answered with somebody
  // else's day — `lib/idempotency.ts` explains what that cost the first time.
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const ledgerRef = `${user}/${tripId}/${facts.date}`;
  if (!(await spend(user, WRITE_DAY_CREDITS, "helper", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  let written;
  try {
    written = await writeDay(notes, facts);
  } catch {
    // The credit bought nothing, so it is given back. Nothing about the
    // failure is passed on: what a provider says when it is unhappy is not
    // something to render on somebody's phone.
    await refund(user, WRITE_DAY_CREDITS, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }

  const answer = {
    ok: true,
    draft: written,
    spent: WRITE_DAY_CREDITS,
    provider: HELPER_PROVIDER,
  };
  remember(key, fingerprint, answer);
  return Response.json(answer);
}
