import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { findDayForDate } from "@/lib/studio/day";
import { createDayTransactional, type CreateDayInput } from "@/lib/studio/createDay";
import { wrote, refused } from "@/lib/helper/thread";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * "Add a day" (B1830) — the studio's own door onto a brand new day, from the
 * owner's browser cookie. `POST /api/helper/[user]/day` (the older wizard's
 * own create door) already exists and is intentionally left alone: this is
 * a *different* flow with a different declinable vocabulary (D1 — see
 * `lib/studio/createDay.ts`'s doc comment), not a second implementation of
 * the same one. Cookie-owner only, bearer refused, the same shape every
 * route in this family already uses.
 */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/day/new">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) {
    refused(user, "add_day", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const date = text(body.date) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  // D3 — a second day on an occupied date is let through only once the
  // person has confirmed it (`confirmSecondEntry`, set by A2✗'s own second
  // press) *and* named a time, which is what tells the two apart from here
  // on. Anything else is the honest refusal the collision screen renders.
  const collision = findDayForDate(user, tripId, date);
  if (collision && !(body.confirmSecondEntry === true && text(body.time))) {
    refused(user, "add_day", "date_has_day");
    return Response.json({ error: "date_has_day", existing: collision }, { status: 409 });
  }

  const declinedRaw = body.declined;
  const declined: CreateDayInput["declined"] =
    declinedRaw && typeof declinedRaw === "object" && !Array.isArray(declinedRaw)
      ? Object.fromEntries(
          Object.entries(declinedRaw as Record<string, unknown>).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string",
          ),
        )
      : {};

  const mediaInboxIds = Array.isArray(body.mediaInboxIds)
    ? body.mediaInboxIds.filter((id): id is string => typeof id === "string")
    : [];

  // B2233 — values only: this door never declines them (blank stays blank),
  // and `createDraft`'s own validator refuses a bad amount, currency or mode.
  for (const [field, ok] of [
    ["costs", Array.isArray(body.costs)],
    ["transportMode", typeof body.transportMode === "string"],
    ["tags", Array.isArray(body.tags)],
  ] as const) {
    if (body[field] !== undefined && !ok) return Response.json({ error: `invalid_${field}` }, { status: 400 });
  }

  const result = await createDayTransactional(user, {
    tripId,
    date,
    time: text(body.time),
    title: text(body.title),
    content: typeof body.content === "string" ? body.content : undefined,
    location: text(body.location),
    country: text(body.country),
    lat: number(body.lat),
    lng: number(body.lng),
    weather: body.weather === true,
    costs: body.costs as CreateDayInput["costs"],
    transportMode: body.transportMode as string | undefined,
    tags: body.tags as string[] | undefined,
    mediaInboxIds,
    declined,
    test: body.test === true,
  });

  if (!result.ok) {
    refused(user, "add_day", result.error);
    const status = result.error === "unknown_trip" ? 404 : 400;
    return Response.json({ error: result.error, detail: result.detail }, { status });
  }

  wrote(user, "add_day", { trip: tripId, slug: result.slug, date });
  return Response.json({ ok: true, trip: tripId, slug: result.slug }, { status: 201 });
}
