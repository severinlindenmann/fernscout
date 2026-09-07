import "server-only";
import fs from "node:fs";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { GPS_IMPORTERS } from "@/importers/gps";
import { isAdminEmail } from "../admin";
import { resolveAccess } from "../auth/handshake";
import { costForDay, costLocalForDay } from "../costs";
import { AS_AUTHOR, getAllEntries, getDays, getEntryBySlug } from "../entries";
import { getTrips, tripRef } from "../trips";
import type { Day, DaySummary } from "../types";
import { findInboxFile, listInbox, type InboxEntry } from "../inbox";
import { getUser } from "../users";
import { isWritten, type WizardDraft } from "./draft";

/**
 * The helper's own door guard — B682.
 *
 * **Cookie only, and bearer refused by construction.** `isOwner` in
 * `lib/contacts/session.ts` answers the same question for either credential,
 * and it is right to: the surfaces it guards are things an owner does from a
 * page *or* from a script. The wizard is not one of those. It is a browser
 * flow, everything it can do an agent can already do through `/api/v1/…` with
 * its own token, and a second bearer-accepting write surface outside the
 * documented contract is exactly what `/openapi.json` would then be lying
 * about. So this asks `resolveAccess` — which reads the two cookies and
 * nothing else — and never looks at an `Authorization` header.
 *
 * The address is re-checked against `owner.email` on every call, so a
 * year-old identity cookie opens what its holder is entitled to today (B410).
 */
export async function isHelperOwner(username: string): Promise<boolean> {
  const journal = getUser(username);
  if (!journal) return false;
  const { email } = await resolveAccess(username);
  if (!email) return false;
  return email === journal.owner.email || isAdminEmail(email);
}

/**
 * The helper family's one refusal — B779.
 *
 * The status stays 404 and stays the same for a journal that is not yours as
 * for one that does not exist: a wizard URL must not confirm whose journal it
 * is, and every route here answers alike for that reason.
 *
 * What was wrong was the word. A caller holding a **valid** agent token for
 * the journal it named was told `not_your_journal` — that they do not own a
 * journal they demonstrably do own — when the actual cause is that this
 * family never reads `Authorization` at all (`isHelperOwner` above). So when
 * a bearer token is present, the body says so and names the door that does
 * take it. It confirms nothing: the caller has already proved who they are,
 * and the sentence is the same one for a token belonging to somebody else.
 */
export function notYourJournal(request: Request): Response {
  const bearer = request.headers.get("authorization");
  return Response.json(
    {
      error: "not_your_journal",
      ...(bearer
        ? {
            message:
              "This is the helper — a browser flow — and it reads a signed-in session " +
              "cookie only. It never looks at an Authorization header, so a valid token " +
              "gets this same answer, and this is not a statement about who owns the " +
              "journal. Everything here an agent does through /api/v1/<user>/… with that " +
              "token: see /agent.md and /openapi.json.",
          }
        : {}),
    },
    { status: 404 },
  );
}

/** One trip, as the wizard's first step needs it. */
export type WizardTrip = {
  id: string;
  title: string;
  start: string;
  end: string;
};

