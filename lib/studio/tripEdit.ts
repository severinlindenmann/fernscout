import "server-only";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { ACCENTS, PLAN_READERS } from "@/lib/tripWrite";
import type { PlanReaders, Trip } from "@/lib/types";

/**
 * `/[user]/studio/trip?trip=<id>` — B2018.
 *
 * One trip's title, tagline, dates, visibility, plan readers, id and deletion
 * used to be four different places (`/me`'s pencil, `/studio/trip/visibility`,
 * `/studio/trip/rename`, and the trip page's own `DeleteTrip`). This is the
 * one page; `TripEditFlow` (`components/studio/trip/TripEditFlow.tsx`) is what
 * it renders.
 *
 * Deliberately not `tripForVisibilityFlow`/`tripsForVisibilityFlow`
 * (`lib/studio/tripVisibilityFlow.ts`): that module's null-id behaviour is to
 * fall back to `getCurrentTrip` silently, which is the exact bug this ticket
 * reported against the sibling flows (a multi-trip journal silently edits
 * whichever trip is "current"). This page shows a real picker instead.
 */
export function tripsForEdit(username: string): { id: string; title: string }[] {
  return getTrips(username).map((t) => ({ id: t.id, title: t.title }));
}

export function tripForEdit(username: string, tripId: string): Trip | undefined {
  return getTrip(tripRef(username, tripId));
}

/** The fields `TripEditFlow` needs about the selected trip — a subset of
 *  `Trip`, the same shape `app/at/[user]/me/page.tsx` used to build for its own
 *  (now-removed) pencil editor. */
export type TripEditPanel = {
  id: string;
  title: string;
  tagline: string;
  start: string;
  end: string;
  visibility: "public" | "guest" | "private";
  listed: boolean;
  teaser?: boolean;
  /** Whether `/studio/trip/plan-readers` has anything to say for this trip —
   *  that page's own empty state already handles the absent case gracefully,
   *  but there is no reason to link to it from here when there is nothing
   *  there. */
  hasPlan: boolean;
  /** Who sees the plan — its own section on the page (B2072). */
  planReaders: PlanReaders;
  planLevels: readonly PlanReaders[];
  /** Whether the plan-reader cards may name the budget total. */
  costsPublic: boolean;
  /** B1028 — opening words, card colour and who sees the money. */
  intro: string;
  accent: string | null;
  accents: readonly string[];
  /** Whether the journal has costs on; absent control when not. */
  costsAvailable: boolean;
  /** The stored costs section. A save sends it back whole with only
   *  `visibility` changed: `applyTripPatch` shallow-merges `costs`, so a
   *  bare `{visibility}` would wipe the budget, items and note. */
  costsSection?: Trip["costsSection"];
  hasTranslations: boolean;
};

export function tripEditPanel(trip: Trip, costsAvailable: boolean): TripEditPanel {
  return {
    id: trip.id,
    title: trip.title,
    tagline: trip.tagline ?? "",
    start: trip.start,
    end: trip.end,
    visibility: trip.visibility,
    listed: trip.listed,
    teaser: trip.teaser,
    hasPlan: Boolean(trip.planSection),
    planReaders: trip.planSection?.readers ?? "map",
    planLevels: PLAN_READERS,
    costsPublic: trip.costsVisibility === "public",
    intro: trip.intro ?? "",
    accent: trip.accent ?? null,
    accents: ACCENTS,
    costsAvailable,
    costsSection: trip.costsSection,
    hasTranslations: Object.keys(trip.translations ?? {}).length > 0,
  };
}
