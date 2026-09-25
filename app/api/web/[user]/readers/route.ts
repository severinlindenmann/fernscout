import { readJsonBody } from "@/lib/api/jsonBody";
import { addPersonByOwner } from "@/lib/contacts";
import { parseLocale, pickLocale } from "@/lib/contacts/locale";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

const LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

/**
 * `POST /api/web/<user>/readers` — "Add a person", step 1 (B2291, B2292).
 *
 * `{ name, role: "reader" | "buddy", tripId?, email?, phone?, locale? }` —
 * at least one of email and phone. The person is pre-approved
 * (`addPersonByOwner`); nothing is sent. Step 2 is `…/readers/notify`.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/readers">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;

  const limited = rateLimitFor("readers-add", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name = text(body.name);
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });
  const role = body.role === "buddy" ? "buddy" : body.role === "reader" || body.role === undefined ? "reader" : null;
  if (!role) return Response.json({ error: "invalid_role" }, { status: 400 });

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "no_such_journal" }, { status: 404 });

  let buddyTripId: string | null = null;
  if (role === "buddy") {
    const trip = getTrip(tripRef(user, text(body.tripId)));
    if (!trip) return Response.json({ error: "unknown_trip" }, { status: 400 });
    buddyTripId = trip.id;
  }

  const result = await addPersonByOwner(user, {
    name,
    email: text(body.email) || null,
    phone: text(body.phone) || null,
    locale: parseLocale(text(body.locale)) ?? pickLocale(null, journal.defaultLocale),
    buddyTripId,
  });
  if (!result.ok) {
    const status = result.error === "blocked_contact" || result.error === "conflict" ? 409 : 400;
    return Response.json({ error: result.error }, { status, headers: PRIVATE });
  }
  return Response.json(
    {
      ok: true,
      outcome: result.outcome,
      contact: { id: result.contact.id, name: result.contact.name, status: result.contact.status },
    },
    { headers: PRIVATE },
  );
}
