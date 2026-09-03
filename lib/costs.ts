import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getAllEntries, getDays } from "./entries";
import { getTrip, tripDir } from "./trips";
import { hasBegun } from "./tripTime";
import { loadUserConfig } from "./config";
import { normalizeCurrency, toBase, type RateTable } from "./currency";
import {
  COST_CATEGORIES,
  convertCosts,
  parseBudget,
  parseCostItems,
  sumBase,
  unconvertedIn,
  type CostCategory,
  type CostItem,
  type BudgetStatus,
  type CostSummary,
  type DeclaredBudget,
  type Unconverted,
} from "./costFormat";
import type { Entry } from "./types";

export * from "./costFormat";

/**
 * The two things every conversion in this file needs: what we normalise to,
 * and this trip's own frozen rates for getting there.
 *
 * Resolved per trip and never cached across trips — the whole reason rates
 * live in `trip.md` is that two trips may hold different rates for the same
 * currency, and a shared table would quietly erase that.
 */
function conversionFor(ref: string): { base: string; rates: RateTable } {
  const trip = getTrip(ref);
  // The base currency belongs to whoever owns the trip, not to the instance:
  // two users on one server may budget in different currencies.
  const configured = trip ? loadUserConfig(trip.username).baseCurrency : "CHF";
  return {
    base: normalizeCurrency(configured, configured.toUpperCase()),
    rates: trip?.rates ?? {},
  };
}

function readCostsFile(tripId: string) {
  const file = path.join(tripDir(tripId), "costs.md");
  if (!fs.existsSync(file)) return null;
  return matter(fs.readFileSync(file, "utf8"));
}

/** Costs incurred before leaving: visas, vaccinations, passport, gear. */
export function getPreparationCosts(tripId: string): CostItem[] {
  const parsed = readCostsFile(tripId);
  if (!parsed) return [];
  const { base, rates } = conversionFor(tripId);
  return convertCosts(parseCostItems(parsed.data.costs, base), base, rates);
}

/** The planned budget for the whole trip, as written down. */
export function getBudget(tripId: string): DeclaredBudget | undefined {
  const parsed = readCostsFile(tripId);
  return parsed ? parseBudget(parsed.data.budget) : undefined;
}

/**
 * The budget in the site's base currency, or undefined when the trip has no
 * rate for the currency it was written in.
 *
 * Anything that shows a budget next to a spend figure must use this rather
 * than `getBudget`, because a total in baht drawn beside a total in francs is
 * a comparison of two different things wearing one label.
 */
export function getBudgetInBase(tripId: string): { total: number; days: number } | undefined {
  const planned = getBudget(tripId);
  if (!planned) return undefined;
  const { base, rates } = conversionFor(tripId);
  const total = toBase(planned.total, planned.currency ?? base, base, rates);
  return total === undefined ? undefined : { total, days: planned.days };
}

/** Costs attached to a single entry, converted through the trip's rates. */
export function costsForEntry(tripId: string, entry: Entry): CostItem[] {
  const { base, rates } = conversionFor(tripId);
  return convertCosts(
    entry.costs.map((i) => ({
      label: i.label,
      amount: i.amount,
      currency: i.currency,
      category: i.category as CostCategory,
    })),
    base,
    rates,
  ).map((i) => ({
    ...i,
    date: entry.date,
    location: entry.location,
    country: entry.country,
  }));
}

export function getAllCosts(tripId: string): CostItem[] {
  return [
    ...getPreparationCosts(tripId),
    ...getAllEntries(tripId).flatMap((e) => costsForEntry(tripId, e)),
  ];
}

