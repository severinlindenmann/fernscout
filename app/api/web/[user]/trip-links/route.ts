import { readJsonBody } from "@/lib/api/jsonBody";
import { createInvite, inviteExpiry } from "@/lib/contacts/invites";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";
import { readLinkUrl } from "@/lib/tripLink";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `POST /api/web/<user>/trip-links` `{ trip, days?, neverExpires?, name? }` —
 * "Read one trip now" (B-2963, epic B2960). Owner's cookie only. Anyone with
 * the link reads the trip, so only a trip shared with guests can be named:
 * the check is here, not in the form.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/trip-links">) {
  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.value ?? {}) as Record<string, unknown>;
  const trip = typeof body.trip === "string" ? getTrip(tripRef(user, body.trip)) : null;
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404, headers: PRIVATE });
  if (trip.visibility !== "guest") {
    return Response.json(
      { error: "trip_not_shared", message: "Only a trip shared with guests can be opened by a link." },
      { status: 409, headers: PRIVATE },
    );
  }
  const neverExpires = body.neverExpires === true;
  const days = typeof body.days === "number" && Number.isFinite(body.days) ? body.days : 30;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : undefined;
  const made = await createInvite(user, {
    kind: "read",
    tripId: trip.id,
    neverExpires,
    expiresAt: neverExpires ? null : inviteExpiry(days),
    name,
  });
  return Response.json(
    { id: made.id, url: made.readCode ? readLinkUrl(made.readCode) : null, expiresAt: made.expiresAt },
    { status: 201, headers: PRIVATE },
  );
}
