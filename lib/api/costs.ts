import "server-only";
import { parseBudget } from "../costFormat";
import { getTrip } from "../trips";
import type { TripFile } from "./v2/documents";
import { readTripJson, writeTripJson } from "./tripFile";

/**
 * Writing a trip's costs section through the API — B295.
 *
 * `lib/costs.ts` reads this and, before B1598, this module wrote a separate
 * `costs.md`; since B1606/B1598 a trip's preparation budget, its items and
 * its note are the `costs` section of the one `trip.json` (`readCostsFile`
 * in lib/costs.ts already reads `trip.costsSection`, which is exactly this
 * field). `PUT` replaces the whole section (short of the `visibility` a
 * different door owns — see below); `PATCH` merges onto what is there,
 * mirroring `editEntry`'s read-modify-write for a day.
 *
 * `budget` and `costs` are validated by `lib/validate/costs.ts` before
 * anything here runs — this module only reshapes what already passed into
 * `trip.json`'s own field names.
 *
 * **`visibility` is untouched by either call here.** It is `PATCH
 * .../trips/{trip}` (`lib/api/tripDetails.ts`'s `costsVisibility`) that owns
 * who may see the numbers; this module only ever carries forward whatever is
 * already stored for it, the same way `putCosts` never touched `visibility:`
 * before this ticket either.
 */

/**
 * `days` is optional, matching the trip document's own `costs.budget` — a
 * budget can name a total without committing to how many days it is spread
 * over, and `lib/costs.ts` already treats a missing one as "no per-day
 * figure" rather than as zero. It was required here while this type was
 * hand-written beside the schema instead of derived from it, which is the
 * kind of quiet disagreement the v2 contract exists to stop.
 */
type CostsBudgetInput = { total: number; days?: number; currency?: string };
type CostsItemInput = { label: string; amount: number; category?: string; currency?: string };
type CostsSection = NonNullable<TripFile["costs"]>;

/** The body of `PUT .../costs` — the whole file. `budget` is required there
 * (see `validateCostsPut`); this type does not enforce that, the validator
 * does. */
export type CostsFileInput = {
  budget?: CostsBudgetInput;
  costs?: CostsItemInput[];
  body?: string;
};

/** The body of `PATCH .../costs` — every field optional, and `budget: null`
 * an explicit clear rather than "leave it alone". */
export type CostsEditInput = {
  budget?: CostsBudgetInput | null;
  costs?: CostsItemInput[];
  body?: string;
};

export type CostsWriteResult =
  | { ok: true }
  | { ok: false; error: string; bug?: true };

/** The `costs` section to write, carrying forward whatever `visibility` was
 * already stored (a different door's field, see the module docblock). */
function costsSectionOf(
  existingVisibility: CostsSection["visibility"] | undefined,
  budget: CostsBudgetInput | null | undefined,
  costs: CostsItemInput[] | undefined,
  body: string | undefined,
): CostsSection | undefined {
  const section: Partial<CostsSection> = {
    ...(budget ? { budget: budget as CostsSection["budget"] } : {}),
    ...(costs?.length ? { items: costs as CostsSection["items"] } : {}),
    ...(body?.trim() ? { note: body.trim() } : {}),
    ...(existingVisibility ? { visibility: existingVisibility } : {}),
  };
  return Object.keys(section).length ? (section as CostsSection) : undefined;
}

/**
 * The write just made, read back — or a sentence saying what is wrong with
 * it. Same instinct as `draftDoesNotReadBack` (lib/api/entries.ts, B208): a
 * budget can fail to parse as a *budget* even from valid JSON — a zero total
 * is exactly B263's failure, one layer up from the validator that is
 * supposed to have already refused it.
 */
function costsDoesNotReadBack(ref: string, budgetWritten: CostsBudgetInput | null | undefined): string | null {
  const section = getTrip(ref)?.costsSection;
  if (budgetWritten && !parseBudget(section?.budget)) {
    return "its budget does not read back — check that the total and days are both positive numbers";
  }
  return null;
}

/** Create or wholly replace a trip's costs section — `PUT .../costs`. */
export function putCosts(ref: string, input: CostsFileInput): CostsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const read = readTripJson(ref);
  if (!read) return { ok: false, error: "unknown_trip" };

  const costs = costsSectionOf(read.trip.costs?.visibility, input.budget, input.costs, input.body);
  writeTripJson(read.file, { ...read.trip, costs });

  const unreadable = costsDoesNotReadBack(ref, input.budget);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The costs page was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}

/** Amend a trip's costs section without resending the whole thing — `PATCH
 * .../costs`. */
export function patchCosts(ref: string, input: CostsEditInput): CostsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const existing = trip.costsSection;
  if (!existing) {
    return {
      ok: false,
      error:
        `${ref} has no costs section yet, so there is nothing to amend. PUT to this same URL to ` +
        "create one.",
    };
  }

  const read = readTripJson(ref);
  if (!read) return { ok: false, error: "unknown_trip" };

  const budget = input.budget === undefined ? existing.budget : (input.budget ?? undefined);
  const costs = input.costs === undefined ? existing.items : input.costs;
  const body = input.body === undefined ? existing.note : input.body;

  const nextCosts = costsSectionOf(existing.visibility, budget, costs, body);
  writeTripJson(read.file, { ...read.trip, costs: nextCosts });

  const unreadable = costsDoesNotReadBack(ref, budget);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The edit was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}

/**
 * Remove a trip's costs section entirely — `DELETE .../costs`.
 *
 * Whole section, not just the `budget`: `hasCostsData` (lib/costs.ts, B267)
 * is what decides whether the costs page exists at all, and it asks whether
 * the section is there, not what is in it. Removing only the budget would
 * leave preparation costs behind and the page reachable, which is not what
 * "the page is now gone" promises.
 */
export function deleteCosts(ref: string): { ok: true } | { ok: false; error: string } {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };
  if (!trip.costsSection) {
    return { ok: false, error: `${ref} has no costs section — there is nothing to delete.` };
  }

  const read = readTripJson(ref);
  if (!read) return { ok: false, error: "unknown_trip" };
  writeTripJson(read.file, { ...read.trip, costs: undefined });
  return { ok: true };
}
