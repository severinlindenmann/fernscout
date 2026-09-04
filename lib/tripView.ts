import "server-only";
import { basemapFor, basemapForRoute } from "./basemap";
import { getAllEntries, getDays, getDefaultDay, getTripStats } from "./entries";
import { costForDay, getCostSummary } from "./costs";
import { getTrip } from "./trips";
import type { Day, DaySummary, Trip } from "./types";
import type { HeroStats } from "@/components/TripHero";

/**
 * How many days either side of the one being read are sent with the page.
 *
 * Two is enough that Back and Continue never wait: by the time the reader has
 * moved one step the next window is already in flight. See `storyWindow`.
 */
export const STORY_WINDOW = 2;

export type StoryProps = {
  trip: Trip;
  /**
   * Every day of the trip, but only what the navigation needs: the path, the
   * day list, the route line and the travel legs. Roughly 150 bytes each,
   * against ~11 KB for a full day, which is what makes the page's size stop
   * tracking the length of the trip.
   */
  index: DaySummary[];
  /** Full days — only those in the window around `windowStart`. */
  days: Day[];
  /** Where `days[0]` sits in `index`. */
  windowStart: number;
  /** The day the pager treats as "today" for this trip. */
  initialDate?: string;
  /** A specific day to open at, from the /day/<slug> route. */
  openAtDate?: string;
  stats: HeroStats;
  /**
   * The basemap for the hero's small map, clipped here rather than in the
   * browser — the same reason the trip map does it (lib/basemap.ts). Built in
   * this function because all four routes that render a story go through it,
   * and the alternative was passing it down four call sites that otherwise have
   * nothing to say about maps.
   */
  basemap: ReturnType<typeof basemapFor>;
};

/**
 * Whether a trip's page draws the countdown instead of the story.
 *
 * Two conditions, and the second is the one B72 was missing. `status` is
 * already reconciled against the dates (`effectiveStatus`), so a trip that has
 * begun cannot reach here as `upcoming` — but a countdown whose closing line
 * is a hardcoded "no days yet" must not be drawn over published days under any
 * status scheme, and this is what says so.
 *
 * Drafts deliberately do not count. A future-dated draft is how an upcoming
 * trip's planned route is written (lib/plan.ts), so an owner drafting ahead
 * keeps the countdown — which is the page that shows them the plan.
 */
export function showsCountdown(trip: Pick<Trip, "ref" | "status">): boolean {
  return trip.status === "upcoming" && getAllEntries(trip.ref).length === 0;
}

/** The navigation's view of one day. */
function summarise(day: Day, cost: number): DaySummary {
  const lead = day.lead;
  return {
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
    cost,
  };
}

/** Clamps a window of `STORY_WINDOW` either side of `centre` to the trip. */
export function windowFor(dayCount: number, centre: number): { from: number; to: number } {
  const from = Math.max(0, centre - STORY_WINDOW);
  const to = Math.min(dayCount, centre + STORY_WINDOW + 1);
  return { from, to };
}

/**
 * Days `from`…`to` of a trip, in full.
 *
 * The story page's on-demand loader, and the only thing behind
 * `/<user>/story.json`. Returns fewer days than asked for at the ends of the
 * trip rather than erroring — the caller is a reader paging, not an API
 * client.
 */
export function storyWindow(
  ref: string,
  from: number,
  to: number,
  viewer: Pick<ViewerOptions, "showCosts" | "includeDrafts"> = {},
): Day[] {
  const { showCosts = true, includeDrafts = false } = viewer;
  const days = getDays(ref, { includeDrafts });
  const window = days.slice(Math.max(0, from), Math.min(days.length, to));
  return showCosts ? window : window.map(withoutCosts);
}

/**
 * A day with every price removed.
 *
 * `costsVisibility: guests` is a promise about numbers, and a number omitted
 * from the rendering but present in the payload is not omitted. Applied to the
 * data rather than to the components, so a new component cannot reintroduce
 * the leak by reading a field it should not have been handed.
 */
function withoutCosts(day: Day): Day {
  const strip = (e: Day["lead"]) => ({ ...e, costs: [] });
  return {
    ...day,
    lead: strip(day.lead),
    entries: day.entries.map(strip),
  };
}

/**
 * Everything a story page needs for one trip.
 *
 * `/` and `/day/<slug>` and their `/trips/<id>/…` counterparts all render the
 * same component with the same shape of props; assembling that in four places
 * is how they drift apart.
 *
 * `openAt` names the day the reader arrived on, and decides which days are
 * sent in full. Everything else about the page — the winding path, the day
 * list, the map route — is drawn from `index`, which stays cheap however long
 * the trip runs.
 */
/** What this particular viewer is allowed to be shown. */
export type ViewerOptions = {
  /** The day the reader arrived on, from a `/day/<slug>` route. */
  openAt?: string;
  /**
   * False for a trip whose `costsVisibility` keeps its numbers from this
   * viewer. See `maySeeCosts` — resolved by the page, which is the only layer
   * that can read a cookie.
   */
  showCosts?: boolean;
  /** True only for the journal's owner, reading their own site. */
  includeDrafts?: boolean;
};

export function buildStoryProps(tripId: string, viewer: ViewerOptions = {}): StoryProps {
  const { openAt, showCosts = true, includeDrafts = false } = viewer;
  const read = { includeDrafts };
  const trip = getTrip(tripId);
  if (!trip) throw new Error(`Unknown trip: ${tripId}`);

  const days = getDays(tripId, read);
  const costs = getCostSummary(tripId);
  const index = days.map((d) =>
    summarise(d, showCosts ? costForDay(tripId, d.entries) : 0),
  );

  const initialDate = getDefaultDay(tripId, read)?.date;
  // Open where the reader asked, otherwise around today — a reader who lands
  // on the overview and presses "Jump to today" must not wait for a fetch.
  const centreDate = openAt ?? initialDate;
  const centre = Math.max(0, index.findIndex((d) => d.date === centreDate));
  const { from, to } = windowFor(days.length, centre);

  return {
    trip,
    index,
    // Framed on the same points MiniMap frames on, so the clip covers what is
    // actually drawn. `frameRoute` is pure, so the two agree — and an empty
    // index draws no hero and therefore no map, so it gets no basemap either
    // (B85). `basemapFor` stays in the type above as the shape of the result.
    basemap: basemapForRoute(index),
    days: showCosts ? days.slice(from, to) : days.slice(from, to).map(withoutCosts),
    windowStart: from,
    initialDate,
    openAtDate: openAt,
    stats: {
      ...getTripStats(tripId, read),
      ...(showCosts
        ? {
            totalSpend: costs.total,
            spendPerDay: costs.perDay,
            byCategory: costs.byCategory.map((c) => ({
              category: c.category,
              amount: c.amount,
            })),
            byCountry: costs.byCountry.map((c) => ({
              country: c.country,
              countryCode: c.countryCode,
              nights: c.nights,
              amount: c.amount,
            })),
          }
        : {
            // Nights per country is not spending, and the map and the hero
            // both want it. Only the money goes.
            byCountry: costs.byCountry.map((c) => ({
              country: c.country,
              countryCode: c.countryCode,
              nights: c.nights,
              amount: 0,
            })),
          }),
    },
  };
}
