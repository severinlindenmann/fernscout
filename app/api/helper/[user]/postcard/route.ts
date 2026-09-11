import { isTestContent } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { loadServerConfig } from "@/lib/config";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { findInboxFile } from "@/lib/inbox";
import { resolveMediaFile } from "@/lib/media";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { createOrder } from "@/lib/postcard/orders";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The postcard proposal the conversation confirmed — `propose_postcards` in
 * `lib/helper/tools/areas/printed.ts`.
 *
 * **The same call as `POST /api/v1/<user>/postcards`, made through the
 * browser's own cookie instead of a bearer token** — the same split every
 * other route in this family draws (`app/api/helper/[user]/invite/route.ts`).
 * It validates the same four things that route does — a real trip, a real
 * day, a photograph in the trip's own media, and recipients who are on the
 * approved list `GET .../postcards/recipients` (here, `postcardCandidates`)
 * answers with — and writes through the same `createOrder`. Duplicating the
 * checks rather than importing the route is deliberate: a route file is not a
 * library, and `app/api/helper/[user]/trip/route.ts` makes the identical
 * choice against `POST /api/v1/<user>/trips`.
 *
 * **This writes a pending order and nothing more.** Charging a credit and
 * reaching a printer both happen only when the owner presses the button on
 * `/<user>/postcards/<id>` — AGENTS.md's rule for postcards, unchanged by
 * there being a conversational way to get here.
 */

const MAX_RECIPIENTS = 25;
const MAX_MESSAGE = 600;

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
  const wanted = [
    ...new Set(
      text(body.recipients)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];

  // B1393 — a day is where a photograph is *found*, not something the
  // printer needs. Neither given means `photo` names a file staged in the
  // inbox instead of a path in a trip's own media.
  let ref: string | null = null;
  if (tripId || slug) {
    if (!tripId || !slug) {
      refused(user, "propose_postcards", "unknown_day");
      return Response.json({ error: "unknown_day" }, { status: 404 });
    }
    ref = tripRef(user, tripId);
    const trip = getTrip(ref);
    if (!trip) {
      refused(user, "propose_postcards", "unknown_trip");
      return Response.json({ error: "unknown_trip" }, { status: 404 });
    }
    const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
    if (!entry) {
      refused(user, "propose_postcards", "unknown_day");
      return Response.json({ error: "unknown_day" }, { status: 404 });
    }
    if (isTestContent(trip, entry)) {
      refused(user, "propose_postcards", "test_content");
      return Response.json({ error: "test_content" }, { status: 400 });
    }
    if (!photo || !resolveMediaFile(user, [tripId, ...photo.split("/").filter(Boolean)])) {
      refused(user, "propose_postcards", "unknown_photo");
      return Response.json({ error: "unknown_photo" }, { status: 400 });
    }
  } else {
    const staged = photo ? findInboxFile(user, photo) : null;
    if (!staged || staged.entry.kind !== "media") {
      refused(user, "propose_postcards", "unknown_photo");
      return Response.json({ error: "unknown_photo" }, { status: 400 });
    }
  }
  if (!message || !from) {
    refused(user, "propose_postcards", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    refused(user, "propose_postcards", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (wanted.length === 0) {
    refused(user, "propose_postcards", "no_recipients");
    return Response.json({ error: "no_recipients" }, { status: 400 });
  }
  if (wanted.length > MAX_RECIPIENTS) {
    refused(user, "propose_postcards", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const candidates = await postcardCandidates(user);
  const allowed = new Set(candidates.map((c) => c.contactId));
  const unknown = wanted.filter((id) => !allowed.has(id));
  if (unknown.length > 0) {
    refused(user, "propose_postcards", "unknown_recipient");
    return Response.json({ error: "unknown_recipient", unknown }, { status: 400 });
  }

  const locale = text(body.locale) || getUser(user)?.defaultLocale || "en";
  const configured = loadServerConfig().features.postcards.provider;
  const provider = typeof configured === "string" ? configured : "dry-run";

  const order = await createOrder(user, {
    trip: ref,
    day: ref ? slug : null,
    photo,
    message,
    from,
    recipients: wanted,
    locale,
    provider,
  });
  if (!order) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }

  const total = POSTCARD_CREDITS * wanted.length;
  const url = `${serverSite().url}/${user}/postcards/${order.id}`;

  wrote(user, "propose_postcards", {
    id: order.id,
    recipients: wanted.length,
    credits: total,
  });

  return Response.json(
    {
      ok: true,
      id: order.id,
      status: order.status,
      url,
      expiresAt: order.payload.expiresAt,
      recipients: wanted.length,
      credits: { each: POSTCARD_CREDITS, total, balance: creditsEnabled() ? await balanceOf(user) : null },
      // Read by the model on the next turn, and by nobody as a claim of fact:
      // a preview is waiting, and only the owner's own press prints anything.
      next: "Nothing has been printed or charged. Ask the owner to open the URL and press Send.",
    },
    { status: 201 },
  );
}
