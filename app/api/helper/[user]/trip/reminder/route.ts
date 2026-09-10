import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripReminder } from "@/lib/api/tripReminder";
import { getTrip, tripRef } from "@/lib/trips";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * `set_reminder`'s own door — B1219, D46.
 *
 * The same family as `../visibility/route.ts`: cookie only, owner only,
 * outside `/api/v1` and outside the published contract, for the reason
 * `../../day/route.ts` sets out at length. A trip-scoped agent token cannot
 * reach this — an evening nudge about the trip going quiet is the owner's own
 * question to answer, not something whoever is holding the pen that week
 * gets to switch on for everybody else on it.
 */

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/reminder">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-reminder", clientIp(request), LIMIT);
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
    refused(user, "set_reminder", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  // `enabled` arrives as `"on"`/`"off"` — a `ProposalField` carries a string,
  // never a boolean (the same reason `../../channels/route.ts` parses it
  // rather than trusting model-produced JSON).
  const enabled = body.enabled === "on" ? true : body.enabled === "off" ? false : undefined;
  if (enabled === undefined) {
    refused(user, "set_reminder", "bad_request");
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const result = patchTripReminder(ref, { enabled, channel: body.channel });
  if (!result.ok) {
    refused(user, "set_reminder", result.error);
    const status = result.bug
      ? 500
      : result.error === "unknown_trip"
        ? 404
        : result.error === "channel_unavailable"
          ? 409
          : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "set_reminder", { trip: ref, enabled: result.enabled, channel: result.channel });
  return Response.json({ ok: true, trip: ref, enabled: result.enabled, channel: result.channel });
}
