import "server-only";
import fs from "node:fs";
import { createDraft, type DraftInput } from "@/lib/api/entries";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { attachDayFolderMedia } from "@/lib/dayFolderAttach";
import {
  dayInboxDir,
  listDayInbox,
  listInbox,
  moveInboxFileFromDay,
  moveInboxFileToDay,
  updateInboxMeta,
  type InboxMeta,
} from "@/lib/inbox";
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
 * directly: `weatherAsked` on either answer ("look it up" and "no" are both
 * real answers, only "nobody has been asked yet" is not), and `weatherLookup`
 * only on "look it up", which is what the create step below reads to decide
 * whether to request the archive at all. A caption answer — free text, or a
 * blank press meaning "asked, nothing to say" — lands on the photograph's own
 * inbox sidecar (`updateInboxMeta`), never on `day.json`: a caption belongs to
 * the photo, wherever it is staged, not to the date.
 *
 * **The final-review fix this file also carries:** a "several days from one
 * batch" answer — the `chooseDate` marker `assemble_day`'s own proposal sends
 * — moves the matching undated content into that date's folder and says so,
 * rather than falling through to the create branch below and 422ing under a
 * reassuring label.
 *
 * **What this half does, since Task 3:** the press that names no answer at
 * all — nothing but `trip`/`date`, which is what `propose()` sends once
 * nothing is missing — is the "create it" press. `missingForDayFolder` is
 * asked again here, at the door, exactly as `POST .../day`'s own
 * `missingFrom` check is asked again before its own write: nothing upstream
 * can be trusted to have re-checked between the proposal and this press. Once
 * that holds, the day folder's words and answers become a real entry
 * (`createDraft`), a "look it up" weather answer is asked of the archive the
 * same way `POST .../day` asks it (`fillDayWeatherQuietly`), its staged
 * photographs move onto it (`attachDayFolderMedia`), anything else the folder
 * still holds (a contact card, a location pin) moves back to the flat bucket
 * rather than being destroyed with the folder, and only then is the folder
 * itself removed — its job was staging, and everything it carried now has
 * somewhere else to be.
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

  /**
   * "Several days from one batch", answered — the `chooseDate` marker
   * `assemble_day`'s own multiple-dates proposal carries, and the only
   * fixed field that names this press rather than an ordinary missing-
   * fields answer or the create press (both of which send `trip`/`date`
   * alone, or `trip`/`date` plus track/weather/caption answers, and never
   * this one). Move every undated flat-bucket item whose own timestamp names
   * this date into its folder, then say so — never "created", since nothing
   * has been.
   */
  if (text(body.chooseDate) !== "") {
    let moved = 0;
    for (const entries of Object.values(listInbox(user))) {
      for (const entry of entries) {
        const stamp = entry.takenAt ?? entry.receivedAt;
        if (stamp && stamp.length >= 10 && stamp.slice(0, 10) === date) {
          moveInboxFileToDay(user, entry.id, date);
          moved += 1;
        }
      }
    }
    wrote(user, "assemble_day", { trip: tripId, date, moved });
    return Response.json({ ok: true, moved }, { status: 200 });
  }

  const answered = declinesIn(body);
  const weatherAnswer = body.weather === "lookup" ? "lookup" : body.weather === "decline" ? "decline" : undefined;
  const captionPhoto = text(body.caption_photo);

  if (Object.keys(answered).length > 0 || weatherAnswer !== undefined || captionPhoto !== "") {
    return recordAnswer(
      user,
      tripId,
      date,
      answered,
      weatherAnswer,
      captionPhoto !== "" ? { photoId: captionPhoto, caption: text(body.caption) } : undefined,
    );
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
    // A request, exactly as `POST .../day`'s own `weather: true` is one —
    // only when the folder's own readiness says "look it up" was the actual
    // answer, never merely "asked" (`weatherAsked` alone covers a decline
    // too, and a decline must fetch nothing).
    ...(readiness.weatherLookup ? { weather: true } : {}),
  };

  const written = createDraft(ref, input);
  if (!written.ok) {
    refused(user, "assemble_day", written.code ?? written.error);
    const status = written.bug ? 500 : 400;
    return Response.json({ error: written.code ?? written.error }, { status });
  }

  // The one documented route to a day's weather (AGENTS.md, B325): the public
  // archive, at the day's own coordinates, only once the entry itself exists
  // — the same order `POST .../day` already keeps.
  if (readiness.weatherLookup) {
    await fillDayWeatherQuietly(ref, written.slug);
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

  // Anything the folder still holds that is not `media` — a contact card, a
  // location pin, a document — was never this call's to attach, and the
  // folder's own job was staging rather than deciding what to do with it.
  // Move it back to the flat bucket before the folder goes, so `rmSync`
  // below only ever removes a tree that is actually empty.
  for (const entries of Object.values(listDayInbox(user, date))) {
    for (const entry of entries) {
      if (entry.kind === "media") continue;
      moveInboxFileFromDay(user, date, entry.id);
    }
  }

  // The day folder's job was staging; remove it now that a real entry holds
  // everything it carried and everything else has somewhere else to be.
  fs.rmSync(dayInboxDir(user, date), { recursive: true, force: true });

  wrote(user, "assemble_day", { trip: tripId, slug: written.slug, date });
  return Response.json(
    { ok: true, trip: tripId, slug: written.slug, attached: attached.attached },
    { status: 201 },
  );
}

/** Record an answer to whatever the date folder was asked about, and stop
 *  there — the caller presses again, with nothing but `trip`/`date`, once
 *  `propose()` has nothing left to ask. Since Fix 1/2 this also carries a
 *  caption answer (a filled-in caption, or a decline recorded as
 *  `descriptionAsked`) and tells a weather "look it up" from a "no". */
function recordAnswer(
  user: string,
  tripId: string,
  date: string,
  answered: ReturnType<typeof declinesIn>,
  weatherAnswer: "lookup" | "decline" | undefined,
  captionAnswer: { photoId: string; caption: string } | undefined,
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
  writeDayReadiness(user, date, {
    without,
    unrecorded,
    weatherAsked: weatherAnswer !== undefined || current.weatherAsked,
    weatherLookup: weatherAnswer === "lookup" ? true : current.weatherLookup,
  });

  if (captionAnswer) {
    // A filled-in caption is written as one; a press with nothing typed is
    // an honest "asked and there was nothing to say" — `descriptionAsked`,
    // mirroring `Entry.weatherAsked`, so `missingForDayFolder` stops asking
    // either way.
    const patch: InboxMeta = captionAnswer.caption !== "" ? { caption: captionAnswer.caption } : { descriptionAsked: true };
    updateInboxMeta(user, captionAnswer.photoId, patch, date);
  }

  wrote(user, "assemble_day", { trip: tripId, date });
  return Response.json({ ok: true, recorded: true }, { status: 200 });
}
