import "server-only";
import { isAdminEmail } from "../admin";
import { resolveAccess } from "../auth/handshake";
import { costForDay, costLocalForDay } from "../costs";
import { AS_AUTHOR, getAllEntries, getDays } from "../entries";
import { getTrips, tripRef } from "../trips";
import type { Day, DaySummary } from "../types";
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

export function draftForWizard(
  username: string,
  tripId: string,
  slug: string,
): WizardDraft | null {
  return draftsForWizard(username).find((d) => d.trip === tripId && d.slug === slug) ?? null;
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
