// Domain assembly for a v2 trip document — B1612 (phase 2 step 3, parcel B).
//
// What a `trip.json` on disk does not carry and every GET/PUT/PATCH echo
// must: the derived `status`, the effective `cover`, whether a track exists,
// and the "who got mailed" notifications a PUT/PATCH that adds people
// produces. Kept out of the route files so GET, PUT and PATCH — which all
// have to build the same echo — share one function rather than three copies
// that can drift.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { calendarStatus } from "../../tripTime";
import { getUser } from "../../users";
import { getContactByEmail } from "../../contacts";
import { sendMail } from "../../mail";
import { rateLimitFor } from "../../rateLimit";
import { contentRoot } from "../../contentRoot";
import { readDayFile, listDaySlugs } from "./store";
import { dayEchoInput } from "./days";
import { tripRef } from "../../trips";
import { daySummary, tripDoc, type DaySummary } from "./schemas";
import type { DayFile, TripFile } from "./documents";

/** Every day file this trip actually has, in slug (date) order. */
export function tripDays(user: string, tripId: string): DayFile[] {
  return listDaySlugs(user, tripId)
    .map((slug) => readDayFile(user, tripId, slug))
    .filter((d): d is DayFile => d !== null);
}

/** Newest-day-first pick of whatever photograph exists, for a trip that
 * declined `cover` or never set one. "Newest" is the day with the latest
 * date carrying at least one photograph; ties keep file order. */
function pickCover(days: readonly DayFile[]): string | undefined {
  const withMedia = days.filter((d) => d.media && d.media.length > 0);
  if (withMedia.length === 0) return undefined;
  const newest = [...withMedia].sort((a, b) => b.date.localeCompare(a.date))[0];
  return newest.media?.[0]?.src;
}

/** Whether `track.json` exists for this trip, and when it was last derived —
 * the one thing `tripDoc.track` reports; the store behind it is never read
 * from here (`lib/gps/store.ts` is reachable from nothing under `app/`, and
 * this file is domain code a route imports, not a route itself — but the
 * rule holds regardless of who is asking). */
function trackPresence(user: string, tripId: string): { present: boolean; updatedAt?: string } {
  const file = path.join(contentRoot(), user, "trips", tripId, "track.json");
  try {
    const stat = fs.statSync(file);
    return { present: true, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { present: false };
  }
}

function deriveStatus(trip: Pick<TripFile, "dates">): "current" | "upcoming" | "past" {
  // v2 has no `status:` to declare — see trip.ts's own comment: a stored
  // "current" is retired, so this is `calendarStatus` alone, always.
  return calendarStatus({ start: trip.dates.from });
}

/** `plan.private` dropped whole — B2009. Beside `mayReadTrip`/`readerLevelFor`
 * in lib/tripGate.ts, which do the same thing for drafts on the page-rendering
 * side; the v2 GET route is the API's own door onto the same rule. Deletes
 * the key rather than setting it `undefined`, so it is absent from the JSON
 * a caller reads and from the ETag either builds over the body. */
function stripPlanPrivate(plan: TripFile["plan"]): TripFile["plan"] {
  if (!plan || plan.private === undefined) return plan;
  const { private: _private, ...rest } = plan;
  return rest;
}

/**
 * The one place every GET/PUT/PATCH echo of a trip is assembled — V12's
 * `?days=full|summaries|none` on the read side, plus the derived `status`,
 * `cover` and `track` every echo carries regardless. A write echo always
 * passes `"full"`: "it was accepted" and "it is there" are the same claim
 * (AGENTS.md), and a caller that just wrote the trip is exactly the one who
 * wants to see what landed.
 *
 * `includePrivatePlan` (B2009) defaults to true, since every PUT/PATCH echo
 * is already owner-only (`mayActAsOwner` — see the route) and a caller who
 * just wrote the trip is entitled to read back exactly what landed. Only
 * `GET` ever passes `false`, for a bearer that proved it belongs to this
 * journal (`ownsUser`) but not that it is the owner.
 */
export function buildTripDoc(
  user: string,
  id: string,
  trip: TripFile,
  daysMode: "full" | "summaries" | "none",
  options: { includePrivatePlan?: boolean } = {},
): Record<string, unknown> {
  const days = tripDays(user, id);
  const daysField: unknown[] | Record<string, never>[] | DaySummary[] =
    daysMode === "none"
      ? []
      : daysMode === "summaries"
        ? days.map((d) => daySummary.parse({ slug: d.slug, title: d.title, date: d.date, status: d.status, test: d.test }))
        : days.map((d) => dayEchoInput(d, tripRef(user, id)));

  const doc = {
    ...trip,
    id,
    days: daysField,
    status: deriveStatus(trip),
    cover: trip.cover ?? pickCover(days),
    track: trackPresence(user, id),
    ...(options.includePrivatePlan === false && trip.plan ? { plan: stripPlanPrivate(trip.plan) } : {}),
  };

  // `tripDoc` requires `days: dayDoc[]` — only true of the "full" projection.
  // `summaries`/`none` are documented, deliberate narrowings of the same
  // response (V12), so they are returned as plain objects rather than forced
  // through a schema built for a different shape.
  return daysMode === "full" ? tripDoc.parse(doc) : doc;
}

export type TripNotification = { email: string; kind: "trip-added" | "journal-invite" };

/**
 * Mail every newly-added, non-owner person on this trip — a "you are on
 * trip X" note to an address this journal already has a contact record for,
 * an onboarding invite to one it does not. `before` is the emails already on
 * the trip prior to this write (empty on create); anybody in `people` not in
 * `before` is new.
 *
 * Best-effort: a mail that fails to send does not fail the write, and is
 * simply absent from the returned list — this reports what went out, never
 * what was granted (AGENTS.md: report a link as an invitation to ask, never
 * as access).
 */
export async function notifyNewPeople(
  user: string,
  tripTitle: string,
  people: readonly { name: string; email: string }[],
  before: readonly string[],
): Promise<TripNotification[]> {
  const journal = getUser(user);
  if (!journal) return [];
  const ownerEmail = journal.owner.email?.trim().toLowerCase();
  const already = new Set(before.map((e) => e.trim().toLowerCase()));

  const notifications: TripNotification[] = [];
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (email === ownerEmail) continue;
    if (already.has(email)) continue;

    // B1689: `people:` is written by whoever holds write access to the
    // trip, and the address is chosen anew on every write — toggling one
    // on and off `people:` would otherwise resend mail to it as fast as
    // writes allow. Keyed on the outgoing address, like `contact-resend`,
    // so the limit tracks the mailbox being spammed regardless of which
    // write token drives it.
    if (!rateLimitFor("trip-people-notify", email, { max: 3, windowMs: 60 * 60 * 1000 }).ok) continue;

    const known = await getContactByEmail(user, email).catch(() => null);
    const kind: "trip-added" | "journal-invite" = known ? "trip-added" : "journal-invite";
    const subject = known
      ? `You're on ${journal.title}'s trip "${tripTitle}"`
      : `${journal.title} added you to a trip`;
    const text = known
      ? `${person.name}, you've been added to the trip "${tripTitle}" in ${journal.title}.`
      : `${person.name}, ${journal.title} has added you to their trip "${tripTitle}". Sign in ` +
        `to read it and write to it: this address is how you'll be recognised.`;

    const sent = await sendMail({
      to: email,
      subject,
      text,
      html: `<p>${text}</p>`,
      username: user,
    }).catch(() => null);
    if (sent) notifications.push({ email, kind });
  }
  return notifications;
}
