import { isEnabled } from "@/lib/capabilities";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { postcardOrderWrite } from "@/lib/api/v2/schemas";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { createOrder, resolvePostcardInput } from "@/lib/postcard/orders";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The postcard proposal the conversation confirmed — `propose_postcards` in
 * `lib/helper/tools/areas/printed.ts`.
 *
 * **Made through the browser's own cookie instead of a bearer token** — the
 * same split every other route in this family draws
 * (`app/api/helper/[user]/invite/route.ts`). It validates against
 * `postcardOrderWrite`, the same schema `PUT /api/v2/<user>/postcards/orders/<id>`
 * parses, and resolves the source, the recipients and the provider through
 * `resolvePostcardInput` — the same function that route calls (B1650,
 * money/storage/print parcel). What used to be duplicated by hand between the
 * two routes is now one function neither can drift out of sync with; only the
 * request's own shape (flat fields here, a JSON document there) and the
 * response's status codes stay route-specific, since this room has answered
 * with its own codes since before v2 existed and the conversation's `Proposed`
 * handling reads them.
 *
 * **This writes a pending order and nothing more.** Charging a credit and
 * reaching a printer both happen only when the owner presses the button on
 * `/<user>/postcards/<id>` — AGENTS.md's rule for postcards, unchanged by
 * there being a conversational way to get here.
 */

const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/postcard">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  // No `isEnabled("helper", …)` gate — the same reasoning
  // `app/api/helper/[user]/trip/route.ts` gives at length: this calls no
  // model and spends no credit, so gating it on the capability that pays for
  // those would make a plain write route a dead end on an instance running
  // with no model at all.
  if (!isEnabled("postcards", user) || !isEnabled("contacts", user)) {
    refused(user, "propose_postcards", "postcards_disabled");
    return Response.json({ error: "postcards_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-postcard", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const slug = text(body.slug);
  const photo = text(body.photo);
  const message = text(body.message);
  const from = text(body.from);
  const locale = text(body.locale);
  const recipients = [
    ...new Set(
      text(body.recipients)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];

  // B1393 — a day is where a photograph is *found*, not something the
  // printer needs. Neither given means `photo` names a file staged in the
  // inbox instead of a path in a trip's own media; one without the other is
  // a request that names half a day.
  if ((tripId || slug) && !(tripId && slug)) {
    refused(user, "propose_postcards", "unknown_day");
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }
  const source = tripId && slug ? { trip: tripId, day: slug, photo } : { inbox: photo };

  const parsed = postcardOrderWrite.safeParse({
    source,
    message,
    from,
    recipients,
    ...(locale ? { locale } : {}),
  });
  if (!parsed.success) {
    // This room's own request shape, checked before its own errors — the
    // route's historical codes (`no_recipients`, over-length message, too
    // many recipients) all collapse to the schema's `invalid_request` now
    // that the schema enforces the same bounds (message ≤ 600, 1-25
    // recipients) it always did; recipients.length === 0 is worth telling
    // apart, since "you named nobody" reads differently from "that is not
    // a real request".
    refused(user, "propose_postcards", recipients.length === 0 ? "no_recipients" : "invalid_request");
    return Response.json({ error: recipients.length === 0 ? "no_recipients" : "invalid_request" }, { status: 400 });
  }

  const resolved = await resolvePostcardInput(user, parsed.data);
  if (!resolved.ok) {
    refused(user, "propose_postcards", resolved.error);
    const status = resolved.error === "unknown_trip" || resolved.error === "unknown_day" ? 404 : 400;
    return Response.json(
      resolved.error === "unknown_recipient" ? { error: resolved.error, unknown: resolved.unknown } : { error: resolved.error },
      { status },
    );
  }

  const order = await createOrder(user, resolved.input);
  if (!order) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }

  const total = POSTCARD_CREDITS * resolved.input.recipients.length;
  const url = `${serverSite().url}/${user}/postcards/${order.id}`;

  wrote(user, "propose_postcards", {
    id: order.id,
    recipients: resolved.input.recipients.length,
    credits: total,
  });

  return Response.json(
    {
      ok: true,
      id: order.id,
      status: order.status,
      url,
      expiresAt: order.payload.expiresAt,
      recipients: resolved.input.recipients.length,
      credits: { each: POSTCARD_CREDITS, total, balance: creditsEnabled() ? await balanceOf(user) : null },
      // Read by the model on the next turn, and by nobody as a claim of fact:
      // a preview is waiting, and only the owner's own press prints anything.
      next: "Nothing has been printed or charged. Ask the owner to open the URL and press Send.",
    },
    { status: 201 },
  );
}
