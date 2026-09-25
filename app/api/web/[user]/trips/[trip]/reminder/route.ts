// GET/PATCH /api/web/{user}/trips/{trip}/reminder — a trip's evening
// reminder, on or off, from a cookie — B2171.
//
// The switch in Journal settings (`/[user]/studio/journal`) writes through
// here now the chat room it used to live in (`set_reminder`, whose own door
// is `/api/helper/{user}/trip/reminder`) is retired. Same writer as that
// door — `patchTripReminder`, which reads its own write back so the two
// cannot disagree.
//
// The family of `../visibility/route.ts`: `isOwner` on the cookie only, any
// `Authorization` header refused outright, no token minted. Owner only, not
// a trip-scoped token: a nudge about the trip going quiet is the owner's own
// question.
//
// Body: `{"enabled": true|false, "channel"?: "mail"}` — WhatsApp retired as
// a reminder channel, B2339. GET reads back `{enabled, channel}` — the same
// shape PATCH answers with.
import { patchTripReminder, readTripReminder } from "@/lib/api/tripReminder";
import { isOwner } from "@/lib/contacts/session";
import { tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser. An agent sets a trip's reminder with PATCH /api/v2/{user}/trips/{trip}.",
};

async function gate(request: Request, user: string): Promise<Response | null> {
  if (request.headers.get("authorization")) return Response.json(NOT_FOR_AGENTS, { status: 403 });
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/reminder">) {
  const { user, trip } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;
  const reminder = readTripReminder(tripRef(user, trip));
  if (!reminder) return Response.json({ error: "unknown_trip" }, { status: 404 });
  return Response.json({ ok: true, ...reminder });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/trips/[trip]/reminder">) {
  const { user, trip } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;
  const body = await request.json().catch(() => null);
  const result = await patchTripReminder(tripRef(user, trip), body);
  if (!result.ok) {
    const status = result.bug
      ? 500
      : result.error === "unknown_trip"
        ? 404
        : result.error === "channel_unavailable"
          ? 409
          : 400;
    return Response.json({ error: result.error, ...(result.message ? { message: result.message } : {}) }, { status });
  }
  return Response.json({ ok: true, enabled: result.enabled, channel: result.channel });
}
