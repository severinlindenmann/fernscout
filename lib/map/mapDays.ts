import "server-only";
import { getDays, type ReadOptions } from "@/lib/entries";
import { isPlottable } from "@/lib/mapFrame";
import { isHiddenPlace } from "@/lib/gps/edits";
import { parseTripRef } from "@/lib/trips";

/**
 * One calendar day of the trip, for the map page's own day list/strip —
 * B2537. Distinct from `Place` (`lib/entries.ts`), which merges consecutive
 * days at the same location into one marker and drops any day with no
 * coordinates entirely. The map page's day list has to show *every*
 * published day, greyed when it gave no place ("Days without a place stay in
 * lists, greyed: 'no place given'" — docs/plans/2026-09-28-trip-maps/README.md),
 * so this walks `getDays` directly rather than reusing `getPlaces`.
 */
export type MapDay = {
  date: string;
  /** The lead entry's slug — what `/day/<slug>` links to. */
  slug: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  /** Whether this day can actually be drawn — `isPlottable` on the lead
   * entry's own coordinates. `false` is the "no place given" case. */
  hasPlace: boolean;
  /** How many photographs/clips this day carries, across every update
   * written that day — the day strip's own "update count". */
  mediaCount: number;
  /** How many separate updates were written this day. */
  updates: number;
  draft?: boolean;
};

export function getMapDays(ref: string, options?: ReadOptions): MapDay[] {
  // B2544 — same rule `getPlaces` (`lib/entries.ts`) applies: a day's own
  // typed `coordinates` is never a recorded fix, so it never went through
  // `deriveTrack`'s own hidden-spot cut. The owner's own studio
  // (`reader: "person"`) still gets the real pin.
  const owner = parseTripRef(ref);
  const checkHidden = options?.reader !== "person" && owner !== null;
  return getDays(ref, options).map((day) => {
    const lead = day.lead;
    const hidden = checkHidden && isPlottable(lead) && isHiddenPlace(owner.username, owner.tripId, { lat: lead.lat, lon: lead.lng });
    return {
      date: day.date,
      slug: lead.slug,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      lat: hidden ? NaN : lead.lat,
      lng: hidden ? NaN : lead.lng,
      // The day stays in the list, greyed the same as "no place given" —
      // never drawn on a map or card, only its name still turns up here.
      hasPlace: !hidden && isPlottable(lead),
      mediaCount: day.entries.reduce((n, e) => n + e.gallery.length, 0),
      updates: day.entries.length,
      draft: lead.draft,
    };
  });
}
