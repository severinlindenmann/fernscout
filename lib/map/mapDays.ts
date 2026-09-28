import "server-only";
import { getDays, type ReadOptions } from "@/lib/entries";
import { isPlottable } from "@/lib/mapFrame";

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
  return getDays(ref, options).map((day) => {
    const lead = day.lead;
    return {
      date: day.date,
      slug: lead.slug,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      lat: lead.lat,
      lng: lead.lng,
      hasPlace: isPlottable(lead),
      mediaCount: day.entries.reduce((n, e) => n + e.gallery.length, 0),
      updates: day.entries.length,
      draft: lead.draft,
    };
  });
}
