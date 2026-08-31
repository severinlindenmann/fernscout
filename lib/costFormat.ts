// Cost types, category styling and formatting — no filesystem access, so this
// is safe to import from client components. The reading/aggregating half lives
// in lib/costs.ts, which is server-only.

import { normalizeCurrency, toBase, type RateTable } from "./currency";

export { formatMoney } from "./currency";

export const COST_CATEGORIES = [
  "preparation",
  "flights",
  "accommodation",
  "food",
  "transport",
  "activities",
  "other",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Colours come from the validated categorical palette, kept in this order —
 * adjacency is what the colour-blindness check was run against, so don't
 * reorder without re-validating. */
export const CATEGORY_STYLE: Record<CostCategory, { color: string }> = {
  preparation: { color: "#2a78d6" },
  flights: { color: "#eb6834" },
  accommodation: { color: "#1baf7a" },
  food: { color: "#eda100" },
  transport: { color: "#e87ba4" },
  activities: { color: "#4a3aa7" },
  other: { color: "#e34948" },
};

/** A cost exactly as it was written down, before anything is converted. */
export type RawCostItem = {
  label: string;
  /** As spent, in `currency`. */
  amount: number;
  /** ISO-4217 code — the trip's base currency when frontmatter omits it. */
  currency: string;
  category: CostCategory;
};

export type CostItem = RawCostItem & {
  /**
   * The same spend in the site's base currency.
   *
   * Undefined when the trip's rate table says nothing about `currency`. That
   * is deliberately not zero and not `amount`: an unconvertible cost has to
   * be visible as a gap, because a number that is merely plausible is worse
   * than a number that is missing.
   */
  base?: number;
  /** Absent for pre-trip preparation costs. */
  date?: string;
  location?: string;
  country?: string;
};

/**
 * Spend an aggregate had to leave out, grouped by the currency it was in.
 *
 * Every total on the costs page is accompanied by one of these lists, so the
 * page can say "and 4 200 THB besides, which has no rate" rather than quietly
 * reporting a smaller trip.
 */
export type Unconverted = {
  currency: string;
  /** Total in that currency, as spent. */
  amount: number;
  /** How many individual costs make it up. */
  count: number;
};

/** What was set aside, and how the real spend compares so far. */
export type BudgetStatus = {
  /** Planned total for the whole trip, in the base currency. */
  total: number;
  /** How many days the budget was drawn up for. */
  days: number;
  /** Daily allowance once actual preparation spend is taken off the top. */
  perDay: number;
  /** What we'd have spent by now if we were exactly on plan. */
  expectedToDate: number;
  /** Real spend so far minus that — negative means under budget. */
  deltaToDate: number;
  /** Where the trip lands if the current daily rate holds. */
  projectedTotal: number;
  /** Budget left, which can go negative. */
  remaining: number;
  /** Planned cumulative spend, one entry per logged day, for the chart. */
  curve: number[];
};

export type CostSummary = {
  /** The currency every number below is expressed in. */
  baseCurrency: string;
  total: number;
  onTheRoad: number;
  preparation: number;
  perDay: number;
  daysWithSpend: number;
  byCategory: { category: CostCategory; amount: number; share: number }[];
  byCountry: {
    country: string;
    countryCode?: string;
    amount: number;
    nights: number;
    perDay: number;
  }[];
  byDay: { date: string; amount: number; cumulative: number }[];
  items: CostItem[];
  /** Spend excluded from every total above for want of a rate. Usually empty. */
  unconverted: Unconverted[];
  /** Absent when the trip declares no budget, or its currency has no rate. */
  budget?: BudgetStatus;
};

/** A budget as written down, before conversion. */
export type DeclaredBudget = { total: number; days: number; currency?: string };

/** Reads the `budget:` block out of frontmatter. Returns undefined rather than
 * throwing if it's missing or nonsense, so the page still renders. */
export function parseBudget(raw: unknown): DeclaredBudget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const total = Number(r.total);
  const days = Number(r.days);
  if (!Number.isFinite(total) || total <= 0) return undefined;
  if (!Number.isFinite(days) || days <= 0) return undefined;
  const currency = normalizeCurrency(r.currency);
  return { total, days, ...(currency ? { currency } : {}) };
}

/**
 * Base-currency total of everything that could be converted.
 *
 * Anything without a rate contributes nothing rather than its face value —
 * adding 450 THB to a pile of Swiss francs is the failure mode this whole
 * package exists to rule out. Pair every call with `unconvertedIn` on the
 * same list so the gap is reported.
 */
export function sumBase(items: Pick<CostItem, "base">[]): number {
  return items.reduce((n, i) => n + (i.base ?? 0), 0);
}

/** What `sumBase` had to leave out, grouped by currency, largest first. */
export function unconvertedIn(items: Pick<CostItem, "base" | "amount" | "currency">[]): Unconverted[] {
  const byCurrency = new Map<string, Unconverted>();
  for (const item of items) {
    if (item.base !== undefined) continue;
    const hit = byCurrency.get(item.currency);
    if (hit) {
      hit.amount += item.amount;
      hit.count += 1;
    } else {
      byCurrency.set(item.currency, { currency: item.currency, amount: item.amount, count: 1 });
    }
  }
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Attaches the base-currency value to each cost, through the trip's own rates.
 *
 * This is where layer 1 meets layer 2: the original stays untouched on
 * `amount`/`currency`, and `base` is derived. Grouping and summing then
 * happens on `base` only, never on raw `amount`s from different currencies.
 */
export function convertCosts<T extends RawCostItem>(
  items: T[],
  base: string,
  rates: RateTable,
): (T & { base?: number })[] {
  return items.map((item) => {
    const converted = toBase(item.amount, item.currency, base, rates);
    return converted === undefined ? { ...item } : { ...item, base: converted };
  });
}

function normalizeCategory(raw: unknown): CostCategory {
  const v = String(raw ?? "other").toLowerCase();
  return (COST_CATEGORIES as readonly string[]).includes(v) ? (v as CostCategory) : "other";
}

/**
 * Parses the `costs:` list out of frontmatter. Drops anything unusable so a
 * typo in one line can't take down the page.
 *
 * `currency` is optional and defaults to the site's base currency, which keeps
 * every entry written before multi-currency existed reading exactly as it did.
 */
export function parseCostItems(raw: unknown, defaultCurrency: string): RawCostItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      label: String(r?.label ?? "").trim(),
      amount: Number(r?.amount ?? 0),
      currency: normalizeCurrency(r?.currency, defaultCurrency),
      category: normalizeCategory(r?.category),
    }))
    .filter((i) => i.label && Number.isFinite(i.amount) && i.amount > 0);
}
