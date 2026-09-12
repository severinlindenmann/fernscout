import "server-only";
import fs from "node:fs";
import { createDraft, type DraftInput } from "@/lib/api/entries";
import { attachDayFolderMedia } from "@/lib/dayFolderAttach";
import { dayInboxDir } from "@/lib/inbox";
import { missingForDayFolder } from "@/lib/dayMissing";
import { readDayReadiness, readWords, writeDayReadiness, type DayReadiness } from "@/lib/dayReadiness";
import { NO_PROSE } from "@/lib/helper/draft";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { declinesIn, UNKNOWN, type Track } from "@/lib/tracks";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The day folder's own answer to one of the trip's three rows, in the shape
 *  `DraftInput` speaks (`false`/`"unknown"`/absent) — `without`/`unrecorded`
 *  are `Track[]`, `DraftInput`'s own `costs`/`coordinates`/`photos` fields
 *  are each answered separately, and this is the one place that translates
 *  between the two. */
function trackAnswer(readiness: DayReadiness, track: Track): false | typeof UNKNOWN | undefined {
  if (readiness.without.includes(track)) return false;
  if (readiness.unrecorded.includes(track)) return UNKNOWN;
  return undefined;
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
 * **What this half does, since Task 3:** the press that names no answer at
 * all — nothing but `trip`/`date`, which is what `propose()` sends once
 * nothing is missing — is the "create it" press. `missingForDayFolder` is
 * asked again here, at the door, exactly as `POST .../day`'s own
 * `missingFrom` check is asked again before its own write: nothing upstream
 * can be trusted to have re-checked between the proposal and this press. Once
 * that holds, the day folder's words and answers become a real entry
 * (`createDraft`), its staged photographs move onto it
 * (`attachDayFolderMedia`), and the folder itself is removed — its job was
 * staging, and a real entry now holds everything it carried.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/assemble-day">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const ref = tripRef(user, tripId);
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

  if (Object.keys(answered).length > 0 || weatherAnswered) {
    return recordAnswer(user, tripId, date, answered, weatherAnswered);
  }

  // Nothing named but `trip`/`date` — the "create it" press. Re-check the
  // door before writing anything: `propose()` may be stale by the time this
  // press lands, the same "ask again at the door" pattern `POST .../day`'s
  // own `missingFrom` check already uses.
  const missing = missingForDayFolder(user, date, trip.tracks);
  if (missing.length > 0) {
    refused(user, "assemble_day", "incomplete_day");
    return Response.json(
      { error: "incomplete_day", missing: missing.map((m) => m.field) },
      { status: 422 },
    );
  }

  const readiness = readDayReadiness(user, date);
  const words = readWords(user, date);

  const input: DraftInput = {
    title: date,
    date,
    content: words || NO_PROSE,
    ...(readiness.location ? { lat: readiness.location.lat, lng: readiness.location.lon } : {}),
    costs: trackAnswer(readiness, "costs"),
    coordinates: trackAnswer(readiness, "coordinates"),
    photos: trackAnswer(readiness, "photos"),
  };

  const written = createDraft(ref, input);
  if (!written.ok) {
    refused(user, "assemble_day", written.code ?? written.error);
    const status = written.bug ? 500 : 400;
    return Response.json({ error: written.code ?? written.error }, { status });
  }

  const attached = await attachDayFolderMedia(user, ref, date, written.slug);
  if (!attached.ok) {
    // The entry exists; the photos did not move. Report both rather than
    // hiding the partial success — this codebase never rolls an entry back
    // once written, so the honest answer names what still needs a hand.
    return Response.json(
      { ok: true, trip: tripId, slug: written.slug, mediaError: attached.error },
      { status: 201 },
    );
  }

  // The day folder's job was staging; remove it now that a real entry holds
  // everything it carried.
  fs.rmSync(dayInboxDir(user, date), { recursive: true, force: true });

  wrote(user, "assemble_day", { trip: tripId, slug: written.slug, date });
  return Response.json(
    { ok: true, trip: tripId, slug: written.slug, attached: attached.attached },
    { status: 201 },
  );
}

/** The pre-Task-3 branch, unchanged: record an answer to whatever the date
 *  folder was asked about, and stop there — the caller presses again, with
 *  nothing but `trip`/`date`, once `propose()` has nothing left to ask. */
function recordAnswer(
  user: string,
  tripId: string,
  date: string,
  answered: ReturnType<typeof declinesIn>,
  weatherAnswered: boolean,
): Response {
  const current = readDayReadiness(user, date);
  const without = [...current.without];
  const unrecorded = [...current.unrecorded];
  for (const [track, value] of Object.entries(answered)) {
    if (value === false && !without.includes(track as (typeof without)[number])) {
      without.push(track as (typeof without)[number]);
    }
    if (value === UNKNOWN && !unrecorded.includes(track as (typeof unrecorded)[number])) {
      unrecorded.push(track as (typeof unrecorded)[number]);
    }
  }
  writeDayReadiness(user, date, { without, unrecorded, weatherAsked: weatherAnswered || current.weatherAsked });

  wrote(user, "assemble_day", { trip: tripId, date });
  return Response.json({ ok: true, recorded: true }, { status: 200 });
}