/** Merges several unconverted lists into one, still grouped by currency. */
function mergeUnconverted(...lists: Unconverted[][]): Unconverted[] {
  const byCurrency = new Map<string, Unconverted>();
  for (const list of lists) {
    for (const u of list) {
      const hit = byCurrency.get(u.currency);
      if (hit) {
        hit.amount += u.amount;
        hit.count += u.count;
      } else {
        byCurrency.set(u.currency, { ...u });
      }
    }
  }
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Every number the costs page draws, for one trip.
 *
 * `now` is an argument for the same reason it is one throughout
 * `lib/tripTime.ts`: whether the trip has begun is a reading of a clock, and
 * a summary that reads it privately cannot be tested on either side of a
 * departure date.
 */
export function getCostSummary(tripId: string, now: Date = new Date()): CostSummary {
  const { base } = conversionFor(tripId);
  const items = getAllCosts(tripId);
  const preparationItems = getPreparationCosts(tripId);

  // Every figure below is a sum of `base` values only. Summing `amount`
  // across a mixed-currency list would produce a number that looks entirely
  // reasonable and is wrong, which is why `sumBase` is the only adder here.
  const preparation = sumBase(preparationItems);
  const total = sumBase(items);
  const onTheRoad = total - preparation;
  const days = getDays(tripId);

  const byCategory = COST_CATEGORIES.map((category) => {
    const amount = sumBase(items.filter((i) => i.category === category));
    return { category, amount, share: total > 0 ? amount / total : 0 };
  })
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Per country — "nights" is the number of days we logged in that country.
  const countryNights = new Map<string, number>();
  const countryCode = new Map<string, string | undefined>();
  for (const day of days) {
    const c = day.lead.country;
    if (!c) continue;
    countryNights.set(c, (countryNights.get(c) ?? 0) + 1);
    if (!countryCode.has(c)) countryCode.set(c, day.lead.countryCode);
  }
  const byCountry = Array.from(countryNights.keys())
    .map((country) => {
      const amount = sumBase(items.filter((i) => i.country === country));
      const nights = countryNights.get(country) ?? 0;
      return {
        country,
        countryCode: countryCode.get(country),
        amount,
        nights,
        perDay: nights > 0 ? amount / nights : 0,
      };
    })
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // Per day, with a running total seeded from the preparation spend.
  let running = preparation;
  const byDay = days.map((day) => {
    const amount = sumBase(day.entries.flatMap((e) => costsForEntry(tripId, e)));
    running += amount;
    return { date: day.date, amount, cumulative: running };
  });

  const daysWithSpend = byDay.filter((d) => d.amount > 0).length;

  // Has this trip started? Asked once, of the trip's own dates rather than of
  // `byDay.length`, and answered where the rest of the journal's tense lives.
  // An unknown trip has no dates to ask about; it also has no costs, so the
  // reading of a zero does not arise.
  const trip = getTrip(tripId);
  const begun = trip ? hasBegun(trip, byDay, now) : true;

  // Budget. Preparation is treated as spent up front rather than spread across
  // the trip, because that's when it actually leaves the account — so the
  // daily allowance is what's left divided by the planned number of days.
  //
  // A budget written in a currency the trip has no rate for produces no panel
  // at all and is reported alongside the unconverted spend: comparing an
  // unconverted budget against a converted total is precisely the plausible,
  // wrong comparison worth refusing to draw.
  const planned = getBudget(tripId);
  const plannedTotal = getBudgetInBase(tripId)?.total;

  // Pace — everything measured against the days elapsed — is attached only
  // once the trip has begun. Before that `elapsed` is 0 and every one of
  // those figures collapses to a statement about an empty set: the trip is
  // "exactly on plan", the projected total is the preparation spend, and the
  // daily rate is zero. See `BudgetPace`, and B19.
  let budget: BudgetStatus | undefined;
  if (planned && plannedTotal !== undefined) {
    const perDay = Math.max(0, (plannedTotal - preparation) / planned.days);
    const elapsed = byDay.length;
    const expectedToDate = preparation + perDay * elapsed;
    const actualPerDay = daysWithSpend > 0 ? onTheRoad / daysWithSpend : 0;
    budget = {
      total: plannedTotal,
      days: planned.days,
      perDay,
      remaining: plannedTotal - total,
      ...(begun
        ? {
            pace: {
              expectedToDate,
              deltaToDate: total - expectedToDate,
              projectedTotal: preparation + actualPerDay * planned.days,
              curve: byDay.map((_, i) => preparation + perDay * (i + 1)),
            },
          }
        : {}),
    };
  }

  const unconverted = mergeUnconverted(
    unconvertedIn(items),
    planned && plannedTotal === undefined
      ? [{ currency: planned.currency ?? base, amount: planned.total, count: 1 }]
      : [],
  );

  return {
    baseCurrency: base,
    hasBegun: begun,
    budget,
    total,
    onTheRoad,
    preparation,
    perDay: daysWithSpend > 0 ? onTheRoad / daysWithSpend : 0,
    daysWithSpend,
    byCategory,
    byCountry,
    byDay,
    items,
    unconverted,
  };
}

/** Total spend for one day — used for the badge in the story feed. */
export function costForDay(tripId: string, entries: Entry[]): number {
  return sumBase(entries.flatMap((e) => costsForEntry(tripId, e)));
}
