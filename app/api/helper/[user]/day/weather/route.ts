import { editEntry } from "@/lib/api/entries";
import { fillDayWeather } from "@/lib/api/weather";
import { isEnabled } from "@/lib/capabilities";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Wetter nachschlagen lassen" — B1218 (D48), and the one route this chip is
 * allowed to reach: the documented server lookup (AGENTS.md, B325), never a
 * guess. It asks for the reading (`weather: true`) and then makes the same
 * call `POST .../day` and `PATCH .../day` already make after a write —
 * `fillDayWeather`, credited to the archive on the page — and awaits it, so
 * the person reads the outcome rather than a write that happened somewhere
 * off-screen.
 *
 * Owner only, and the whole route is absent where the capability is off:
 * `AGENTS.md`'s rule that an optional capability must be absent rather than
 * broken.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/weather">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user) || !isEnabled("weather", user)) {
    return Response.json({ error: "weather_unavailable" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tripId = text(body?.trip);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "look_up_weather", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const slug = text(body?.slug);

  const asked = editEntry(ref, slug, { weather: true });
  if (!asked.ok) {
    refused(user, "look_up_weather", asked.error);
    return Response.json({ error: asked.error }, { status: asked.bug ? 500 : 400 });
  }

  const outcome = await fillDayWeather(ref, slug);
  if (outcome !== "filled" && outcome !== "already_recorded") {
    refused(user, "look_up_weather", outcome);
    return Response.json(
      { error: outcome },
      { status: outcome === "no_coordinates" ? 400 : 502 },
    );
  }

  wrote(user, "look_up_weather", { trip: tripId, slug, outcome });
  return Response.json({
    ok: true,
    outcome,
    draft: dayForWizard(user, tripId, slug),
    preview: previewOf(user, tripId, slug),
  });
}
