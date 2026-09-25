import "server-only";
import { getDays } from "../entries";
import { maySeeCosts } from "../access";
import { isEnabled } from "../capabilities";
import { getTrips, tripRef } from "../trips";
import type { ReaderLevel } from "../photos";
import type { Trip } from "../types";

/**
 * "What would that audience actually see?" — B1833, spec §7.5/§7.6.
 *
 * The preview screens in both the invite flow (R2) and the trip-visibility
 * flow (V2) are explicit that this has to come from **the real gate run
 * against the real trips**, not a table somebody wrote by hand — "a
 * hand-written table is one refactor away from lying" (spec §7.5). This is
 * that computation, reusable by both flows rather than written twice.
 *
 * It answers a slightly different question from `lib/tripGate.ts`'s own
 * `mayReadTrip`: that function asks "may *the signed-in session* read this",
 * resolved from a cookie. Here there is no session to resolve — the flow is
 * asking on behalf of somebody who has not been invited yet, or previewing a
 * visibility nobody has chosen yet — so the three audiences are asked about
 * directly, in the same order and with the same three branches `mayReadTrip`
 * uses for a stranger, an approved guest and somebody who was on the trip.
 * A `private` trip is still closed to the first two and open to the third,
 * exactly as `mayReadTrip` decides it.
 */

export type PreviewAudience = "public" | "guest" | "private";

export type TripPreview = {
  id: string;
  title: string;
  status: Trip["status"];
  /** Whether this audience may open the trip at all, under `visibility`. */
  opens: boolean;
  /** Published days only — a preview is never shown a draft (`readFor`'s own
   *  rule: drafts are for the owner and for travellers, and `private` is the
   *  only audience here that is ever a traveller). */
  publishedDays: number;
  /** Days on this trip that are still drafts — the "what they will not see"
   *  list's own draft count (R2/V2, spec §7.5/§7.6). Zero on a trip this
   *  audience cannot open at all: there is nothing to contrast a closed
   *  trip's drafts against when the whole trip is already the answer. */
  draftDays: number;
  /** Published days this audience may not read (a day labelled `guest` or
   *  `private`) — a separate fact from drafts, B2132. */
  heldBackDays: number;
  photoCount: number;
  costsVisible: boolean;
};

function readerLevelFor(audience: PreviewAudience): ReaderLevel {
  if (audience === "public") return "public";
  if (audience === "guest") return "guest";
  return "person";
}

/**
 * Whether a reader of `audience` may open a trip carrying `visibility` —
 * `mayReadTrip`'s own three branches, minus the owner (a preview never asks
 * "what would the owner see", they already know).
 */
export function opensForAudience(visibility: Trip["visibility"], audience: PreviewAudience): boolean {
  // A traveller is the one door `private` cannot close — `mayReadTrip`'s own
  // "the people who took it are always let in, whichever way the trip is
  // closed."
  if (audience === "private") return true;
  if (visibility === "public") return true;
  if (visibility === "guest") return audience === "guest";
  return false;
}

/**
 * One trip, as `audience` would see it — real published days, real
 * photograph counts, a real costs-visible answer, under `visibility` (the
 * trip's own, or a candidate the caller is still only considering).
 */
export function previewTrip(
  username: string,
  trip: Trip,
  audience: PreviewAudience,
  visibility: Trip["visibility"] = trip.visibility,
): TripPreview {
  const opens = opensForAudience(visibility, audience);
  if (!opens) {
    return { id: trip.id, title: trip.title, status: trip.status, opens: false, publishedDays: 0, draftDays: 0, heldBackDays: 0, photoCount: 0, costsVisible: false };
  }
  const ref = tripRef(username, trip.id);
  const published = getDays(ref, { includeDrafts: false, reader: readerLevelFor(audience) });
  // The owner's own count, including drafts — the gap between the two is
  // exactly what this audience does not see: drafts, and published days held
  // back from them (B2132 — the two used to be counted as one).
  const everything = getDays(ref, { includeDrafts: true, reader: "person" });
  const draftDays = everything.filter((day) => day.entries.every((e) => e.draft)).length;
  const photoCount = published.reduce((sum, day) => sum + day.entries.reduce((n, e) => n + e.gallery.length, 0), 0);
  // `isGuest` for `maySeeCosts` — proved membership, which both the guest and
  // the private/traveller audience here already have (see the doc comment on
  // `lib/access.ts`'s own `isGuestOf`, which this mirrors without a session).
  const costsVisible = isEnabled("costs", username) && maySeeCosts({ ...trip, visibility }, audience !== "public");
  return {
    id: trip.id,
    title: trip.title,
    status: trip.status,
    opens,
    publishedDays: published.length,
    draftDays,
    heldBackDays: Math.max(0, everything.length - draftDays - published.length),
    photoCount,
    costsVisible,
  };
}

/** Every trip in the journal, as `audience` would see it today — R2's own
 *  "what that person gets". */
export function previewJournal(username: string, audience: PreviewAudience): TripPreview[] {
  return getTrips(username).map((trip) => previewTrip(username, trip, audience));
}
