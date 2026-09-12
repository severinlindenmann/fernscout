import "server-only";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { readDayReadiness, writeDayReadiness } from "@/lib/dayReadiness";
import { declinesIn } from "@/lib/tracks";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The confirm-side door `assemble_day`'s own proposals point at
 * (`lib/helper/tools/areas/days.ts`) — SDD plan: inbox day-assembly Phase 3.
 *
 * **What this half does:** record an answer to whatever a date folder was
 * asked about. `costs`/`coordinates` are `lib/tracks.ts`'s own vocabulary,
 * read here through the same `declinesIn` `POST .../day` already uses, so
 * the same three answers mean the same thing whichever door somebody
 * answered them through. `weather` is not a `Track` — Phase 3's own Global
 * Constraint keeps it out of that registry — so it is recorded here
 * directly, as `weatherAsked`, on either answer: "look it up" and "no" are
 * both a real answer, and only "nobody has been asked yet" is not.
 *
 * **What this half deliberately does not do:** create the real entry. That
 * is Task 3's own further step (SDD plan: inbox day-assembly Phase 3, Task
 * 3) — `attachDayFolderMedia`, `createDraft`, and removing the day folder
 * once a real entry holds everything it carried. A press that names no
 * answer at all (nothing but `trip`/`date`, which is what `propose()` sends
 * once nothing is missing) is the "create it" press, and until Task 3 lands
 * the honest response is a plain refusal that says so — never a silent
 * no-op dressed up as success, and never this route reaching for
 * `createDraft` itself before the day folder's own attach step exists to go
 * with it.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/assemble-day">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const ref = tripRef(user, text(body.trip));
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "assemble_day", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const date = text(body.date);
  if (date === "") {
    refused(user, "assemble_day", "unknown_day");
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  const answered = declinesIn(body);
  const weatherAnswered = body.weather === "none" || body.weather === "unknown";

  if (Object.keys(answered).length === 0 && !weatherAnswered) {
    refused(user, "assemble_day", "not_yet_available");
    return Response.json({ error: "not_yet_available" }, { status: 501 });
  }

  const current = readDayReadiness(user, date);
  const without = [...current.without];
  const unrecorded = [...current.unrecorded];
  for (const [track, value] of Object.entries(answered)) {
    if (value === false && !without.includes(track as (typeof without)[number])) {
      without.push(track as (typeof without)[number]);
    }
    if (value === "unknown" && !unrecorded.includes(track as (typeof unrecorded)[number])) {
      unrecorded.push(track as (typeof unrecorded)[number]);
    }
  }
  writeDayReadiness(user, date, {
    without,
    unrecorded,
    weatherAsked: weatherAnswered || current.weatherAsked,
  });

  wrote(user, "assemble_day", { trip: text(body.trip), date });
  return Response.json({ ok: true, recorded: true }, { status: 200 });
}