export function tripsForWizard(username: string): WizardTrip[] {
  return getTrips(username)
    .map((trip) => ({ id: trip.id, title: trip.title, start: trip.start, end: trip.end }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Every unfinished day in this journal, newest first.
 *
 * This is the resume card's whole source, and the reason there is no session
 * table: the drafts on disk already say what is unfinished and how far it got.
 * `getAllEntries` with `AS_AUTHOR` is the same read `GET /api/v1/<user>/drafts`
 * makes.
 */
export function draftsForWizard(username: string): WizardDraft[] {
  const out: WizardDraft[] = [];
  for (const trip of getTrips(username)) {
    for (const entry of getAllEntries(trip.ref, AS_AUTHOR)) {
      if (!entry.draft) continue;
      out.push({
        trip: trip.id,
        slug: entry.slug,
        date: entry.date,
        title: entry.title,
        photos: entry.gallery.length,
        written: isWritten(entry.content),
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One day the wizard is holding — draft **or published** (B816).
 *
 * `draftsForWizard` above is the resume list and stays drafts-only; this is
 * the read behind `GET /api/helper/<user>/day`, and a published day has to
 * come back through it or the browser is read-only the moment a day goes up.
 * `published` is what the screen turns into a different sentence and a
 * different button — never into a different write.
 */
export function dayForWizard(
  username: string,
  tripId: string,
  slug: string,
): WizardDraft | null {
  const entry = getEntryBySlug(tripRef(username, tripId), slug, AS_AUTHOR);
  if (!entry) return null;
  return {
    trip: tripId,
    slug: entry.slug,
    date: entry.date,
    title: entry.title,
    photos: entry.gallery.length,
    written: isWritten(entry.content),
    ...(entry.draft ? {} : { published: true as const }),
  };
}

/**
 * The days of a finished trip that nobody ever started — B819.
 *
 * The journal already knows both halves: the trip's own dates, and which
 * dates carry an entry. Nothing showed the difference, so a person returning
 * to a half-written trip had to remember which days were missing and type
 * them in.
 *
 * **One trip, and only one that has ended.** A trip still running has days
 * that are missing because they have not happened yet, and a trip nobody has
 * written a word of is not a gap — it is a trip somebody has not started. What
 * comes back is the most recently finished trip that has at least one day
 * written and at least one day missing, or nothing at all: the ticket's own
 * warning is that a trip where somebody deliberately wrote three days of
 * fourteen is not a to-do list with eleven failures on it.
 */
export type TripGap = {
  trip: string;
  title: string;
  /** How many days the trip ran. */
  total: number;
  /** The dates with no entry of any kind, oldest first. */
  missing: string[];
};

export function gapsForWizard(username: string, today: string): TripGap | null {
  for (const trip of getTrips(username).sort((a, b) => b.end.localeCompare(a.end))) {
    if (trip.end >= today) continue;
    const written = new Set(getAllEntries(trip.ref, AS_AUTHOR).map((entry) => entry.date));
    if (written.size === 0) continue;
    const missing: string[] = [];
    let total = 0;
    for (let at = new Date(`${trip.start}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
      const date = at.toISOString().slice(0, 10);
      if (date > trip.end) break;
      total += 1;
      // A trip whose dates are the wrong way round, or one that ran a year:
      // stop rather than walk forever.
      if (total > 400) break;
      if (!written.has(date)) missing.push(date);
    }
    if (missing.length === 0) continue;
    return { trip: trip.id, title: trip.title, total, missing };
  }
  return null;
}

/**
 * The day exactly as a reader's own page would build it, so the preview
 * cannot flatter it.
 *
 * Every other update written on the same date comes along, because that is
 * what the story page draws: a second update the person forgot about is part
 * of how the day will read, and a preview showing only the new one would be a
 * quietly optimistic lie.
 */
export function previewOf(
  username: string,
  tripId: string,
  slug: string,
): { day: Day; summary: DaySummary; dayIndex: number } | null {
  const ref = tripRef(username, tripId);
  const days = getDays(ref, AS_AUTHOR);
  // The day's place in the trip, because the card prints "Day 4" in its corner
  // and a preview that always said "Day 1" would be wrong about the one thing
  // a reader uses to orient themselves.
  const dayIndex = days.findIndex((d) => d.entries.some((e) => e.slug === slug));
  if (dayIndex < 0) return null;
  const day = days[dayIndex];
  const lead = day.lead;
  return {
    dayIndex,
    day,
    summary: {
      date: day.date,
      slug: lead.slug,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      lat: lead.lat,
      lng: lead.lng,
      transport: lead.transport,
      travelScene: lead.travelScene,
      updates: day.entries.length,
      cost: costForDay(ref, day.entries),
      costLocal: costLocalForDay(ref, day.entries),
    },
  };
}

/* -------------------------------------------------------------------------
 * What is sitting in the inbox, and what each file could become — B689.
 *
 * `lib/inbox.ts` has held files that belong to no day since B663, and since
 * B683 the helper's own upload step parks anything that is not a photograph
 * there rather than refusing it. Nothing read them. This is the screen that
 * does, and the *guess* below is the whole of it — deterministic, from the
 * file's own first bytes, through the importers that already exist. No model
 * is asked what a file is; a model only ever reads a header row, and only for
 * a statement nothing here recognises.
 * ---------------------------------------------------------------------- */

/** What the inbox screen can offer to do with one file. */
type InboxOffer =
  /** A location history one of `importers/gps/` recognises. Read by code. */
  | { kind: "gps"; format: string; label: string }
  /** A bank statement one of `importers/costs/` recognises. Also code. */
  | { kind: "statement"; format: string; label: string }
  /** A CSV nothing recognises: the one case that asks a model for a mapping. */
  | { kind: "statement" }
  /** Something nothing here reads. Offered nothing, and kept anyway. */
  | { kind: "unknown" };

export type InboxItem = { entry: InboxEntry; offer: InboxOffer };

/** The same 64 kB every importer's `detect` is promised. */
const HEAD_BYTES = 64 * 1024;

function headOf(file: string): string {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Everything in `inbox/files/`, newest first, each with what it could become.
 *
 * Photographs are not here: they already have a door (the wizard's own upload
 * step), and listing two hundred of them would bury the one statement.
 */
export function inboxForWizard(username: string): InboxItem[] {
  return listInbox(username).files.map((entry) => {
    const found = findInboxFile(username, entry.id);
    let head = "";
    try {
      if (found) head = headOf(found.file);
    } catch {
      // Unreadable is offered nothing rather than crashing the screen.
    }
    return { entry, offer: offerFor(head, entry.filename) };
  });
}

function offerFor(head: string, filename: string): InboxOffer {
  const gps = GPS_IMPORTERS.find((importer) => importer.detect(head, filename));
  if (gps) return { kind: "gps", format: gps.id, label: gps.label };
  const costs = COSTS_IMPORTERS.find((importer) => importer.detect(head, filename));
  if (costs) return { kind: "statement", format: costs.id, label: costs.label };
  if (/\.csv$/i.test(filename)) return { kind: "statement" };
  return { kind: "unknown" };
}
