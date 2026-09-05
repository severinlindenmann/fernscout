import { isTestContent } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { isOwner } from "@/lib/contacts/session";
import { getEntryBySlug } from "@/lib/entries";
import { resolveMediaFile } from "@/lib/media";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { createOrder } from "@/lib/postcard/orders";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/postcards` — propose a set of postcards — B434.
 *
 * The call an agent makes and the *only* one it makes: this writes a draft
 * order and answers with a URL. It charges nothing, prints nothing and tells
 * nobody. Everything that costs money happens when a person opens that URL and
 * presses the button on it.
 *
 * **There is deliberately no send endpoint anywhere under `/api/`.** Not one
 * that checks for an owner — none at all. `POST .../days` and `.../publish`
 * are two calls so there is a moment in between; this is the same idea with
 * the second call taken away entirely, because the second call here spends
 * money at a printer and posts somebody's photograph to somebody's house. An
 * agent that reports these cards as sent has said something false: say a
 * preview is waiting, give the link, and stop.
 *
 * ## What it will not accept
 *
 * **Recipients are contact ids, not addresses.** The list an agent may choose
 * from is `GET .../postcards/recipients`, which answers with names and towns
 * and never streets. An id that is not on that list is refused by name, so a
 * contact who never asked for a postcard cannot be added by guessing. This is
 * the rule that makes an agent unable to post a card to an address it invented.
 *
 * **A photograph that is already in the trip.** Resolved through
 * `resolveMediaFile`, which refuses anything escaping the trip's media
 * directory — the payload is written from a request, so that guard is load
 * bearing rather than decorative.
 *
 * **Nothing marked `test: true`.** Test content is a day nobody lived, and
 * `dry-run` will not always be the provider.
 */

/** Enough to write to everybody who could plausibly be on a list, and few
 * enough that a mistake is a mistake rather than a catastrophe: at
 * `POSTCARD_CREDITS` each, this caps one order at 375 credits. */
const MAX_RECIPIENTS = 25;

/** A postcard, not a letter. `renderPostcard` reports truncation rather than
 * cutting silently, but a card that fills every millimetre reads like a form
 * letter, and refusing here is a better answer than printing one. */
const MAX_MESSAGE = 600;

type Body = {
  trip?: unknown;
  day?: unknown;
  photo?: unknown;
  message?: unknown;
  from?: unknown;
  recipients?: unknown;
  locale?: unknown;
};

function bad(message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: "invalid_request", message, ...extra }, { status: 400 });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/postcards">) {
  const { user } = await params;

  if (!getUser(user) || !isEnabled("postcards", user)) {
    return Response.json(
      {
        error: "postcards_disabled",
        message:
          "This journal does not have postcards switched on, so there is nothing to order. " +
          "/api/health says which capabilities are on and why.",
      },
      { status: 404 },
    );
  }
  if (!isEnabled("contacts", user)) {
    return Response.json(
      {
        error: "contacts_disabled",
        message:
          "Postcards are addressed to contacts, and this journal has no contacts table. " +
          "There is nobody to post to.",
      },
      { status: 404 },
    );
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may order postcards — not a token scoped " +
          "to one of its trips. Being on the bus is not the same as spending the journal's " +
          "credits at a printer.",
      },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("The body must be JSON.");
  }

  const tripId = str(body.trip);
  const day = str(body.day);
  const photo = str(body.photo);
  const message = str(body.message);
  const from = str(body.from);
  const wanted = Array.isArray(body.recipients) ? body.recipients.map(str).filter(Boolean) : [];

  if (!tripId || !day || !photo || !message || !from) {
    return bad(
      "trip, day, photo, message and from are all required. The message and the signature " +
        "are what a person will read on the card; write them in the author's own words, " +
        "from what they actually told you.",
    );
  }
  if (message.length > MAX_MESSAGE) {
    return bad(`The message is ${message.length} characters; a postcard holds ${MAX_MESSAGE}.`);
  }

  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, day, { includeDrafts: true });
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (isTestContent(trip, entry)) {
    return bad(`"${day}" is marked test: true — content nobody lived — so it orders no cards.`);
  }

  if (!resolveMediaFile(user, [tripId, ...photo.split("/").filter(Boolean)])) {
    return bad(
      `"${photo}" is not a file in this trip's media. Give a path relative to the trip's ` +
        "media directory, as it appears on the day.",
    );
  }

  if (wanted.length === 0) {
    return bad("Name at least one recipient, by contact id, from GET …/postcards/recipients.");
  }
  if (wanted.length > MAX_RECIPIENTS) {
    return bad(`${wanted.length} recipients; one order carries at most ${MAX_RECIPIENTS}.`);
  }

  const candidates = await postcardCandidates(user);
  const allowed = new Set(candidates.map((c) => c.contactId));
  const unknown = wanted.filter((id) => !allowed.has(id));
  if (unknown.length > 0) {
    return bad(
      "Some of those recipients cannot be posted to: they are not approved contacts of this " +
        "journal who asked for a real postcard and left an address. There is no way to " +
        "address a card to anybody else — that is deliberate.",
      { unknown },
    );
  }
  // The same person twice is one card. An agent building a list from a
  // conversation gets this wrong more often than a person would, and the cost
  // of the mistake is a duplicate card and a duplicate charge.
  const recipients = [...new Set(wanted)];

  // What language the card is written in — B452. Taken on the caller's word
  // when given, because they are the one writing the words; the journal's own
  // default otherwise. Nothing inspects the message and decides: a wrong
  // language asserted confidently is worse than the sensible default.
  const locale = str(body.locale) || getUser(user)?.defaultLocale || "en";

  const provider = "dry-run";
  const order = await createOrder(user, {
    trip: ref,
    day,
    photo,
    message,
    from,
    recipients,
    locale,
    provider,
  });
  if (!order) {
    return Response.json(
      {
        error: "no_database",
        message: "This instance has no database configured, so an order has nowhere to live.",
      },
      { status: 503 },
    );
  }

  const total = POSTCARD_CREDITS * recipients.length;
  return Response.json(
    {
      id: order.id,
      status: order.status,
      // Where a person goes to look at it and press Send. Hand this over; do
      // not describe the cards as sent, because nothing has been.
      url: `${serverSite().url}/${user}/postcards/${order.id}`,
      expiresAt: order.payload.expiresAt,
      recipients: recipients.length,
      locale,
      credits: {
        each: POSTCARD_CREDITS,
        total,
        balance: creditsEnabled() ? await balanceOf(user) : null,
      },
      next: "Nothing has been printed or charged. Ask the owner to open the URL and press Send.",
    },
    { status: 201 },
  );
}
