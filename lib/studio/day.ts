import "server-only";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { getCurrentTrip, getTrips, tripRef } from "@/lib/trips";

// The pure half of this domain — `declinableFieldsFor`, `cannedReasonsFor`,
// `autoVisibilityDecline` — lives in `lib/studio/declinables.ts` instead,
// with no "server-only" marker, so `DeclineScreen.tsx` (a client component)
// can import `cannedReasonsFor` without pulling `node:fs` into the browser
// bundle. Since B2188 "Add a day" asks no declinable while writing (D1 as
// amended by B2191), so nothing here re-exports it.

/**
 * "Which day" (A2, spec §5) — the trip and date this flow proposes before it
 * ever asks. `getCurrentTrip()` is the same function the hub's own main card
 * already reads (`lib/studio/hub.ts`), so the proposal here and the sentence
 * on the hub can never disagree about which trip is current.
 *
 * The reasoning is stated rather than only implied — spec §5: "trip and date
 * are PROPOSED with the reasoning visible ... both changeable." A trip
 * `status: "current"` means its own dates include today; a `"past"` one is
 * offered as the most recent trip that has one, which is the same fallback
 * `getCurrentTrip` itself uses and is worth saying out loud rather than
 * leaving the person to wonder why a finished trip is what came up.
 */
export type DayProposal = {
  trip: { id: string; title: string; status: string };
  /** Translation key plus the vars it needs — composed here, worded by the
   *  caller, so the reasoning is never a hard-coded English sentence baked
   *  into server data. */
  reasonKey: "studio.day.which.reasonCurrent" | "studio.day.which.reasonPast";
  today: string;
};

export function proposeAddDayTrip(username: string): DayProposal | null {
  const current = getCurrentTrip(username);
  if (!current) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    trip: { id: current.id, title: current.title, status: current.status },
    reasonKey: current.status === "current" ? "studio.day.which.reasonCurrent" : "studio.day.which.reasonPast",
    today,
  };
}

/** Every trip this owner can propose a day onto, for "use a different trip"
 *  (A2's own escape hatch) — the same list `getTrips` already reads.
 *  `start`/`end` ride along so the "which day" step (B1989's `DayStrip`) can
 *  bound its week strip to the trip's own dates without a second read. */
export function tripsForAddDay(username: string): { id: string; title: string; start: string; end: string }[] {
  return getTrips(username).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }));
}

/**
 * D3 — whether the chosen date already has a day on this trip, and which
 * one. `getAllEntries(ref, AS_AUTHOR)` is the same read every other
 * owner-facing surface uses for "does this day exist" (see
 * `app/api/helper/[user]/day/route.ts`'s own `POST`), so this cannot find a
 * collision the rest of the system disagrees about.
 */
export type ExistingDayOnDate = { slug: string; title: string; status: "draft" | "published" };

export function findDayForDate(username: string, tripId: string, date: string): ExistingDayOnDate | null {
  const ref = tripRef(username, tripId);
  const found = getAllEntries(ref, AS_AUTHOR).find((e) => e.date === date);
  if (!found) return null;
  return { slug: found.slug, title: found.title, status: found.draft ? "draft" : "published" };
}

/**
 * Every date on this trip that already has a day — B1989's `DayStrip`, so
 * the week strip can mark those cells without a client-side fetch. Reads the
 * same owner-scoped source `findDayForDate` does (`getAllEntries(ref,
 * AS_AUTHOR)`), so the strip's marks and a collision found at `checkCollisionAndContinue`
 * can never disagree about which dates are taken.
 */
export function writtenDatesForTrip(username: string, tripId: string): string[] {
  const ref = tripRef(username, tripId);
  return getAllEntries(ref, AS_AUTHOR).map((e) => e.date);
}
