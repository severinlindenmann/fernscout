import { refused, wrote } from "@/lib/helper/thread";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripDetails } from "@/lib/api/tripDetails";
import { getTrip, tripRef } from "@/lib/trips";
import { createTrip, DATE_RE, VISIBILITIES } from "@/lib/tripWrite";

export const dynamic = "force-dynamic";

/**
 * The trip the person confirmed — B685.
 *
 * The router can propose a trip; only this can make one, and it is reached
 * either by somebody pressing a button with the title and the two dates the
 * model routed in front of them, or — since B754 — by the wizard's own "new
 * trip" form, which never spoke to a model at all. **No model is spoken to
 * here either way**: the fields arrive from a form, which is the whole
 * discipline — `createTrip` is the same function `POST /api/v1/<user>/trips`
 * calls, so a trip made this way is a trip made any other way.
 *
 * That is also why this carries no `isEnabled("helper", …)` gate the way the
 * rest of `app/api/helper/` does — B754. Every sibling route here either asks
 * a model or exists only to serve one that is running; this one does neither,
 * so gating it on the capability made the wizard's plain trip picker a
 * dead end on an instance running with no model at all, which is the default.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length: the browser has a cookie and the contract's routes take a bearer
 * token, and putting a seven-day write token into a page is the thing B283
 * exists to avoid.
 *
 * The id is derived rather than asked for. It becomes part of a URL and a
 * folder name, and it is the one field of the four that somebody filling in a
 * box on a phone has no way to have an opinion about.
 */

const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A title and a year into something that ages well as a URL. */
function idFrom(username: string, title: string, start: string): string {
  const base =
    `${title}-${start.slice(0, 4)}`
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `trip-${start.slice(0, 4)}`;
  let id = base;
  for (let n = 2; getTrip(tripRef(username, id)); n += 1) id = `${base}-${n}`;
  return id;
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limited = rateLimitFor("helper-trip", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const title = text(body.title);
  const start = text(body.start);
  const end = text(body.end);
  if (!title || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    refused(user, "create_trip", "invalid_trip");
    return Response.json({ error: "invalid_trip" }, { status: 400 });
  }

  /**
   * Who may read it, asked rather than defaulted — B900.
   *
   * The conversation puts the three in front of somebody as sentences, because
   * the mistake people make at exactly this moment is answering "who can see
   * it" with the wrong one of *guest* and *private*. An unrecognised word is
   * dropped rather than guessed at: `createTrip` then falls back to the
   * journal's own default, which is what a trip made without this field has
   * always got.
   */
  const said = text(body.visibility);
  const visibility = (VISIBILITIES as readonly string[]).includes(said)
    ? (said as (typeof VISIBILITIES)[number])
    : undefined;

  const created = createTrip(user, {
    id: idFrom(user, title, start),
    title,
    start,
    end,
    ...(visibility ? { visibility } : {}),
  });
  if (!created.ok) {
    refused(user, "create_trip", created.error);
    return Response.json({ error: created.error, message: created.message }, { status: 400 });
  }
  // The id the *server* derived, not the title the model sent — B939. This is
  // the one fact about a new trip nobody in the conversation could otherwise
  // know.
  wrote(user, "create_trip", { id: created.id, title, start, end });
  return Response.json(
    { ok: true, id: created.id, href: `/${encodeURIComponent(user)}/trips/${created.id}` },
    { status: 201 },
  );
}

const PATCH_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * The correction — `edit_trip`, once the trip already exists.
 *
 * Unlike the POST above, this **does** carry `isEnabled("helper", …)`: there
 * is no plain-form fallback for editing a trip the way there is for making
 * one, so a hosted instance with the model switched off has no other door
 * that reaches this and no reason to leave one open.
 *
 * `patchTripDetails` is the same function `PATCH /api/v1/<user>/trips/<trip>`
 * calls, so a trip edited from the conversation is a trip edited any other
 * way. Only `title`, `start` and `end` are offered here — `cover`, `accent`,
 * `intro` and `costsVisibility` are real fields on that route but nobody has
 * ever asked this conversation to change one, and a field on the card that is
 * never the answer is a field somebody reads past every time.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-edit", clientIp(request), PATCH_LIMIT);
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
    refused(user, "edit_trip", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const result = patchTripDetails(ref, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.start !== undefined ? { start: body.start } : {}),
    ...(body.end !== undefined ? { end: body.end } : {}),
  });
  if (!result.ok) {
    refused(user, "edit_trip", result.error);
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "edit_trip", { trip: ref, title: result.title, start: result.start, end: result.end });
  return Response.json({ ok: true, trip: ref, title: result.title, start: result.start, end: result.end });
}
