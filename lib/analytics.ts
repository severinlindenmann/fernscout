/**
 * What a trip can be added up into — B557.
 *
 * The nav used to hold one tab called Costs, which is the only place a trip
 * was ever *summed* rather than read. That made spending the only question a
 * trip could answer about itself, and when B325 put a measured temperature on
 * every day there was nowhere for forty of them to go. This module answers
 * the one question the hub and the nav both ask: which analyses does this
 * journal, or this trip, actually have something to show for.
 *
 * The pair it asks is the pair `costsAvailable` established (B267): the
 * capability must be **on**, and there must be **data**. Either alone puts a
 * tab in the nav leading to a page with nothing on it, which is the failure
 * AGENTS.md calls absent-rather-than-broken.
 */

import "server-only";

import { isEnabled } from "./capabilities";
import { costsAvailable, hasCostsData } from "./costs";
import { getDays } from "./entries";
import type { ReadOptions } from "./entries";
import { getTripIds, tripRef } from "./trips";
import { hasWeather, weatherDays } from "./weatherStats";

/** Whether this one trip has readings worth a page. */
function hasWeatherData(ref: string, options?: ReadOptions): boolean {
  return hasWeather(weatherDays(getDays(ref, options)));
}

/**
 * Whether the journal has weather anywhere.
 *
 * Never passed `includeDrafts`, for the reason `journalHasCosts` gives in
 * lib/costs.ts: this feeds `SiteSummary`, which is the same for every reader
 * of a journal, so a draft-only trip's readings must not put a tab in the nav
 * that a stranger would otherwise not get.
 */
function weatherAvailable(username: string): boolean {
  return (
    isEnabled("weather", username) &&
    getTripIds(username).some((id) => hasWeatherData(tripRef(username, id)))
  );
}

/**
 * Whether the Analytics tab appears at all.
 *
 * A journal that does no spending and has no readings gets no tab, exactly as
 * it got no Costs tab before — one fewer thing in a nav that is four wide on
 * a phone, rather than a tab onto an empty hub.
 */
export function analyticsAvailable(username: string): boolean {
  return costsAvailable(username) || weatherAvailable(username);
}

/** Which cards this one trip's hub should offer, for this reader. */
export type AnalyticsCards = { costs: boolean; weather: boolean };

export function analyticsCardsFor(
  username: string,
  ref: string,
  options?: ReadOptions,
): AnalyticsCards {
  return {
    costs: isEnabled("costs", username) && hasCostsData(ref, options),
    weather: isEnabled("weather", username) && hasWeatherData(ref, options),
  };
}
