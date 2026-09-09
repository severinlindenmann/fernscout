import { refused, wrote } from "@/lib/helper/thread";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { patchTripRates } from "@/lib/api/tripRates";
import { normalizeCurrency } from "@/lib/currency";

export const dynamic = "force-dynamic";

/**
 * The open half of B960, from the wizard — B1042's `set_rate`.
 *
 * A trip made through the conversation has no `rates:` block, so a cost
 * logged in anything but the journal's own currency sits outside every
 * total. This is the same writer `PATCH /api/v1/<user>/trips/<trip>/rates`
 * calls — `patchTripRates` merges one currency in without disturbing any
 * already on the trip — reached the way the rest of `app/api/helper/`
 * reaches its writes: cookie only, owner only, outside `/api/v1` and outside
 * the published contract, for the reason `../day/costs/route.ts` gives at
 * length.
 *
 * The number is never this route's to invent: it takes exactly the figure
 * the tool proposed, which is exactly the figure the person read on the card.
 */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/rates">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const currency = normalizeCurrency(body.currency);
  const rate = typeof body.rate === "number" ? body.rate : Number(body.rate);
  if (!currency || !Number.isFinite(rate) || rate <= 0) {
    refused(user, "set_rate", "invalid_rate");
    return Response.json({ error: "invalid_rate" }, { status: 400 });
  }

  const result = patchTripRates(ref, { [currency]: rate });
  if (!result.ok) {
    refused(user, "set_rate", result.error);
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status: result.bug ? 500 : 400 },
    );
  }

  wrote(user, "set_rate", { trip: tripId, currency, rate });
  return Response.json({ ok: true, trip: tripId, currency, rate, rates: result.rates });
}
